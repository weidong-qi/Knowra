import type { PostgresTransactionHost } from '../postgres-transaction-port.ts';
import type { KnowledgeArtifactProvenance, PdfAnnotation, Prisma } from '@prisma/client';

type Awaitable<Value> = Value | PromiseLike<Value>;
interface MigrationModel<Row> {
  count(): Awaitable<number>;
  createMany(input: { data: Row[] }): Awaitable<{ count: number }>;
  deleteMany(): Awaitable<{ count: number }>;
}
interface MigrationRows {
  user: Prisma.UserCreateManyInput;
  knowledgeSpace: Prisma.KnowledgeSpaceCreateManyInput;
  folder: Prisma.FolderCreateManyInput;
  tagGroup: Prisma.TagGroupCreateManyInput;
  tag: Prisma.TagCreateManyInput;
  note: Prisma.NoteCreateManyInput;
  attachment: Prisma.AttachmentCreateManyInput;
  pdfAnnotation: Prisma.PdfAnnotationCreateManyInput;
  contentAnnotation: Prisma.ContentAnnotationCreateManyInput;
  annotationExclusion: Prisma.AnnotationExclusionCreateManyInput;
  annotationRevision: Prisma.AnnotationRevisionCreateManyInput;
  analysisScopeSnapshot: Prisma.AnalysisScopeSnapshotCreateManyInput;
  noteVersion: Prisma.NoteVersionCreateManyInput;
  knowledgeItem: Prisma.KnowledgeItemCreateManyInput;
  knowledgeEvidence: Prisma.KnowledgeEvidenceCreateManyInput;
  knowledgeArtifactProvenance: Prisma.KnowledgeArtifactProvenanceCreateManyInput;
  learningObjective: Prisma.LearningObjectiveCreateManyInput;
  examProfile: Prisma.ExamProfileCreateManyInput;
  examFocus: Prisma.ExamFocusCreateManyInput;
  question: Prisma.QuestionCreateManyInput;
  questionObjective: Prisma.QuestionObjectiveCreateManyInput;
  questionSource: Prisma.QuestionSourceCreateManyInput;
  knowledgeConcept: Prisma.KnowledgeConceptCreateManyInput;
  knowledgeConceptLink: Prisma.KnowledgeConceptLinkCreateManyInput;
  knowledgeConceptRelation: Prisma.KnowledgeConceptRelationCreateManyInput;
  personalTodo: Prisma.PersonalTodoCreateManyInput;
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
  knowledgeConcept: { findMany(): Awaitable<import('@prisma/client').KnowledgeConcept[]> };
  knowledgeConceptLink: { findMany(): Awaitable<import('@prisma/client').KnowledgeConceptLink[]> };
  knowledgeConceptRelation: { findMany(): Awaitable<import('@prisma/client').KnowledgeConceptRelation[]> };
  personalTodo: { findMany(): Awaitable<import('@prisma/client').PersonalTodo[]> };
  // 写端口使用 SDK 输入，读取保留原生 JSON 列。
  knowledgeArtifactProvenance: { findMany(): Awaitable<KnowledgeArtifactProvenance[]> };
  pdfAnnotation: { findMany(): Awaitable<PdfAnnotation[]> };
  syncJournal?: {
    findMany(): Awaitable<{ ownerId: string; payload: unknown }[]>;
    deleteMany(): Awaitable<{ count: number }>;
    create(input: { data: { ownerId: string; payload: Prisma.InputJsonValue } }): Awaitable<object>;
  };
};
export type MigrationClient =
  PostgresTransactionHost<MigrationTransaction> | (MigrationTransaction & { $transaction?: undefined });

/** 局部保留历史 JSON 投影；只扩展原 SDK 操作的入参视图，校验与拒绝仍由 SDK 执行。 */
export type MigrationWriteOperation<Operation extends (...args: never[]) => object, Input> = (
  input: Parameters<Operation>[0] | Input
) => ReturnType<Operation>;
