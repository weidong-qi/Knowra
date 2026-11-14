import { KNOWLEDGE_CONCEPT_COLLECTIONS } from '../../api/src/modules/sync/entity-contract.ts';
import { todoComponents } from './personal-todo-sync.mjs';
import { SYNC_CLIENT_BATCH_BODY_LIMIT_BYTES } from '@study-accelerator/shared/http-limits';
import { calculateContentHash } from '../../api/src/modules/knowledge/domain/note-version.ts';
import { syncKey } from '../../api/src/modules/sync/journal.ts';
import {
  referencesFor,
  changeReferencesFor,
  TRAINING_COLLECTIONS
} from '../../api/src/modules/sync/entity-contract.ts';

/** 当前笔记及标注保持原子提交；不可变的旧版本、旧修订在所属对象之后分批交付。 */
export function selectEntityBatch(
  changes,
  state,
  base,
  {
    maxEntries = 1000,
    maxBytes = SYNC_CLIENT_BATCH_BODY_LIMIT_BYTES,
    targetEntries = 250,
    targetBytes = 1024 * 1024,
    measureBytes = entries => Buffer.byteLength(JSON.stringify(entries))
  } = {}
) {
  const byKey = new Map(changes.map(entry => [syncKey(entry.collection, entry.id), entry]));
  const parents = new Map([...byKey.keys()].map(key => [key, key]));
  const root = key => {
    let cursor = key;
    while (parents.get(cursor) !== cursor) cursor = parents.get(cursor);
    return cursor;
  };
  const join = (a, b) => {
    if (parents.has(a) && parents.has(b)) parents.set(root(a), root(b));
  };
  const annotationNotes = new Map(state.contentAnnotations.map(item => [item.id, item.noteId]));
  const annotations = new Map(state.contentAnnotations.map(item => [item.id, item]));
  const versionsByHash = new Map(state.noteVersions.map(item => [`${item.noteId}:${item.contentHash}`, item.id]));
  const before = Object.fromEntries(Object.keys(state).map(collection => [collection, []]));
  for (const entry of base.values()) if (entry.value) before[entry.collection].push(entry.value);
  for (const entry of base.values())
    if (entry.collection === 'contentAnnotations' && entry.value) annotationNotes.set(entry.id, entry.value.noteId);
  // 同一关联树原子提交，独立树可以分批；移动同时考虑旧树与新树。
  const operationGroups = new Map();
  for (const entry of changes) {
    if (!KNOWLEDGE_CONCEPT_COLLECTIONS.includes(entry.collection)) continue;
    const key = syncKey(entry.collection, entry.id);
    for (const value of [entry.value, base.get(key)?.value]) {
      if (!value?.operationId) continue;
      if (operationGroups.has(value.operationId)) join(key, operationGroups.get(value.operationId));
      else operationGroups.set(value.operationId, key);
    }
    for (const ref of changeReferencesFor(entry, before, state)) join(key, syncKey(ref.collection, ref.id));
  }
  const components = todoComponents(before.personalTodos ?? [], state.personalTodos ?? []);
  const todoGroups = new Map();
  for (const entry of changes) {
    if (entry.collection !== 'personalTodos') continue;
    const component = components.get(entry.id) ?? entry.id;
    const key = syncKey(entry.collection, entry.id);
    if (todoGroups.has(component)) join(key, todoGroups.get(component));
    else todoGroups.set(component, key);
  }
  for (const entry of changes) {
    const value = entry.value ?? base.get(syncKey(entry.collection, entry.id))?.value;
    if (TRAINING_COLLECTIONS.includes(entry.collection))
      for (const ref of changeReferencesFor(entry, before, state))
        join(syncKey(entry.collection, entry.id), syncKey(ref.collection, ref.id));
    const noteId = value?.noteId ?? annotationNotes.get(value?.annotationId ?? value?.parentAnnotationId);
    const history =
      entry.value &&
      (entry.collection === 'noteVersions' ||
        (entry.collection === 'annotationRevisions' &&
          value.revision !== annotations.get(value.annotationId)?.revision));
    if (noteId && !history) join(syncKey(entry.collection, entry.id), syncKey('notes', noteId));
    if (value?.knowledgeItemId)
      join(syncKey(entry.collection, entry.id), syncKey('knowledgeItems', value.knowledgeItemId));
    if (entry.collection === 'knowledgeArtifactProvenance' && value?.artifactId) {
      join(syncKey(entry.collection, entry.id), syncKey('knowledgeItems', value.artifactId));
      for (const source of value.sources ?? [])
        join(syncKey(entry.collection, entry.id), syncKey('knowledgeEvidence', source.evidenceId));
    }
    const folderPackage =
      entry.collection === 'folders'
        ? (value?.deletionPackage ?? base.get(syncKey(entry.collection, entry.id))?.value?.deletionPackage)
        : null;
    if (folderPackage) {
      for (const id of folderPackage.folderIds ?? []) join(syncKey(entry.collection, entry.id), syncKey('folders', id));
      for (const id of folderPackage.noteIds ?? []) join(syncKey(entry.collection, entry.id), syncKey('notes', id));
    }
    // 标注独立修改时，当前修订、排除范围仍一起提交；旧修订只依赖所属标注。
    const annotationId = value?.annotationId ?? value?.parentAnnotationId;
    if (annotationId && !history)
      join(syncKey(entry.collection, entry.id), syncKey('contentAnnotations', annotationId));
    if (!history && value) {
      // 领域校验还要求正文当前版本和标注原始快照；它们不能被当成旧历史拆走。
      const versionIds = changeReferencesFor(entry, before, state)
        .filter(ref => ref.collection === 'noteVersions')
        .map(ref => ref.id);
      if (entry.collection === 'notes')
        versionIds.push(versionsByHash.get(`${entry.id}:${calculateContentHash(value.rawMarkdown)}`));
      if (entry.collection === 'contentAnnotations') versionIds.push(value.originSnapshot?.noteVersionId);
      for (const id of versionIds) if (id) join(syncKey(entry.collection, entry.id), syncKey('noteVersions', id));
    }
  }
  const deleted = new Set(changes.filter(entry => !entry.value).map(entry => syncKey(entry.collection, entry.id)));
  for (const entry of changes) {
    const old = base.get(syncKey(entry.collection, entry.id))?.value;
    for (const ref of referencesFor(entry.collection, old))
      if (deleted.has(syncKey(ref.collection, ref.id)))
        join(syncKey(entry.collection, entry.id), syncKey(ref.collection, ref.id));
  }
  const groups = new Map();
  for (const entry of changes) {
    const key = root(syncKey(entry.collection, entry.id));
    if (!groups.has(key)) groups.set(key, { entries: [], dependencies: new Set() });
    const group = groups.get(key);
    group.entries.push(entry);
  }
  for (const [key, group] of groups)
    for (const entry of group.entries)
      for (const ref of changeReferencesFor(entry, before, state)) {
        const refKey = syncKey(ref.collection, ref.id);
        if (byKey.has(refKey) && root(refKey) !== key) group.dependencies.add(root(refKey));
      }
  const selected = [];
  const completed = new Set();
  let progress = true;
  while (progress) {
    progress = false;
    for (const [key, group] of groups) {
      if (completed.has(key) || [...group.dependencies].some(dependency => !completed.has(dependency))) continue;
      if (group.entries.length > maxEntries || measureBytes(group.entries) > maxBytes) {
        if (selected.length) return selected;
        const failure = new Error(
          '当前正文及必要关联资料超过单次同步容量；本地修改已保留，请导出完整备份后检查超大正文或关联资料。'
        );
        failure.code = 'SYNC_ATOMIC_GROUP_TOO_LARGE';
        throw failure;
      }
      if (selected.length + group.entries.length > maxEntries) return selected;
      const combinedBytes = measureBytes([...selected, ...group.entries]);
      if (combinedBytes > maxBytes) return selected;
      // 小批次适应慢速上行；目标是软上限，合法的大原子组仍可独立交付。
      if (selected.length && (selected.length + group.entries.length > targetEntries || combinedBytes > targetBytes))
        return selected;
      selected.push(...group.entries);
      completed.add(key);
      progress = true;
    }
  }
  if (!selected.length && changes.length) throw new Error('关联资料存在无法安全分批的依赖，请导出备份后核对。');
  return selected;
}
