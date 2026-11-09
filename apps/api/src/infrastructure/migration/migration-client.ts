import type { PostgresTransactionHost } from '../postgres-transaction-port.ts';
import type * as rows from './db-mappers.js';
import type { KnowledgeArtifactProvenance } from '@prisma/client';

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
  pdfAnnotation: {
    id: string;
    noteId: string;
    revision: number;
    payload: import('@study-accelerator/shared/pdf').PdfAnnotation;
  };
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
  personalTodo: ReturnType<typeof rows.dbPersonalTodo>;
  noteTag: { noteId: string; tagId: string };
}
export type MigrationTransaction = {
  [Name in keyof MigrationRows]: MigrationModel<MigrationRows[Name]> &
    (Name extends 'user' | 'noteTag'
      ? object
      : {
          findMany(options: { select: { id: true } }): Awaitable<{ id: string }[]>;
        });
} & {
  // createMany 使用 mapper 的写入形状；读取仍是 Prisma 原生 JSON 列。
  knowledgeArtifactProvenance: { findMany(): Awaitable<KnowledgeArtifactProvenance[]> };
  pdfAnnotation: { findMany(): Awaitable<MigrationRows['pdfAnnotation'][]> };
  syncJournal?: {
    findMany(): Awaitable<{ ownerId: string; payload: unknown }[]>;
    deleteMany(): Awaitable<{ count: number }>;
    create(input: {
      data: { ownerId: string; payload: ReturnType<typeof import('../../modules/sync/journal.ts').createJournal> };
    }): Awaitable<object>;
  };
};
export type MigrationClient =
  PostgresTransactionHost<MigrationTransaction> | (MigrationTransaction & { $transaction?: undefined });
