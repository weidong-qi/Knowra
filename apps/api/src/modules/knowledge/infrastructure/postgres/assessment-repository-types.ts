import type * as Models from '@prisma/client';
import type { NavigationDates } from './navigation-repository-types.ts';
import type { Prisma } from '@prisma/client';

export interface ObjectiveWriteInput extends NavigationDates {
  id: string;
  knowledgeItemId: string;
  objective: string;
  actionVerb: string;
  cognitiveLevel: string;
  difficultyHint?: unknown;
  reviewStatus: string;
  reviewNote?: string | null;
  deletedAt?: unknown;
  order: number;
}
export interface ProfileWriteInput extends NavigationDates {
  id: string;
  name: string;
  description?: string | null;
  scope?: unknown;
  language?: string | null;
  commonQuestionTypes?: unknown;
  difficultyProfile?: unknown;
  archivedAt?: unknown;
  deletedAt?: unknown;
}
export interface FocusWriteInput extends NavigationDates {
  id: string;
  examProfileId: string;
  learningObjectiveId: string;
  description?: string | null;
  priority: number;
  difficultyHint?: unknown;
  questionTypeSuggestions?: unknown;
  sourceType?: string | null;
  reviewStatus?: string | null;
  deletedAt?: unknown;
}
// SQL 输入与未校验的仓储输入分开，JSON 写值使用 Prisma 的完整哨兵类型。
export type ObjectiveWriteData = Prisma.LearningObjectiveUncheckedCreateInput;
export type ProfileWriteData = Prisma.ExamProfileUncheckedCreateInput;
export type FocusWriteData = Prisma.ExamFocusUncheckedCreateInput;
export interface ReviewListOptions {
  reviewStatus?: string;
  includeArchived?: boolean;
  includeDeleted?: boolean;
}
export interface ObjectiveListOptions extends ReviewListOptions {
  knowledgeItemId?: string;
}
export interface FocusListOptions extends ReviewListOptions {
  examProfileId?: string;
  learningObjectiveId?: string;
}
export interface ReviewWhere {
  reviewStatus?: string | { not: 'archived' };
  deletedAt?: null;
}
export interface ObjectiveWhere extends ReviewWhere {
  knowledgeItemId?: string;
}
export interface FocusWhere extends ReviewWhere {
  examProfileId?: string;
  learningObjectiveId?: string;
}
export interface ProfileWhere {
  archivedAt?: null;
  deletedAt?: null;
}
export interface ReviewOrder {
  order?: 'asc';
  priority?: 'asc';
  createdAt?: 'asc';
  updatedAt?: 'desc';
}
type IdWhere = { id: string };
type FocusIdentity =
  IdWhere | { examProfileId_learningObjectiveId: { examProfileId: string; learningObjectiveId: string } };
export interface AssessmentDelegate<Row, Data, Where, Identity = IdWhere> {
  create(input: { data: Data }): PromiseLike<Row>;
  upsert(input: { where: { id: string }; create: Data; update: Partial<Data> }): PromiseLike<Row>;
  findUnique(input: { where: Identity }): PromiseLike<Row | null>;
  findMany(input: { where: Where; orderBy: ReviewOrder | ReviewOrder[] }): PromiseLike<Row[]>;
  delete(input: { where: IdWhere }): PromiseLike<Row>;
}
export interface ObjectiveDelegate extends AssessmentDelegate<
  Models.LearningObjective,
  ObjectiveWriteData,
  ObjectiveWhere,
  IdWhere
> {
  updateMany(input: {
    where: { id: string; updatedAt: Date };
    data: Partial<ObjectiveWriteData>;
  }): PromiseLike<{ count: number }>;
}
export interface ObjectiveRepositoryOptions {
  db: { learningObjective: ObjectiveDelegate; $queryRawUnsafe(sql: string, id: string): PromiseLike<unknown> };
}
export interface ProfileRepositoryOptions {
  db: { examProfile: AssessmentDelegate<Models.ExamProfile, ProfileWriteData, ProfileWhere> };
}
export interface FocusRepositoryOptions {
  db: { examFocus: AssessmentDelegate<Models.ExamFocus, FocusWriteData, FocusWhere, FocusIdentity> };
}
export interface RelationIds extends Iterable<unknown> {
  readonly length: number;
}
export interface ObjectiveRelationWhere {
  questionId?: string | { in: string[] };
  learningObjectiveId?: string;
}
export interface ObjectiveRelationDelegate {
  findMany(input: {
    where: ObjectiveRelationWhere;
    orderBy?: { order: 'asc' };
  }): PromiseLike<Models.QuestionObjective[]>;
  deleteMany(input: { where: { questionId: string } }): PromiseLike<{ count: number }>;
  createMany(input: { data: Prisma.QuestionObjectiveCreateManyInput[] }): PromiseLike<{ count: number }>;
}
export interface ObjectiveRelationRepositoryOptions {
  db: { questionObjective: ObjectiveRelationDelegate };
}

/** 本库的 SDK 回读或四参数 helper 输出；动态关系元素仍未经验证。 */
export interface ObjectiveProjection {
  id: string;
  questionId: string;
  learningObjectiveId: unknown;
  isPrimary: boolean;
  order: number;
  createdAt: Date;
}
export interface MappedObjectiveProjection<Input extends ObjectiveProjection = ObjectiveProjection> {
  id: Input['id'];
  questionId: Input['questionId'];
  learningObjectiveId: Input['learningObjectiveId'];
  isPrimary: boolean;
  order: number;
  createdAt: string;
}
export interface SourceWriteInput extends NavigationDates {
  id?: unknown;
  sourceType: string;
  sourceId?: unknown;
  quote: string;
  locator?: object | null;
  contentHash?: unknown;
  status: string;
}
export interface SourceProjection extends Omit<SourceWriteInput, 'locator' | 'createdAt' | 'updatedAt'> {
  id: unknown;
  questionId: string;
  locator: unknown;
  createdAt: Date;
  updatedAt: Date;
}
export type SourceWriteData = Prisma.QuestionSourceCreateManyInput;
export interface MappedSourceProjection<Input extends SourceProjection = SourceProjection> {
  id: Input['id'];
  questionId: Input['questionId'];
  sourceType: Input['sourceType'];
  sourceId: NonNullable<Input['sourceId']> | null;
  quote: NonNullable<Input['quote']> | '';
  locator: Input['locator'] | null;
  contentHash: NonNullable<Input['contentHash']> | null;
  status: NonNullable<Input['status']> | 'active';
  createdAt: string;
  updatedAt: string;
}
export interface SourceWhere {
  questionId?: string | { in: string[] };
  sourceType?: string;
  sourceId?: { in: string[] };
  status?: { not: string };
}
export interface SourceDelegate {
  findUnique(input: { where: IdWhere }): PromiseLike<Models.QuestionSource | null>;
  findMany(input: { where: SourceWhere; orderBy?: { createdAt: 'asc' } }): PromiseLike<Models.QuestionSource[]>;
  deleteMany(input: { where: { questionId: string } }): PromiseLike<{ count: number }>;
  createMany(input: { data: SourceWriteData[] }): PromiseLike<{ count: number }>;
  updateMany(input: {
    where: { id: { in: string[] } };
    data: { status: string; updatedAt: Date };
  }): PromiseLike<{ count: number }>;
}
export interface SourceRepositoryOptions {
  db: { questionSource: SourceDelegate };
}
