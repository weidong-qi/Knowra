import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { parse } from '@babel/parser';
import {
  lifecycleParent,
  lifecycleFrozenSource,
  lifecycleContractCases,
  lifecycleConsumerCases,
  observeLifecycle,
  hash
} from './note-dependency-lifecycle.contract-support.js';

const baseline = process.env.KNOWRA_NOTE_LIFECYCLE_BASELINE === '1';
const root = new URL('../../../', import.meta.url);
const helper = 'apps/api/src/modules/knowledge/application/note-dependency-lifecycle.js';
const sourceUrl = new URL(helper, root);
let loadCount = 0;
async function loadSource(source, label) {
  const dependency = "'./knowledge-errors.js'";
  assert.equal(source.split(dependency).length, 2, 'Exact original runtime dependency');
  const rewritten = source.replace(dependency, JSON.stringify(new URL('./knowledge-errors.js', sourceUrl).href));
  return import(
    'data:text/javascript;base64,' + Buffer.from(rewritten + `\n// ${label} ${++loadCount}`).toString('base64')
  );
}
// 普通入口零 Git；显式基线只读取准确实际父，缺失时失败，不回退候选或冻结文本。
const historical = baseline
  ? execFileSync('git', ['show', `${lifecycleParent}:${helper}`], { cwd: root, encoding: 'utf8' })
  : null;
const api = baseline ? await loadSource(historical, 'exact-parent') : await import(sourceUrl);
const frozen = await loadSource(lifecycleFrozenSource, 'frozen-parent');
const executable = baseline
  ? historical
  : stripTypeScriptTypes(readFileSync(new URL(helper.replace(/\.js$/, '.ts'), root), 'utf8'));
