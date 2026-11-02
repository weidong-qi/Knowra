import { resolveAnalysisScopeNoteVersion } from '../knowledge/domain/analysis-scope-version-alias.ts';
import type { AnalysisScopeVersionBinding } from '../knowledge/domain/analysis-scope-version-alias.ts';
import { attachmentIdsInText } from '@study-accelerator/shared/attachments';
import { noteContent } from './journal.ts';
import type { SyncNoteContent } from './journal.ts';

interface SyncScopeSegment {
  noteVersionId?: string;
  noteId?: string;
  start: number;
  end: number;
  markdown: string;
}
/** 引用闭包只读取这些身份字段；实体正文仍由各自领域校验。 */
export interface SyncReferenceEntity {
  id: string;
  spaceId?: string | null;
  folderId?: string | null;
  groupId?: string | null;
  noteId?: string | null;
  noteVersionId?: string | null;
  annotationId?: string | null;
  parentAnnotationId?: string | null;
  knowledgeItemId?: string;
  learningObjectiveId?: string;
  examProfileId?: string;
  questionId?: string;
  parentId?: string | null;
  deletionPackage?: { id?: string; noteIds?: string[] } | null;
  tagIds?: string[];
  rawMarkdown?: string;
  sourceId?: string | null;
  sourceType?: string;
  contentHash?: string | null;
  content?: string;
  noteVersions?: AnalysisScopeVersionBinding[];
  annotationRevisions?: Array<{ annotationId: string }>;
  artifactId?: string;
  sources?: Array<{ evidenceId: string }>;
  segments?: SyncScopeSegment[];
  contextSegments?: SyncScopeSegment[];
}
export type SyncReferenceState = Record<string, SyncReferenceEntity[]>;
export interface SyncReferenceChange {
  collection: string;
  id: string;
  value: SyncReferenceEntity | null;
}
export interface SyncReference {
  collection: string;
  id: string;
}

// schema7 完整实体契约；人工训练资产与知识共用原子实体同步。
export const KNOWLEDGE_SYNC_CAPABILITY = 'knowledge-items-v1';
export const KNOWLEDGE_COLLECTIONS = Object.freeze([
  'knowledgeItems',
  'knowledgeEvidence',
  'knowledgeArtifactProvenance'
]);
export const TRAINING_SYNC_CAPABILITY = 'training-assets-v1';
export const TRAINING_COLLECTIONS = Object.freeze([
  'learningObjectives',
  'examProfiles',
  'examFocuses',
  'questions',
  'questionObjectives',
  'questionSources'
]);
export const WRITABLE_COLLECTIONS = Object.freeze([
  'spaces',
  'folders',
  'tagGroups',
  'tags',
  'notes',
  'noteVersions',
  'attachments',
  'contentAnnotations',
  'annotationExclusions',
  'annotationRevisions',
  'analysisScopeSnapshots',
  ...KNOWLEDGE_COLLECTIONS,
  ...TRAINING_COLLECTIONS
]);
export const IMMUTABLE_COLLECTIONS = new Set([
  'noteVersions',
  'annotationRevisions',
  'analysisScopeSnapshots',
  'knowledgeEvidence',
  'knowledgeArtifactProvenance'
]);
export function entityContent(collection: string, value: object | null | undefined): object | null {
  if (!value) return null;
  if (collection === 'notes') return canonical(noteContent(value as SyncNoteContent));
  const ignored = new Set(['createdAt', 'updatedAt']);
  if (collection === 'attachments') for (const key of ['verifiedAt', 'storagePath', 'status']) ignored.add(key);
  if (collection === 'folders') ignored.add('pathCache');
  if (collection === 'knowledgeEvidence') ignored.add('status'); // 来源健康由当前领域状态推导。
  if (collection === 'questionSources') ignored.add('status');
  return canonical(Object.fromEntries(Object.entries(value).filter(([key]) => !ignored.has(key))));
}
export const sameEntity = (collection: string, left: object | null | undefined, right: object | null | undefined) =>
  JSON.stringify(entityContent(collection, left)) === JSON.stringify(entityContent(collection, right));

