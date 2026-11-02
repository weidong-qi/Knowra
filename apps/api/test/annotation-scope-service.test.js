import assert from 'node:assert/strict';
import { createKnowledgeModule } from '../src/modules/knowledge/index.js';
import { createInMemoryContentAnnotationRepository } from '../src/modules/knowledge/infrastructure/content-annotation-repository.js';
import { createContentAnnotationService } from '../src/modules/knowledge/application/content-annotation-service.js';
import { ContentAnnotation } from '../src/modules/knowledge/domain/content-annotation.js';
import { annotationOf } from './fixtures/inline-annotation-seed.js';

// 章节重点写在正文标记里（重点内联化），排除用 `<!--k- id-->` 标在被排除的块上。
function createFixture(excluded = false) {
  const knowledge = createKnowledgeModule();
  const markdown = `## 范围 <!--k sec s=section-->\n\nA 段\n\nB 段${excluded ? ' <!--k- sec-->' : ''}\n\nC 段\n\n## 下一节\n\nD 段`;
  const note = knowledge.noteService.createNote({
    id: 'scope-note',
    spaceId: 'scope-space',
    title: '范围',
    rawMarkdown: markdown
  });
  const version = knowledge.noteVersionService.listVersions({ noteId: note.id })[0];
  return { knowledge, note, version, annotation: annotationOf(knowledge, note.id, 'sec') };
}

export const annotationScopeServiceTests = [
  {
    name: '章节重点的局部排除写在正文里并从统一分析范围中去掉，排除接口不再接受旧格式写入',
    async run() {
      const { knowledge, note, annotation } = createFixture(true);
      assert.throws(
        () =>
          knowledge.annotationScopeService.createExclusion(annotation.id, { expectedRevision: annotation.revision }),
        error => error.code === 'ANNOTATION_LEGACY_REMOVED' && error.statusCode === 410
      );
      assert.throws(
        () =>
          knowledge.annotationScopeService.deleteExclusion(annotation.id, 'any', {
            expectedRevision: annotation.revision
          }),
        error => error.code === 'ANNOTATION_LEGACY_REMOVED'
      );
      const preview = knowledge.annotationScopeService.previewAnalysisScope({
        spaceId: note.spaceId,
        mode: 'marked',
        annotationIds: [annotation.id]
      });
      assert.equal(preview.ai.available, false);
      const text = preview.segments.map(segment => segment.markdown).join('');
      assert.match(text, /A 段/);
      assert.doesNotMatch(text, /B 段/);
      assert.match(text, /C 段/);
      assert.doesNotMatch(text, /<!--k/);
    }
  },
  {
    name: 'analysis scope snapshots are immutable and reject stale previews',
    async run() {
      const { knowledge, note, annotation } = createFixture();
      const input = { spaceId: note.spaceId, mode: 'marked', annotationIds: [annotation.id] };
      const preview = knowledge.annotationScopeService.previewAnalysisScope(input);
      const snapshot = knowledge.annotationScopeService.createAnalysisScope({
        ...input,
        previewHash: preview.previewHash,
        idempotencyKey: 'snapshot-1'
      });
      knowledge.noteService.updateNote(note.id, { rawMarkdown: `${note.rawMarkdown}\n新增` });
      const stored = knowledge.annotationScopeService.getAnalysisScope(snapshot.id, note.spaceId);
      assert.deepEqual(stored.segments, snapshot.segments);
      assert.equal(stored.inputHash, preview.previewHash);
      assert.throws(
        () =>
          knowledge.annotationScopeService.createAnalysisScope({
            ...input,
            previewHash: preview.previewHash,
            idempotencyKey: 'snapshot-2'
          }),
        error => error.code === 'ANNOTATION_CONTENT_CONFLICT'
      );
    }
  },
  {
    name: '章节重点的范围由正文标记派生：本节新增段落纳入，标题层级变化后仍止于同级或更高标题',
    async run() {
      const { knowledge, note, annotation } = createFixture();
      knowledge.noteService.updateNote(note.id, {
        rawMarkdown: note.rawMarkdown.replace('\n\n## 下一节', '\n\n新增段落\n\n## 下一节')
      });
      const followed = knowledge.contentAnnotationService.getAnnotation(annotation.id);
      assert.equal(followed.anchorStatus, 'resolved');
      assert.match(followed.quoteText, /新增段落/);
      const current = knowledge.noteService.getNote(note.id);
      knowledge.noteService.updateNote(note.id, { rawMarkdown: current.rawMarkdown.replace('## 下一节', '# 下一节') });
      const changed = knowledge.contentAnnotationService.getAnnotation(annotation.id);
      assert.equal(changed.anchorStatus, 'resolved');
      assert.doesNotMatch(changed.quoteText, /D 段/);
    }
  },
  {
    name: 'annotation and revision writes roll back together when revision persistence fails',
    async run() {
      const records = [];
      const repository = createInMemoryContentAnnotationRepository({ records });
      repository.save(
        new ContentAnnotation({
          id: 'rollback-annotation',
          spaceId: 'rollback-space',
          noteId: 'rollback-note',
          quoteText: '正文',
          fromPosition: 0,
          toPosition: 2,
          anchorFingerprint: 'client',
          noteContentHash: 'hash',
          idempotencyKey: 'rollback',
          schemaVersion: 1
        })
      );
      const runTransaction = operation => {
        const before = structuredClone(records);
        try {
          return operation();
        } catch (error) {
          records.splice(0, records.length, ...before);
          throw error;
        }
      };
      const service = createContentAnnotationService({
        repository,
        revisionRepository: {
          save() {
            throw new Error('fault after annotation save');
          }
        }
      });
      assert.throws(
        () =>
          runTransaction(() =>
            service.updateAnnotation('rollback-annotation', { expectedRevision: 1, comment: '新备注' })
          ),
        /fault after annotation save/
      );
      assert.equal(records.length, 1);
      assert.equal(records[0].revision, 1);
      assert.equal(records[0].comment, '');
    }
  }
];
