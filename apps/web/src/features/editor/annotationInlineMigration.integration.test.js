import { beforeAll, afterAll, it, expect } from 'vitest';
import {
  anchorForBlock,
  anchorForListItem,
  anchorForSection,
  anchorFromProjectedRange,
  projectMarkdown,
  calculateContentHash
} from '@study-accelerator/content-anchor';
import { parseKnowraMarks } from '@study-accelerator/shared/knowra-marks';
import { createKnowledgeModule } from '../../../../api/src/modules/knowledge/index.js';
import { createMigrationCodec } from './annotationInlineMigration.testing';
import { checkInlineMigration, executeInlineMigration } from './annotationInlineMigrationRunner';

let codec;
beforeAll(async () => {
  codec = await createMigrationCodec();
});
afterAll(async () => {
  await codec.destroy();
});

function fixture(source) {
  const module = createKnowledgeModule();
  const markdown = codec.serialize(codec.parse(source));
  const note = module.noteService.createNote({ spaceId: 'space-test', title: '独立集成', rawMarkdown: markdown });
  const api = {
    getNote: async id => module.noteService.getNote(id),
    updateNote: async (id, input) => module.noteService.updateNote(id, input),
    listAnnotations: async (noteId, spaceId) =>
      module.contentAnnotationService.listAnnotationsByNote({ noteId, spaceId }),
    deleteAnnotation: async (id, expectedRevision) =>
      module.contentAnnotationService.deleteAnnotation(id, { expectedRevision }),
    updateAnnotation: async (id, input) => module.contentAnnotationService.updateAnnotation(id, input),
    previewAnnotation: async id => module.annotationScopeService.previewAnnotation(id)
  };
  const create = (anchor, extra = {}) =>
    module.contentAnnotationService.createAnnotation({
      noteId: note.id,
      spaceId: 'space-test',
      schemaVersion: 2,
      scopeType: anchor.scopeType,
      anchor,
      quoteText: anchor.quoteText,
      fromPosition: anchor.sourceStart,
      toPosition: anchor.sourceEnd,
      anchorFingerprint: crypto.randomUUID(),
      noteContentHash: calculateContentHash(markdown),
      idempotencyKey: crypto.randomUUID(),
      ...extra
    });
  return { module, note, api, create, projection: projectMarkdown(markdown) };
}

it('真实服务迁移选区、章节、列表与代码块，并取消已验证的旧行', async () => {
  const { module, note, api, create, projection } = fixture(
    '## 第一章\n\nalpha beta\n\n- one\n- two\n\n```js\nhello\n```\n'
  );
  const start = projection.text.indexOf('beta');
  const old = [
    create(anchorFromProjectedRange(projection, start, start + 4), { comment: '保留备注' }),
    create(anchorForSection(projection, 0)),
    create(anchorForListItem(projection, projection.listItems[1].path)),
    create(
      anchorForBlock(
        projection,
        projection.blocks.findIndex(b => b.type === 'code')
      )
    )
  ];
  const checks = await checkInlineMigration([note], api, codec);
  const result = await executeInlineMigration(checks, api, codec);
  expect(result).toMatchObject([{ status: 'migrated', migrated: 4, commentsCarried: 1 }]);
  expect(old.map(a => module.repositories.contentAnnotationRepository.findById(a.id).lifecycleStatus)).toEqual([
    'deleted',
    'deleted',
    'deleted',
    'deleted'
  ]);
  expect(
    (await api.listAnnotations(note.id, note.spaceId)).some(a => a.schemaVersion === 3 && a.comment === '保留备注')
  ).toBe(true);
});

