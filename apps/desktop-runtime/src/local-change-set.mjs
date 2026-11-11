import { LOCAL_DATA_COLLECTIONS } from '../../api/src/infrastructure/local-data-schema.ts';

const REFERENCE_FIELDS = {
  spaceId: 'spaces', folderId: 'folders', groupId: 'tagGroups', noteId: 'notes',
  noteVersionId: 'noteVersions', annotationId: 'contentAnnotations', parentAnnotationId: 'contentAnnotations',
  knowledgeItemId: 'knowledgeItems', learningObjectiveId: 'learningObjectives', examProfileId: 'examProfiles', questionId: 'questions'
};

export function entityReferences(change) {
  const value = change.value;
  if (!value) return [];
  const refs = Object.entries(REFERENCE_FIELDS).filter(([field]) => typeof value[field] === 'string')
    .map(([field, collection]) => ({ collection, id: value[field] }));
  if (change.collection === 'folders' && value.parentId) refs.push({ collection: 'folders', id: value.parentId });
  for (const id of value.tagIds ?? []) refs.push({ collection: 'tags', id });
  if (typeof value.rawMarkdown === 'string') {
    for (const match of value.rawMarkdown.matchAll(/\/api\/storage\/attachments\/([^/\s)]+)\/content/g)) {
      try { refs.push({ collection: 'attachments', id: decodeURIComponent(match[1]) }); } catch { /* 正文校验负责无效引用。 */ }
    }
  }
  return refs;
}

/** 队列保存领域实体差异，不保存 HTTP 请求；同一事务中的关联变化一起提交。 */
export function collectChanges(before, after) {
  const changes = [];
  for (const collection of LOCAL_DATA_COLLECTIONS) {
    const previous = new Map(before[collection].map(item => [item.id, item]));
    const next = new Map(after[collection].map(item => [item.id, item]));
    for (const id of new Set([...previous.keys(), ...next.keys()])) {
      const oldValue = previous.get(id) ?? null;
      const value = next.get(id) ?? null;
      if (JSON.stringify(oldValue) === JSON.stringify(value)) continue;
      changes.push({ collection, entityId: id, action: value === null ? 'delete' : 'upsert', before: oldValue, value });
    }
  }
  return changes;
}
