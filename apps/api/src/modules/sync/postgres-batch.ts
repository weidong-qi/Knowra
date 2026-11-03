import type { SyncStoredState, SyncStoredEntity } from './domain-types.ts';
import type {
  SyncPostgresTransaction,
  SyncTable,
  SyncTouched,
  SyncUpsertInput,
  SyncUpsertCall,
  SyncDeleteCall,
  SyncWriteMapper
} from './postgres-types.ts';
import * as dbMaps from '../../infrastructure/migration/db-mappers.js';

const tables = [
  ['spaces', 'knowledgeSpace', 'dbSpace'],
  ['tagGroups', 'tagGroup', 'dbTagGroup'],
  ['folders', 'folder', 'dbFolder'],
  ['tags', 'tag', 'dbTag'],
  ['notes', 'note', 'dbNote'],
  ['noteVersions', 'noteVersion', 'dbNoteVersion'],
  ['attachments', 'attachment', 'dbAttachment'],
  ['analysisScopeSnapshots', 'analysisScopeSnapshot', 'dbAnalysisScopeSnapshot'],
  ['contentAnnotations', 'contentAnnotation', 'dbAnnotation'],
  ['annotationExclusions', 'annotationExclusion', 'dbAnnotationExclusion'],
  ['annotationRevisions', 'annotationRevision', 'dbAnnotationRevision'],
  ['knowledgeItems', 'knowledgeItem', 'dbKnowledgeItem'],
  ['knowledgeEvidence', 'knowledgeEvidence', 'dbKnowledgeEvidence'],
  ['knowledgeArtifactProvenance', 'knowledgeArtifactProvenance', 'dbKnowledgeArtifactProvenance'],
  ['learningObjectives', 'learningObjective', 'dbLearningObjective'],
  ['examProfiles', 'examProfile', 'dbExamProfile'],
  ['examFocuses', 'examFocus', 'dbExamFocus'],
  ['questions', 'question', 'dbQuestion'],
  ['questionObjectives', 'questionObjective', 'dbQuestionObjective'],
  ['questionSources', 'questionSource', 'dbQuestionSource']
] as const satisfies readonly SyncTable[];

/** 返回本次实际写入或删除的实体 ID（按集合），供事务结尾按 ID 重读后像。 */
export async function applyPostgresState(
  db: SyncPostgresTransaction,
  before: SyncStoredState,
  after: SyncStoredState
): Promise<SyncTouched> {
  const touched = Object.fromEntries(tables.map(([collection]) => [collection, new Set<string>()])) as SyncTouched;
  // 同一唯一组合的旧关系可能在离线解除后以新身份重建；先释放旧组合。
  const linkIds = new Set(after.questionObjectives.map(item => item.id));
  const removedLinks = before.questionObjectives.filter(item => !linkIds.has(item.id));
  if (removedLinks.length)
    await db.questionObjective.deleteMany({ where: { id: { in: removedLinks.map(item => item.id) } } });
  for (const item of removedLinks) touched.questionObjectives.add(item.id);
  const oldNotes = new Map(before.notes.map(note => [note.id, note]));
  const nextNotes = new Set(after.notes.map(note => note.id));
  const changedNotes = after.notes.filter(note => JSON.stringify(note) !== JSON.stringify(oldNotes.get(note.id)));
  const removedNotes = before.notes.filter(note => !nextNotes.has(note.id));
  for (const note of [...changedNotes, ...removedNotes]) await db.noteTag.deleteMany({ where: { noteId: note.id } });
  for (const [collection, model, mapper] of tables) {
    const previous = new Map(before[collection].map(item => [item.id, item] as const));
    let items = after[collection].filter(item => JSON.stringify(item) !== JSON.stringify(previous.get(item.id)));
    if (collection === 'folders') {
      const depth = (item: SyncStoredEntity) => {
        let n = 0;
        for (let p = item.parentId; p; n++) p = after.folders.find(folder => folder.id === p)?.parentId;
        return n;
      };
      items = items.sort((a, b) => depth(a) - depth(b));
    }
    for (const item of items) {
      touched[collection].add(item.id);
      const normalized =
        collection === 'notes'
          ? { ...(item as SyncStoredEntity<'notes'>), deletedAt: item.deleted ? item.updatedAt : null }
          : item;
      const data = (dbMaps[mapper] as SyncWriteMapper<typeof collection>)(normalized);
      await (db[model].upsert as (typeof db)[typeof model]['upsert'] & SyncUpsertCall<typeof collection>)({
        where: { id: item.id },
        create: data,
        update: data
      } satisfies SyncUpsertInput<typeof collection>);
    }
  }
  for (const note of changedNotes)
    if (note.tagIds.length)
      await db.noteTag.createMany({ data: note.tagIds.map(tagId => ({ noteId: note.id, tagId })) });
  for (const [collection, model] of [...tables].reverse()) {
    const present = new Set(after[collection].map(item => item.id));
    const removed = before[collection].filter(item => !present.has(item.id));
    // 自引用目录一起删除，数据库在语句结束时检查外键。
    if (removed.length)
      await (db[model].deleteMany as (typeof db)[typeof model]['deleteMany'] & SyncDeleteCall)({
        where: { id: { in: removed.map(item => item.id) } }
      });
    for (const item of removed) touched[collection].add(item.id);
  }
  return touched;
}
