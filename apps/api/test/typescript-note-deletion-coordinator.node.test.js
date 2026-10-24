import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { parse } from '@babel/parser';
import {
  deletionParent,
  deletionFrozenSource,
  deletionContractCases,
  deletionConsumerCases,
  observeDeletion,
  hash,
  deletionSourceSha
} from './note-deletion-coordinator.contract-support.js';

const baseline = process.env.KNOWRA_NOTE_DELETION_BASELINE === '1';
const root = new URL('../../../', import.meta.url);
const helper = 'apps/api/src/modules/knowledge/application/note-deletion-coordinator.js';
const sourceUrl = new URL(helper, root);
let loadCount = 0;
async function loadSource(source, label) {
  return import(
    'data:text/javascript;base64,' + Buffer.from(source + `\n// ${label} ${++loadCount}`).toString('base64')
  );
}
// 普通入口零 Git；显式基线只读取准确实际父，缺失时失败，不回退候选或冻结文本。
const historical = baseline
  ? execFileSync('git', ['show', `${deletionParent}:${helper}`], { cwd: root, encoding: 'utf8' })
  : null;
const api = baseline ? await loadSource(historical, 'exact-parent') : await import(sourceUrl);
const frozen = await loadSource(deletionFrozenSource, 'frozen-parent');
const executable = baseline
  ? historical
  : stripTypeScriptTypes(readFileSync(new URL(helper.replace(/\.js$/, '.ts'), root), 'utf8'));