export function referencesFor(collection: string, value: SyncReferenceEntity | null | undefined): SyncReference[] {
  if (!value) return [];
  const fields = {
    spaceId: 'spaces',
    folderId: 'folders',
    groupId: 'tagGroups',
    noteId: 'notes',
    noteVersionId: 'noteVersions',
    annotationId: 'contentAnnotations',
    parentAnnotationId: 'contentAnnotations',
    knowledgeItemId: 'knowledgeItems',
    learningObjectiveId: 'learningObjectives',
    examProfileId: 'examProfiles',
    questionId: 'questions'
  };
  const refs: SyncReference[] = Object.entries(fields)
    .filter(([field]) => value[field as keyof typeof fields])
    .map(([field, target]) => ({ collection: target, id: value[field as keyof typeof fields]! }));
  if (collection === 'folders' && value.parentId) refs.push({ collection: 'folders', id: value.parentId });
  if (collection === 'folders' && value.deletionPackage)
    for (const id of value.deletionPackage.noteIds ?? []) refs.push({ collection: 'notes', id });
  for (const id of value.tagIds ?? []) refs.push({ collection: 'tags', id });
  if (collection === 'notes')
    for (const id of attachmentIdsInText(value.rawMarkdown)) refs.push({ collection: 'attachments', id });
  if (collection === 'questionSources' && value.sourceId) {
    const target = (
      {
        knowledgeItem: 'knowledgeItems',
        learningObjective: 'learningObjectives',
        noteVersion: 'noteVersions',
        knowledgeEvidence: 'knowledgeEvidence'
      } as Record<string, string>
    )[value.sourceType!];
    if (target) refs.push({ collection: target, id: value.sourceId });
  }
  if (collection === 'analysisScopeSnapshots') {
    for (const version of value.noteVersions ?? [])
      refs.push({ collection: 'noteVersions', id: version.noteVersionId! });
    for (const revision of value.annotationRevisions ?? [])
      refs.push({ collection: 'contentAnnotations', id: revision.annotationId });
  }
  if (collection === 'knowledgeArtifactProvenance') {
    refs.push({ collection: 'knowledgeItems', id: value.artifactId! });
    for (const source of value.sources ?? []) refs.push({ collection: 'knowledgeEvidence', id: source.evidenceId });
  }
  return refs;
}

function canonical<T>(value: T): T | object {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, canonical(value[key as keyof T])])
  );
}

export function syncReferencesFor(
  collection: string,
  value: SyncReferenceEntity | null | undefined,
  state: SyncReferenceState
): SyncReference[] {
  const refs = referencesFor(collection, value).filter(
    ref => collection !== 'analysisScopeSnapshots' || ref.collection !== 'noteVersions'
  );
  if (collection === 'analysisScopeSnapshots' && value)
    for (const binding of value.noteVersions ?? []) {
      refs.push({
        collection: 'noteVersions',
        id: resolveAnalysisScopeNoteVersion(value, binding, state.noteVersions).id
      });
    }
  if (collection === 'knowledgeItems' && value)
    for (const evidence of state.knowledgeEvidence.filter(item => item.knowledgeItemId === value.id)) {
      refs.push({ collection: 'knowledgeEvidence', id: evidence.id }, ...referencesFor('knowledgeEvidence', evidence));
    }
  if (collection === 'knowledgeItems' && value)
    for (const record of state.knowledgeArtifactProvenance ?? []) {
      if (record.artifactId === value.id) refs.push({ collection: 'knowledgeArtifactProvenance', id: record.id });
    }
  if (collection === 'knowledgeArtifactProvenance' && value)
    for (const source of value.sources ?? []) {
      const evidence = state.knowledgeEvidence.find(item => item.id === source.evidenceId);
      if (evidence) refs.push(...referencesFor('knowledgeEvidence', evidence));
    }
  if (collection === 'questions' && value) {
    for (const childCollection of ['questionObjectives', 'questionSources'])
      for (const child of state[childCollection]) {
        if (child.questionId === value.id)
          refs.push({ collection: childCollection, id: child.id }, ...syncReferencesFor(childCollection, child, state));
      }
  }
  for (const ref of [...refs]) {
    if (ref.collection === 'learningObjectives') {
      const objective = state.learningObjectives.find(item => item.id === ref.id);
      if (objective) refs.push(...referencesFor('learningObjectives', objective));
    }
    if (collection === 'questionSources' && ref.collection === 'knowledgeEvidence') {
      const evidence = state.knowledgeEvidence.find(item => item.id === ref.id);
      if (evidence) refs.push(...referencesFor('knowledgeEvidence', evidence));
    }
    if (collection === 'questionSources' && ref.collection === 'noteVersions') {
      const version = state.noteVersions.find(item => item.id === ref.id);
      if (version) refs.push({ collection: 'notes', id: version.noteId! });
    }
  }
  return [...new Map(refs.map(ref => [JSON.stringify([ref.collection, ref.id]), ref])).values()];
}

/** 关系解除/换绑也依赖旧引用；缺席不是删除权限。 */
export function changeReferencesFor(
  change: SyncReferenceChange,
  before: SyncReferenceState,
  after: SyncReferenceState
): SyncReference[] {
  const refs = syncReferencesFor(change.collection, change.value, after);
  if (TRAINING_COLLECTIONS.includes(change.collection)) {
    const previous = before[change.collection].find(item => item.id === change.id);
    refs.push(...syncReferencesFor(change.collection, previous, before));
  }
  return [...new Map(refs.map(ref => [JSON.stringify([ref.collection, ref.id]), ref])).values()];
}
