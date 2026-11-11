import type { PurgeTaskState } from '../../../infrastructure/purge-task-types.ts';
import type {
  AssessmentListOptions,
  LearningObjectiveRecord,
  ExamProfileRecord,
  ExamFocusRecord,
  QuestionRecord,
  QuestionObjectiveRecord,
  QuestionSourceRecord
} from '../infrastructure/assessment-repository.ts';
import type { AnalysisScopeRecord } from '../infrastructure/annotation-support-repositories.ts';

export type TrainingAssetKind = 'learningObjective' | 'examProfile' | 'examFocus' | 'question';
// 仓库历史值不在生命周期中重新验证或转换；共同视图仅列出预检与恢复读取的字段。
export interface TrainingAssetRecord
  extends LearningObjectiveRecord, ExamProfileRecord, ExamFocusRecord, QuestionRecord {
  sourceMode?: unknown;
  sourceType?: unknown;
}
type Result<T, Async extends boolean> = Async extends true ? T | PromiseLike<T> : T;
interface AssetRepository<Async extends boolean> {
  findById(id: unknown): Result<TrainingAssetRecord | null, Async>;
  save(record: TrainingAssetRecord): Result<TrainingAssetRecord | null, Async>;
  delete(id: unknown): Result<object | number | null | undefined, Async>;
}
interface FocusRepository<Async extends boolean> extends AssetRepository<Async> {
  list(options: AssessmentListOptions): Result<ExamFocusRecord[], Async>;
}
interface ObjectiveLinks<Async extends boolean> {
  listByObjectiveId(id: unknown): Result<QuestionObjectiveRecord[], Async>;
  listByQuestionIds(ids: unknown[]): Result<QuestionObjectiveRecord[], Async>;
  deleteByQuestionId(id: unknown): Result<object | number | null | undefined, Async>;
}
interface QuestionSources<Async extends boolean> {
  list(): Result<QuestionSourceRecord[], Async>;
  listByQuestionIds(ids: unknown[]): Result<QuestionSourceRecord[], Async>;
  markBySourceIds(sourceType: string, ids: unknown[], status: string): Result<QuestionSourceRecord[], Async>;
  deleteByQuestionId(id: unknown): Result<object | number | null | undefined, Async>;
}
export interface TrainingRepositories<Async extends boolean> {
  learningObjectiveRepository: AssetRepository<Async>;
  examProfileRepository: AssetRepository<Async>;
  examFocusRepository: FocusRepository<Async>;
  questionRepository: AssetRepository<Async>;
  questionObjectiveRepository: ObjectiveLinks<Async>;
  questionSourceRepository: QuestionSources<Async>;
  knowledgeItemRepository: { findById(id: unknown): Result<{ deletedAt?: unknown } | null, Async> };
  analysisScopeRepository?: { list?(options: { includeDeleted: true }): Result<AnalysisScopeRecord[], Async> };
}
interface SharedDependencies<Async extends boolean> {
  repositories: TrainingRepositories<Async>;
  getTombstone?:
    ((collection: string, id: string) => Result<{ previousUpdatedAt?: unknown } | null | undefined, Async>) | null;
  readPurgeTaskState?: (() => Async extends true ? PurgeTaskState | Promise<PurgeTaskState> : PurgeTaskState) | null;
  getPurgeDatasetEpoch?: (() => Result<string | null | undefined, Async>) | null;
}
export interface TrainingAssetDependencies extends SharedDependencies<true> {
  runTransaction?<T>(operation: (repositories: TrainingRepositories<true>) => T | PromiseLike<T>): T | PromiseLike<T>;
}
export interface LocalTrainingAssetDependencies extends SharedDependencies<false> {
  runTransaction?<T>(operation: () => T): T;
}
export interface TrainingPurgeInput {
  expectedDatasetEpoch?: unknown;
}
export interface TrainingReference {
  collection: string;
  id: unknown;
  action: string;
  relatedAsset?: { kind: string; id: unknown };
  reasonCode?: string;
  message?: string;
}
export interface TrainingPreflight {
  asset: { type: TrainingAssetKind; id: string };
  operation: string;
  expectedUpdatedAt: unknown;
  decision: string;
  references: TrainingReference[];
  exclusiveRecords: { questionObjectives?: unknown[]; questionSources?: unknown[] };
  coverage: { persistedCurrentAndHistory: boolean; runningTasks: string; offlineDevices: string; backups: string };
}