for (const entry of deletionContractCases(api)) test(entry.name, entry.run);
function executableAst(source) {
  const normalize = value =>
    Array.isArray(value)
      ? value.map(normalize)
      : value === null || typeof value !== 'object'
        ? value
        : Object.fromEntries(
            Object.entries(value)
              .filter(
                ([key]) =>
                  ![
                    'start',
                    'end',
                    'loc',
                    'extra',
                    'comments',
                    'leadingComments',
                    'trailingComments',
                    'innerComments'
                  ].includes(key)
              )
              .map(([key, nested]) => [key, normalize(nested)])
          );
  return normalize(parse(source, { sourceType: 'module' }).program);
}
test('frozen exact actual-parent source matches independent SHA256', () => {
  assert.equal(deletionParent, 'e598512343ecc4fa662ce84c7d95f6e8b65a24b9');
  assert.equal(hash(deletionFrozenSource), deletionSourceSha);
  if (baseline) assert.equal(historical, deletionFrozenSource);
});
test('Node official erasure preserves complete ordered runtime AST', { skip: baseline }, () => {
  assert.deepEqual(executableAst(executable), executableAst(deletionFrozenSource));
});
test('JS bridge exports only the identical TS deletion factory', { skip: baseline }, async () => {
  const typed = await import(new URL(helper.replace(/\.js$/, '.ts'), root));
  assert.deepEqual(Object.keys(api), ['createNoteDeletionCoordinator']);
  assert.deepEqual(Object.keys(typed), ['createNoteDeletionCoordinator']);
  assert.equal(api.createNoteDeletionCoordinator, typed.createNoteDeletionCoordinator);
  const program = parse(readFileSync(sourceUrl, 'utf8'), { sourceType: 'module' }).program;
  assert.deepEqual(program.directives, []);
  assert.equal(program.body.length, 1);
  const statement = program.body[0];
  assert.equal(statement.type, 'ExportNamedDeclaration');
  assert.equal(statement.declaration, null);
  assert.equal(statement.source.value, './note-deletion-coordinator.ts');
  assert.equal(statement.specifiers.length, 1);
  assert.equal(statement.specifiers[0].type, 'ExportSpecifier');
  assert.equal(statement.specifiers[0].local.name, 'createNoteDeletionCoordinator');
  assert.equal(statement.specifiers[0].exported.name, 'createNoteDeletionCoordinator');
});
test('2048 fresh ordered old/new cases preserve snapshots reads receivers aliases spread and errors', () => {
  const counts = new Map(),
    operations = new Map();
  for (let seed = 0; seed < 2048; seed++) {
    const old = observeDeletion(frozen, seed);
    assert.deepEqual(observeDeletion(api, seed), old, 'Differential seed ' + seed);
    counts.set(old.outcome.kind, (counts.get(old.outcome.kind) ?? 0) + 1);
    operations.set(old.operation, (operations.get(old.operation) ?? 0) + 1);
  }
  for (const operation of ['permanentlyDeleteNote', 'emptyRecycleBin']) assert.equal(operations.get(operation), 1024);
  for (const outcome of ['identity', 'spread', 'sentinel']) assert.ok(counts.get(outcome) > 10, outcome);
  assert.equal(counts.has('unexpected'), false);
});
const mutations = [
  ['skip exclusions', '    annotationExclusionRepository?.deleteByAnnotationIds?.(annotationIds);\n', ''],
  ['skip revisions', '    annotationRevisionRepository?.deleteByAnnotationIds?.(annotationIds);\n', ''],
  ['skip annotations', '    contentAnnotationRepository?.deleteByNoteIds?.(noteIds);\n', ''],
  ['skip versions', '    noteVersionRepository?.deleteByNoteIds?.(noteIds);\n', ''],
  ['skip detach', 'attachmentStore?.detachAttachmentsForNotes?.(noteIds)', '[]'],
  ['skip cleanup', 'attachmentStore?.removeDetachedAttachmentFiles?.(attachments)', '[]'],
  [
    'reverse exclusion revision order',
    '    annotationExclusionRepository?.deleteByAnnotationIds?.(annotationIds);\n    annotationRevisionRepository?.deleteByAnnotationIds?.(annotationIds);',
    '    annotationRevisionRepository?.deleteByAnnotationIds?.(annotationIds);\n    annotationExclusionRepository?.deleteByAnnotationIds?.(annotationIds);'
  ],
  [
    'reverse note and version deletion order',
    '    contentAnnotationRepository?.deleteByNoteIds?.(noteIds);\n    noteVersionRepository?.deleteByNoteIds?.(noteIds);',
    '    noteVersionRepository?.deleteByNoteIds?.(noteIds);\n    contentAnnotationRepository?.deleteByNoteIds?.(noteIds);'
  ],
  [
    'dependent deletion moved before service',
    '      const result = noteService.permanentlyDeleteNote(noteId);\n      detachedAttachments = removeDependents([noteId]);',
    '      detachedAttachments = removeDependents([noteId]);\n      const result = noteService.permanentlyDeleteNote(noteId);'
  ],
  [
    'cleanup inside permanent transaction',
    '      detachedAttachments = removeDependents([noteId]);\n      return result;',
    '      detachedAttachments = removeDependents([noteId]);\n      finishAttachmentCleanup(detachedAttachments);\n      return result;'
  ],
  [
    'cleanup inside recycle transaction',
    '      detachedAttachments = removeDependents(noteIds);\n      return deletion;',
    '      detachedAttachments = removeDependents(noteIds);\n      finishAttachmentCleanup(detachedAttachments);\n      return deletion;'
  ],
  [
    'recycle snapshot moved into transaction',
    '    const noteIds = noteRepository\n      .list({ includeDeleted: true, spaceId })\n      .filter((note) => note.deleted)\n      .map((note) => note.id);\n    let detachedAttachments = [];\n    const result = runTransaction(() => {',
    '    let detachedAttachments = [];\n    const result = runTransaction(() => {\n      const noteIds = noteRepository.list({ includeDeleted: true, spaceId }).filter((note) => note.deleted).map((note) => note.id);'
  ],
  [
    'recycle snapshot relisted inside transaction',
    '      detachedAttachments = removeDependents(noteIds);',
    '      detachedAttachments = removeDependents(noteRepository.list({ includeDeleted: true, spaceId }).filter(note => note.deleted).map(note => note.id));'
  ],
  [
    'cache annotation list getter',
    "    const annotationIds = typeof contentAnnotationRepository?.list === 'function'\n      ? contentAnnotationRepository.list({ includeDeleted: true })",
    "    const list = contentAnnotationRepository?.list;\n    const annotationIds = typeof list === 'function'\n      ? list.call(contentAnnotationRepository, { includeDeleted: true })"
  ],
  [
    'annotation list called without receiver',
    'contentAnnotationRepository.list({ includeDeleted: true })',
    '(0, contentAnnotationRepository.list)({ includeDeleted: true })'
  ],
  [
    'annotation ID array cloned for exclusions',
    'deleteByAnnotationIds?.(annotationIds)',
    'deleteByAnnotationIds?.([...annotationIds])',
    2
  ],
  [
    'annotation IDs deduplicated',
    '.map((annotation) => annotation.id)',
    '.map((annotation) => annotation.id).filter((id, index, all) => all.indexOf(id) === index)'
  ],
  ['annotation IDs stringified', '.map((annotation) => annotation.id)', '.map((annotation) => String(annotation.id))'],
  [
    'note array cloned for versions',
    'noteVersionRepository?.deleteByNoteIds?.(noteIds)',
    'noteVersionRepository?.deleteByNoteIds?.([...noteIds])'
  ],
  ['note array cloned for detach', 'detachAttachmentsForNotes?.(noteIds)', 'detachAttachmentsForNotes?.([...noteIds])'],
  [
    'note IDs deduplicated',
    '.map((note) => note.id)',
    '.map((note) => note.id).filter((id, index, all) => all.indexOf(id) === index)'
  ],
  ['note IDs stringified', '.map((note) => note.id)', '.map((note) => String(note.id))'],
  ['permanent ID stringified', 'removeDependents([noteId])', 'removeDependents([String(noteId)])'],
  [
    'includes replaces SameValueZero with strict equality',
    'noteIds.includes(annotation.noteId)',
    'noteIds.some(id => id === annotation.noteId)'
  ],
  [
    'includes uses loose equality',
    'noteIds.includes(annotation.noteId)',
    'noteIds.some(id => id == annotation.noteId)'
  ],
  ['deleted narrowed to exact true', '.filter((note) => note.deleted)', '.filter((note) => note.deleted === true)'],
  ['deleted filter removed', '.filter((note) => note.deleted)', '.filter(() => true)'],
  [
    'custom note filter converted to array',
    'const noteIds = noteRepository\n      .list({ includeDeleted: true, spaceId })',
    'const noteIds = Array.from(noteRepository\n      .list({ includeDeleted: true, spaceId }))'
  ],
  [
    'custom annotation filter converted to array',
    'contentAnnotationRepository.list({ includeDeleted: true })',
    'Array.from(contentAnnotationRepository.list({ includeDeleted: true }))'
  ],
  [
    'empty exclusions skipped',
    '    annotationExclusionRepository?.deleteByAnnotationIds?.(annotationIds);',
    '    if (annotationIds.length) annotationExclusionRepository?.deleteByAnnotationIds?.(annotationIds);'
  ],
  [
    'empty revisions skipped',
    '    annotationRevisionRepository?.deleteByAnnotationIds?.(annotationIds);',
    '    if (annotationIds.length) annotationRevisionRepository?.deleteByAnnotationIds?.(annotationIds);'
  ],
  [
    'empty versions skipped',
    '    noteVersionRepository?.deleteByNoteIds?.(noteIds);',
    '    if (noteIds.length) noteVersionRepository?.deleteByNoteIds?.(noteIds);'
  ],
  [
    'detached fallback changed to truthiness',
    'detachAttachmentsForNotes?.(noteIds) ?? []',
    'detachAttachmentsForNotes?.(noteIds) || []'
  ],
  [
    'cleanup length narrowed numeric positive',
    'return attachmentCleanup.length ?',
    'return attachmentCleanup.length > 0 ?',
    2
  ],
  ['cleanup payload checked instead of length', 'return attachmentCleanup.length ?', 'return attachmentCleanup ?', 2],
  [
    'cleanup length getter duplicated',
    'return attachmentCleanup.length ?',
    'return attachmentCleanup.length && attachmentCleanup.length ?',
    2
  ],
  ['permanent result always copied', ': deletedNote;', ': { ...deletedNote };'],
  ['recycle result always copied', ': result;', ': { ...result };'],
  [
    'cleanup overwritten by original property',
    '{ ...deletedNote, attachmentCleanup }',
    '{ attachmentCleanup, ...deletedNote }'
  ],
  [
    'spread replaced with mutation',
    '{ ...deletedNote, attachmentCleanup }',
    'Object.assign(deletedNote, { attachmentCleanup })'
  ],
  [
    'spread replaces enumerable symbol with string entries only',
    '{ ...deletedNote, attachmentCleanup }',
    '{ ...Object.fromEntries(Object.entries(deletedNote)), attachmentCleanup }'
  ],
  [
    'result getter read before cleanup length',
    '    return attachmentCleanup.length ? { ...deletedNote, attachmentCleanup } : deletedNote;',
    '    const copy = { ...deletedNote };\n    return attachmentCleanup.length ? { ...copy, attachmentCleanup } : deletedNote;'
  ],
  [
    'ignored exclusion then inspected',
    '    annotationExclusionRepository?.deleteByAnnotationIds?.(annotationIds);',
    '    annotationExclusionRepository?.deleteByAnnotationIds?.(annotationIds)?.then;'
  ],
  [
    'service then inspected',
    '      const result = noteService.permanentlyDeleteNote(noteId);',
    '      const result = noteService.permanentlyDeleteNote(noteId);\n      result?.then;'
  ],
  [
    'permanent becomes async',
    '  function permanentlyDeleteNote(noteId)',
    '  async function permanentlyDeleteNote(noteId)'
  ],
  [
    'recycle becomes async',
    '  function emptyRecycleBin(spaceId = null)',
    '  async function emptyRecycleBin(spaceId = null)'
  ],
  ['default space null removed', 'function emptyRecycleBin(spaceId = null)', 'function emptyRecycleBin(spaceId)'],
  [
    'space argument normalized by truthiness',
    '.list({ includeDeleted: true, spaceId })',
    '.list({ includeDeleted: true, spaceId: spaceId || null })'
  ],
  [
    'transaction method receiver changed',
    'const deletedNote = runTransaction(() => {',
    'const deletedNote = ({ runTransaction }).runTransaction(() => {'
  ],
  ['transaction callback skipped', 'runTransaction = (operation) => operation()', 'runTransaction = () => undefined']
];
for (const [name, before, after, expectedCount = 1] of mutations) {
  test('effective parsed/imported behavioral mutant: ' + name, async () => {
    assert.equal(deletionFrozenSource.split(before).length - 1, expectedCount, 'Mutation anchor count');
    const mutated = deletionFrozenSource.replaceAll(before, after);
    parse(mutated, { sourceType: 'module' });
    const mutant = await loadSource(mutated, name);
    assert.equal(typeof mutant.createNoteDeletionCoordinator, 'function');
    let caught;
    for (const entry of deletionContractCases(mutant)) {
      try {
        await assert.doesNotReject(async () => entry.run());
      } catch (error) {
        if (error.code !== 'ERR_ASSERTION') throw error;
        caught = entry.name;
        break;
      }
    }
    assert.ok(caught, 'No fixed behavioral oracle rejected ' + name);
  });
}
if (!baseline) for (const entry of deletionConsumerCases()) test(entry.name, entry.run);