for (const entry of lifecycleContractCases(api)) test(entry.name, entry.run);
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
  assert.equal(lifecycleParent, '0a2776147d2b974c90ccc78995ae615efef669e1');
  assert.equal(hash(lifecycleFrozenSource), '9d4480ed739f349a60b67b344f4aa8c5d57c8408570b6c560017b291a14d2782');
  if (baseline) assert.equal(historical, lifecycleFrozenSource);
});
test('Node official erasure preserves complete ordered runtime AST and original import', { skip: baseline }, () => {
  assert.deepEqual(executableAst(executable), executableAst(lifecycleFrozenSource));
});
test('JS bridge exports only the identical TS lifecycle factory', { skip: baseline }, async () => {
  const typed = await import(new URL(helper.replace(/\.js$/, '.ts'), root));
  assert.deepEqual(Object.keys(api), ['createNoteDependencyLifecycle']);
  assert.deepEqual(Object.keys(typed), ['createNoteDependencyLifecycle']);
  assert.equal(api.createNoteDependencyLifecycle, typed.createNoteDependencyLifecycle);
  const program = parse(readFileSync(sourceUrl, 'utf8'), { sourceType: 'module' }).program;
  assert.deepEqual(program.directives, []);
  assert.equal(program.body.length, 1);
  const statement = program.body[0];
  assert.equal(statement.type, 'ExportNamedDeclaration');
  assert.equal(statement.declaration, null);
  assert.equal(statement.source.value, './note-dependency-lifecycle.ts');
  assert.equal(statement.specifiers.length, 1);
  assert.equal(statement.specifiers[0].type, 'ExportSpecifier');
  assert.equal(statement.specifiers[0].local.name, 'createNoteDependencyLifecycle');
  assert.equal(statement.specifiers[0].exported.name, 'createNoteDependencyLifecycle');
});
test('3072 fresh ordered old/new cases preserve sync reads receivers flatMap aliases and errors', () => {
  const outcomes = new Map(),
    operations = new Map();
  for (let seed = 0; seed < 3072; seed++) {
    const old = observeLifecycle(frozen, seed);
    assert.deepEqual(observeLifecycle(api, seed), old, 'Differential seed ' + seed);
    outcomes.set(old.outcome.kind, (outcomes.get(old.outcome.kind) ?? 0) + 1);
    operations.set(old.operation, (operations.get(old.operation) ?? 0) + 1);
  }
  for (const operation of ['content', 'deleted', 'before']) assert.equal(operations.get(operation), 1024);
  for (const outcome of ['returned', 'marker', 'AppError', 'TypeError'])
    assert.ok(outcomes.get(outcome) > 5, 'Missing differential outcome ' + outcome);
});
const mutations = [
  ['shadow omitted', '      annotationIdentityShadow.observe(note, annotationChange);\n', ''],
  [
    'shadow moved ahead of reconciliation',
    '      annotationIdentityShadow.observe(note, annotationChange);\n',
    '',
    1,
    'shadow-before'
  ],
  [
    'shadow moved after reconciliation ID traversal',
    '      annotationIdentityShadow.observe(note, annotationChange);\n',
    '',
    1,
    'shadow-after'
  ],
  ['coalescing omitted', '      coalescePreviousVersion(note, version, annotationChange);\n', ''],
  [
    'coalescing before final source notification',
    "      questionService.markSourcesStale('noteVersion', oldVersionIds);\n      coalescePreviousVersion(note, version, annotationChange);",
    "      coalescePreviousVersion(note, version, annotationChange);\n      questionService.markSourcesStale('noteVersion', oldVersionIds);"
  ],
  [
    'coalescer result incorrectly returned',
    '      coalescePreviousVersion(note, version, annotationChange);',
    '      return coalescePreviousVersion(note, version, annotationChange);'
  ],
  [
    'content hook becomes async and awaits shadow',
    'onNoteContentChanged: (note, version, annotationChange) => {',
    'onNoteContentChanged: async (note, version, annotationChange) => {',
    1,
    'await-shadow'
  ],
  ['deleted hook becomes async', 'onNoteDeleted: (noteId) => {', 'onNoteDeleted: async (noteId) => {'],
  [
    'guard hook becomes async',
    'onBeforePermanentDelete: (noteId) => {',
    'onBeforePermanentDelete: async (noteId) => {'
  ],
  ['flatMap changed to map', 'contentChangedAnnotationIds.flatMap', 'contentChangedAnnotationIds.map'],
  ['flatMap deep flattened two levels', '      ));\n      questionService', '      )).flat(2);\n      questionService'],
  [
    'flatMap accepts only arrays',
    'reconciliation.contentChangedAnnotationIds.flatMap',
    '(Array.isArray(reconciliation.contentChangedAnnotationIds) ? reconciliation.contentChangedAnnotationIds : []).flatMap'
  ],
  [
    'flatMap changed to iterable materialization',
    'reconciliation.contentChangedAnnotationIds.flatMap',
    '[...reconciliation.contentChangedAnnotationIds].flatMap'
  ],
  [
    'annotation IDs deduplicated',
    'reconciliation.contentChangedAnnotationIds.flatMap',
    '[...new Set(reconciliation.contentChangedAnnotationIds)].flatMap'
  ],
  [
    'flatMap records coerced to iterable spread',
    "knowledgeItemService.markEvidenceByAnnotationId(annotationId,\n          contentAnnotationRepository.findById(annotationId)?.anchorStatus === 'missing' ? 'insufficient' : 'stale')",
    "[...knowledgeItemService.markEvidenceByAnnotationId(annotationId,\n          contentAnnotationRepository.findById(annotationId)?.anchorStatus === 'missing' ? 'insufficient' : 'stale')]"
  ],
  [
    'annotation callee getter read after argument lookup',
    "knowledgeItemService.markEvidenceByAnnotationId(annotationId,\n          contentAnnotationRepository.findById(annotationId)?.anchorStatus === 'missing' ? 'insufficient' : 'stale')",
    "(() => { const annotation = contentAnnotationRepository.findById(annotationId); return knowledgeItemService.markEvidenceByAnnotationId(annotationId, annotation?.anchorStatus === 'missing' ? 'insufficient' : 'stale'); })()"
  ],
  ['anchor missing comparison widened to truthiness', "?.anchorStatus === 'missing'", '?.anchorStatus'],
  ['insufficient status removed', "? 'insufficient' : 'stale'", "? 'stale' : 'stale'"],
  [
    'old-version IDs deduplicated',
    'markEvidenceByNoteVersionIds(oldVersionIds,',
    'markEvidenceByNoteVersionIds([...new Set(oldVersionIds)],'
  ],
  ['old-version inequality becomes loose', 'id !== version.id', 'id != version.id'],
  ['old-version inequality becomes SameValueZero', 'id !== version.id', '!new Set([version.id]).has(id)'],
  [
    'note ID cached before reconciliation',
    '      const reconciliation =',
    '      const noteId = note.id;\n      const reconciliation =',
    1,
    'cache-note'
  ],
  [
    'version ID cached before filter',
    '      const oldVersionIds =',
    '      const versionId = version.id;\n      const oldVersionIds =',
    1,
    'cache-version'
  ],
  [
    'old-version array cloned before collaborator mutation',
    'markEvidenceByNoteVersionIds(oldVersionIds,',
    'markEvidenceByNoteVersionIds([...oldVersionIds],'
  ],
  [
    'final old-version IDs cloned',
    "markSourcesStale('noteVersion', oldVersionIds)",
    "markSourcesStale('noteVersion', [...oldVersionIds])"
  ],
  [
    'version evidence cascade omitted',
    "const directEvidence = knowledgeItemService.markEvidenceByNoteVersionIds(oldVersionIds, 'stale', 'noteVersion');",
    'const directEvidence = [];'
  ],
  [
    'empty evidence notifications skipped',
    "questionService.markSourcesStale('knowledgeEvidence', changed.map((evidence) => evidence.id));",
    "if (changed.length) questionService.markSourcesStale('knowledgeEvidence', changed.map((evidence) => evidence.id));",
    2
  ],
  [
    'empty old-version notification skipped',
    "questionService.markSourcesStale('noteVersion', oldVersionIds);",
    "if (oldVersionIds.length) questionService.markSourcesStale('noteVersion', oldVersionIds);"
  ],
  [
    'version filter restricted to Array conversion',
    'noteVersionService.listVersionIds({ noteId: note.id }).filter',
    'Array.from(noteVersionService.listVersionIds({ noteId: note.id })).filter'
  ],
  [
    'direct map restricted to Array conversion',
    'directEvidence.map((record) => record.id)',
    'Array.from(directEvidence).map((record) => record.id)'
  ],
  ['source type comparison made loose', "source.sourceType === 'noteVersion'", "source.sourceType == 'noteVersion'"],
  [
    'source type gate omitted',
    "source.sourceType === 'noteVersion'\n          && versionIds.has(source.sourceId)",
    'versionIds.has(source.sourceId)'
  ],
  [
    'Set membership replaced by indexOf',
    'versionIds.has(source.sourceId)',
    '[...versionIds].indexOf(source.sourceId) !== -1'
  ],
  [
    'Set keys stringified',
    'noteVersionRepository.list({ noteId }).map((version) => version.id)',
    'noteVersionRepository.list({ noteId }).map((version) => String(version.id))',
    1,
    'string-set'
  ],
  ['formal evidence length becomes truthiness', '.length > 0)', '.length)'],
  [
    'source some result normalized to boolean true',
    '        questionSourceRepository.list().some',
    '        true === questionSourceRepository.list().some'
  ],
  [
    'source some restricted to arrays',
    'questionSourceRepository.list().some',
    'Array.from(questionSourceRepository.list()).some'
  ],
  ['scope nullish list becomes mandatory', 'snapshot.noteVersions?.some', 'snapshot.noteVersions.some'],
  ['scope note ID comparison made loose', 'version.noteId === noteId', 'version.noteId == noteId'],
  [
    'scope getter condition reversed',
    'version.noteId === noteId || versionIds.has(version.noteVersionId)',
    'versionIds.has(version.noteVersionId) || version.noteId === noteId'
  ],
  [
    'question method detached from object receiver',
    'questionService.markSourcesStale(',
    '(0, questionService.markSourcesStale)(',
    5
  ],
  [
    'question method cached at factory time',
    '  return {',
    '  const notify = questionService.markSourcesStale;\n  return {',
    1,
    'cache-method'
  ],
  [
    'shadow receiver detached',
    'annotationIdentityShadow.observe(note, annotationChange)',
    '(0, annotationIdentityShadow.observe)(note, annotationChange)'
  ],
  [
    'coalescer given incorrect receiver',
    'coalescePreviousVersion(note, version, annotationChange)',
    'coalescePreviousVersion.call({}, note, version, annotationChange)'
  ],
  [
    'deleted evidence status changed',
    "markEvidenceByNoteId(noteId, 'invalid')",
    "markEvidenceByNoteId(noteId, 'stale')"
  ],
  ['conflict error code changed', "'NOTE_HAS_QUESTION_SOURCE'", "'NOTE_HAS_OTHER_SOURCE'"],
  [
    'conflict error message changed',
    "'Note has formal knowledge evidence and cannot be permanently deleted'",
    "'Evidence exists'"
  ],
  [
    'question guard moved ahead of evidence priority',
    '      if (knowledgeEvidenceRepository.list({ noteId }).length > 0) {',
    '      if (knowledgeEvidenceRepository.list({ noteId }).length > 0) {',
    1,
    'priority'
  ],
  [
    'evidence notification order reversed',
    'changed.map((evidence) => evidence.id)',
    'changed.slice().reverse().map((evidence) => evidence.id)',
    2
  ],
  [
    'factory unexpectedly accepts absent options',
    '  coalescePreviousVersion\n}) {',
    '  coalescePreviousVersion\n} = {}) {'
  ],
  [
    'shadow eagerly called during construction',
    '  return {',
    '  annotationIdentityShadow.observe({}, {});\n  return {'
  ],
  ['coalescer eagerly called during construction', '  return {', '  coalescePreviousVersion({}, {}, {});\n  return {']
];
for (const [label, from, to, expected = 1, special] of mutations)
  test('fixed assertions kill parsed executable mutant: ' + label, async t => {
    assert.equal(lifecycleFrozenSource.split(from).length - 1, expected, 'Exact mutation anchor: ' + label);
    let changed = lifecycleFrozenSource.replaceAll(from, to);
    if (special === 'shadow-before')
      changed = changed.replace(
        '      const reconciliation =',
        '      annotationIdentityShadow.observe(note, annotationChange);\n      const reconciliation ='
      );
    if (special === 'shadow-after')
      changed = changed.replace(
        '      ));\n      questionService',
        '      ));\n      annotationIdentityShadow.observe(note, annotationChange);\n      questionService'
      );
    if (special === 'await-shadow')
      changed = changed.replace(
        '      annotationIdentityShadow.observe',
        '      await annotationIdentityShadow.observe'
      );
    if (special === 'cache-note')
      changed = changed.replaceAll('note.id', 'noteId').replace('const noteId = noteId;', 'const noteId = note.id;');
    if (special === 'cache-version') changed = changed.replace('id !== version.id', 'id !== versionId');
    if (special === 'cache-method')
      changed = changed.replaceAll('questionService.markSourcesStale(', 'notify.call(questionService, ');
    if (special === 'string-set')
      changed = changed.replace('versionIds.has(source.sourceId)', 'versionIds.has(String(source.sourceId))');
    if (special === 'priority') {
      const start = changed.indexOf('      if (knowledgeEvidenceRepository'),
        end = changed.indexOf('      const versionIds =', start),
        evidence = changed.slice(start, end);
      changed = changed.slice(0, start) + changed.slice(end);
      changed = changed.replace('      if (analysisScopeRepository', evidence + '      if (analysisScopeRepository');
    }
    // 解析和真实导入是前置正例，语法/导入错误绝不能算作变异检出。
    executableAst(changed);
    const mutant = await loadSource(changed, label);
    assert.equal(typeof mutant.createNoteDependencyLifecycle, 'function');
    let killedBy;
    for (const entry of lifecycleContractCases(mutant)) {
      try {
        await assert.doesNotReject(async () => entry.run());
      } catch (error) {
        assert.equal(error.name, 'AssertionError');
        killedBy = entry.name;
        break;
      }
    }
    assert.ok(killedBy, 'Live mutation: ' + label);
    t.diagnostic('Behavior assertion: ' + killedBy);
  });
if (!baseline) {
  for (const entry of lifecycleConsumerCases(api)) test(entry.name, entry.run);
  const { noteDependencyLifecycleTests } = await import('./note-dependency-lifecycle.test.js');
  const moduleTest = noteDependencyLifecycleTests.find(
    entry => entry.name === '笔记依赖生命周期：真实本地模块入口采用装配后替换的服务方法并接通三个 hooks'
  );
  assert.ok(moduleTest);
  test('existing targeted .run: ' + moduleTest.name, moduleTest.run);
  const { noteVersionCoalescingTests } = await import('./note-version-coalescing.test.js');
  for (const entry of noteVersionCoalescingTests) test('existing targeted .run: ' + entry.name, entry.run);
  const { inlineAnnotationTests } = await import('./inline-annotations.test.js');
  const marks = inlineAnnotationTests.find(
    entry => entry.name === '只改标记的保存：旧版本证据和题目来源保持有效；真正改正文仍按原规则过期'
  );
  assert.ok(marks);
  test('existing targeted .run: ' + marks.name, marks.run);
}