it('真实服务部分取消中断后可续跑，不重复标记或丢备注', async () => {
  const { module, note, api, create, projection } = fixture('alpha beta gamma\n');
  const a = create(anchorFromProjectedRange(projection, 0, 5), { comment: 'alpha remark' }),
    b = create(anchorFromProjectedRange(projection, 6, 10), { comment: 'beta remark' });
  const original = api.deleteAnnotation;
  let calls = 0;
  api.deleteAnnotation = async (...args) => {
    if (++calls === 2) throw new Error('模拟中断');
    return original(...args);
  };
  const first = await executeInlineMigration(await checkInlineMigration([note], api, codec), api, codec);
  expect(first).toMatchObject([{ status: 'failed', migrated: 1 }]);
  api.deleteAnnotation = original;
  const second = await executeInlineMigration(await checkInlineMigration([note], api, codec), api, codec);
  expect(second).toMatchObject([{ status: 'migrated', migrated: 1 }]);
  expect(
    [a, b].every(row => module.repositories.contentAnnotationRepository.findById(row.id).lifecycleStatus === 'deleted')
  ).toBe(true);
  const rows = await api.listAnnotations(note.id, note.spaceId);
  expect(rows.filter(a => a.schemaVersion === 3)).toHaveLength(2);
  expect(
    rows
      .filter(a => a.schemaVersion === 3)
      .map(a => a.comment)
      .sort()
  ).toEqual(['alpha remark', 'beta remark']);
});

it('真实章节排除在保存跟随与续跑校验后仍保留，不扩大有效范围', async () => {
  const { module, note, api, create, projection } = fixture('## 第一章\n\nintro\n\nexcluded\n\nend\n');
  const parent = create(anchorForSection(projection, 0));
  const excluded = anchorForBlock(projection, 2);
  expect(excluded.quoteText).toBe('excluded');
  module.annotationScopeService.createExclusion(parent.id, {
    anchor: excluded,
    noteContentHash: calculateContentHash(note.rawMarkdown),
    expectedRevision: parent.revision
  });
  const checks = await checkInlineMigration([note], api, codec);
  expect(checks[0].plan.issues).toEqual([]);
  const result = await executeInlineMigration(checks, api, codec);
  expect(result).toMatchObject([{ status: 'migrated', migrated: 1 }]);
  const parsed = parseKnowraMarks((await api.getNote(note.id)).rawMarkdown);
  expect(parsed.blocks.filter(mark => mark.exclude)).toHaveLength(1);
  expect(module.repositories.contentAnnotationRepository.findById(parent.id).lifecycleStatus).toBe('deleted');
});

it('真实列表正文保存后中断，重开检查仍能安全续跑并转移备注', async () => {
  const { module, note, api, create, projection } = fixture('- one\n- two\n');
  const old = create(anchorForListItem(projection, projection.listItems[1].path), { comment: '列表备注' });
  const original = api.deleteAnnotation;
  api.deleteAnnotation = async () => {
    throw new Error('模拟保存后中断');
  };
  expect(await executeInlineMigration(await checkInlineMigration([note], api, codec), api, codec)).toMatchObject([
    { status: 'failed', migrated: 0 }
  ]);
  api.deleteAnnotation = original;
  const checks = await checkInlineMigration([note], api, codec);
  expect(checks[0].plan.issues).toEqual([]);
  expect(await executeInlineMigration(checks, api, codec)).toMatchObject([{ status: 'migrated', migrated: 1 }]);
  expect(module.repositories.contentAnnotationRepository.findById(old.id).lifecycleStatus).toBe('deleted');
  const rows = await api.listAnnotations(note.id, note.spaceId);
  expect(rows.filter(row => row.schemaVersion === 3)).toHaveLength(1);
  expect(rows.find(row => row.schemaVersion === 3).comment).toBe('列表备注');
});

it('中断后源备注已清空而新重点仍有旧副本时，不取消来源或复活旧备注', async () => {
  const { module, note, api, create, projection } = fixture('alpha beta\n');
  const old = create(anchorFromProjectedRange(projection, 0, 5), { comment: '稍后清空的备注' });
  const original = api.deleteAnnotation;
  api.deleteAnnotation = async () => {
    throw new Error('模拟保存后中断');
  };
  expect(await executeInlineMigration(await checkInlineMigration([note], api, codec), api, codec)).toMatchObject([
    { status: 'failed', commentsCarried: 1 }
  ]);
  api.deleteAnnotation = original;
  const current = module.repositories.contentAnnotationRepository.findById(old.id);
  await api.updateAnnotation(old.id, { expectedRevision: current.revision, comment: '' });
  expect(await executeInlineMigration(await checkInlineMigration([note], api, codec), api, codec)).toMatchObject([
    { status: 'failed', migrated: 0, message: expect.stringContaining('新旧重点备注不同') }
  ]);
  expect(module.repositories.contentAnnotationRepository.findById(old.id)).toMatchObject({
    lifecycleStatus: 'active',
    comment: ''
  });
});
