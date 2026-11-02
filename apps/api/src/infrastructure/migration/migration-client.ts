import type { PostgresTransactionHost } from '../postgres-transaction-port.ts';
import type * as rows from './db-mappers.js';

type Awaitable<Value> = Value | PromiseLike<Value>;
interface MigrationModel<Row> {
  count(): Awaitable<number>;
  createMany(input: { data: Row[] }): Awaitable<{ count: number }>;
  deleteMany(): Awaitable<{ count: number }>;
}
interface MigrationRows {
  user: ReturnType<typeof rows.dbUser>;
  knowledgeSpace: ReturnType<typeof rows.dbSpace>;
  folder: ReturnType<typeof rows.dbFolder>;
  tagGroup: ReturnType<typeof rows.dbTagGroup>;
  tag: ReturnType<typeof rows.dbTag>;
  note: ReturnType<typeof rows.dbNote>;
  attachment: ReturnType<typeof rows.dbAttachment>;
  contentAnnotation: ReturnType<typeof rows.dbAnnotation>;
  annotationExclusion: ReturnType<typeof rows.dbAnnotationExclusion>;
  annotationRevision: ReturnType<typeof rows.dbAnnotationRevision>;
  analysisScopeSnapshot: ReturnType<typeof rows.dbAnalysisScopeSnapshot>;
  noteVersion: ReturnType<typeof rows.dbNoteVersion>;
  knowledgeItem: ReturnType<typeof rows.dbKnowledgeItem>;
  knowledgeEvidence: ReturnType<typeof rows.dbKnowledgeEvidence>;
  knowledgeArtifactProvenance: ReturnType<typeof rows.dbKnowledgeArtifactProvenance>;
  learningObjective: ReturnType<typeof rows.dbLearningObjective>;
  examProfile: ReturnType<typeof rows.dbExamProfile>;
  examFocus: ReturnType<typeof rows.dbExamFocus>;
  question: ReturnType<typeof rows.dbQuestion>;
  questionObjective: ReturnType<typeof rows.dbQuestionObjective>;
  questionSource: ReturnType<typeof rows.dbQuestionSource>;
  noteTag: { noteId: string; tagId: string };
}
export type MigrationTransaction = {
  [Name in keyof MigrationRows]: MigrationModel<MigrationRows[Name]> &
    (Name extends 'user' | 'noteTag'
      ? object
      : {
          findMany(): Awaitable<MigrationRows[Name][]>;
          findMany(options: { select: { id: true } }): Awaitable<{ id: string }[]>;
        });
} & {
  syncJournal?: {
    findMany(): Awaitable<{ ownerId: string; payload: unknown }[]>;
    deleteMany(): Awaitable<{ count: number }>;
    create(input: {
      data: { ownerId: string; payload: ReturnType<typeof import('../../modules/sync/journal.js').createJournal> };
    }): Awaitable<object>;
  };
};
export type MigrationClient =
  PostgresTransactionHost<MigrationTransaction> | (MigrationTransaction & { $transaction?: undefined });
