import type * as Models from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { NavigationDates } from './navigation-repository-types.ts';
import type { KnowledgeArtifactProvenance } from '../../domain/knowledge-artifact-provenance-contract.ts';

export interface QuestionWriteInput extends NavigationDates {
  id: string;
  questionType: string;
  stem: string;
  options?: unknown;
  referenceAnswer?: unknown;
  rubric?: unknown;
  explanation?: string | null;
  difficulty?: string | null;
  reviewStatus: string;
  sourceMode: string;
  version: number;
  deletedAt?: unknown;
}
export interface ItemWriteInput extends NavigationDates {
  id: string;
  title: string;
  canonicalStatement: string;
  userExplanation?: unknown;
  knowledgeType?: unknown;
  importance?: unknown;
  reviewStatus?: string | null;
  sourceMode?: unknown;
  deletedAt?: unknown;
}
export interface EvidenceWriteInput extends NavigationDates {
  id: string;
  knowledgeItemId: string;
  sourceType: string;
  sourceId?: string | null;
  noteId?: string | null;
  noteVersionId?: string | null;
  annotationId?: string | null;
  quoteText?: unknown;
  headingPath?: unknown;
  relationType?: string | null;
  status?: string | null;
  applicabilityStatus?: string | null;
}
type Dates = { createdAt: Date; updatedAt: Date };
export type QuestionWriteData = Omit<QuestionWriteInput, keyof Dates | 'deletedAt' | 'explanation' | 'difficulty'> &
  Dates & { deletedAt: Date | null; explanation: string; difficulty: string | null };
export type ItemWriteData = Omit<ItemWriteInput, keyof Dates | 'deletedAt' | 'importance'> &
  Dates & { deletedAt: Date | null; importance: number | null };
export type EvidenceWriteData = Omit<EvidenceWriteInput, keyof Dates> & Dates;
export interface ProvenanceWriteData {
  id: string;
  artifactId: string;
  schemaVersion: KnowledgeArtifactProvenance['schemaVersion'];
  state: KnowledgeArtifactProvenance['state'];
  provenanceHash: string;
  payload: KnowledgeArtifactProvenance;
}
export interface QuestionListOptions {
  reviewStatus?: string;
  includeArchived?: unknown;
  includeDeleted?: unknown;
  limit?: unknown;
}
export interface ItemListOptions {
  reviewStatus?: string;
  query?: unknown;
  includeArchived?: boolean | string;
  includeDeleted?: boolean | string;
}
export interface ReviewWhere {
  reviewStatus?: string | { not: 'archived' };
  deletedAt?: null;
}
export interface EvidenceWhere {
  knowledgeItemId?: unknown;
  noteId?: unknown;
  noteVersionId?: unknown;
  annotationId?: unknown;
  sourceType?: string;
  id?: { in: string[] };
  status?: string | { not: string } | { notIn: string[] };
}
interface ReadCreateDelegate<Row, Data, Where, Identity = { id: unknown }> {
  create(input: { data: Data }): PromiseLike<Row>;
  findUnique(input: { where: Identity }): PromiseLike<Row | null>;
  findMany(input: {
    where: Where;
    orderBy?: { updatedAt: 'desc' } | { createdAt: 'asc' } | { id: 'asc' };
    take?: number;
  }): PromiseLike<Row[]>;
}
interface UpsertInput<Data> {
  where: { id: string };
  create: Data;
  update: Partial<Data>;
}
export interface QuestionDelegate extends ReadCreateDelegate<Models.Question, QuestionWriteData, ReviewWhere> {
  upsert(input: UpsertInput<QuestionWriteData>): PromiseLike<Models.Question>;
  delete(input: { where: { id: unknown } }): PromiseLike<Models.Question>;
}
export interface ItemDelegate extends ReadCreateDelegate<
  Models.KnowledgeItem,
  ItemWriteData,
  Prisma.KnowledgeItemWhereInput
> {
  upsert(input: UpsertInput<ItemWriteData>): PromiseLike<Models.KnowledgeItem>;
  delete(input: { where: { id: unknown } }): PromiseLike<Models.KnowledgeItem>;
  updateMany(input: {
    where: { id: string; updatedAt: Date };
    data: Partial<ItemWriteData>;
  }): PromiseLike<{ count: number }>;
}
export interface EvidenceDelegate extends ReadCreateDelegate<
  Models.KnowledgeEvidence,
  EvidenceWriteData,
  EvidenceWhere
> {
  upsert(input: UpsertInput<EvidenceWriteData>): PromiseLike<Models.KnowledgeEvidence>;
  updateMany(input: {
    where: { id: { in: string[] } };
    data: { status: string; updatedAt: Date };
  }): PromiseLike<{ count: number }>;
  deleteMany(input: { where: { knowledgeItemId: unknown } }): PromiseLike<{ count: number }>;
}
type ProvenanceIdentity = { id: unknown } | { artifactId: unknown };
export interface ProvenanceDelegate extends ReadCreateDelegate<
  Models.KnowledgeArtifactProvenance,
  ProvenanceWriteData,
  { artifactId?: unknown },
  ProvenanceIdentity
> {
  updateMany(input: {
    where: { id: string; state: 'legacy-unavailable'; provenanceHash: string };
    data: ProvenanceWriteData;
  }): PromiseLike<{ count: number }>;
  deleteMany(input: { where: { artifactId: unknown } }): PromiseLike<{ count: number }>;
}
export interface QuestionRepositoryOptions {
  db: { question: QuestionDelegate };
}
export interface ItemRepositoryOptions {
  db: { knowledgeItem: ItemDelegate; $queryRawUnsafe(sql: string, id: unknown): PromiseLike<unknown> };
}
export interface EvidenceRepositoryOptions {
  db: { knowledgeEvidence: EvidenceDelegate };
}
export interface ProvenanceRepositoryOptions {
  db: { knowledgeArtifactProvenance: ProvenanceDelegate };
}

/** 原 HTTP/JSON 查询值只被局部检查，不能当作完整 Prisma 查询。 */
export interface NoteQueryOptions {
  deletedOnly?: unknown;
  includeDeleted?: unknown;
  spaceId?: unknown;
  folderId?: unknown;
  contentKind?: unknown;
  favoriteOnly?: unknown;
  tagIds?: unknown;
  match?: unknown;
  tagMatch?: unknown;
  tagId?: unknown;
  sortBy?: unknown;
  order?: unknown;
}
export interface NoteWhereProjection {
  deletedAt?: null | { not: null };
  spaceId?: unknown;
  folderId?: unknown;
  contentKind?: unknown;
  favorite?: true;
  noteTags?: { some: { tagId: unknown } };
  AND?: unknown;
}
export interface RawTagIds extends Iterable<unknown> {
  readonly length: number;
}
export interface NoteTagWritePort {
  noteTag: {
    deleteMany(input: { where: { noteId: unknown } }): PromiseLike<{ count: number }>;
    createMany(input: { data: { noteId: unknown; tagId: unknown }[] }): PromiseLike<{ count: number }>;
  };
}
