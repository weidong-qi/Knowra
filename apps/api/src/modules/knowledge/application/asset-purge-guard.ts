import type { PurgeTaskState } from '../../../infrastructure/purge-task-types.ts';
interface TaskCoverageReference {
  collection: 'persistedTasks';
  reasonCode: 'TASK_REFERENCE_COVERAGE_UNAVAILABLE';
  action: 'repair-or-verify-task-history';
  message: string;
}
interface TaskCoverage {
  runningTasks: 'verified' | 'unverified';
  references: TaskCoverageReference[];
}
interface PurgeEpochInput {
  expectedDatasetEpoch?: unknown;
}
import { createAppError } from '../../../errors/app-error.ts';
import { verifyPurgeTaskState } from '../../../infrastructure/asset-purge-task-state.ts';

export function taskCoverage(read?: (() => PurgeTaskState) | null): TaskCoverage {
  try {
    if (read) verifyPurgeTaskState(read());
    return { runningTasks: 'verified', references: [] };
  } catch {
    return unavailableTaskCoverage();
  }
}
export async function asyncTaskCoverage(
  read?: (() => Promise<PurgeTaskState> | PurgeTaskState) | null
): Promise<TaskCoverage> {
  try {
    if (read) verifyPurgeTaskState(await read());
    return { runningTasks: 'verified', references: [] };
  } catch {
    return unavailableTaskCoverage();
  }
}
function unavailableTaskCoverage(): TaskCoverage {
  return {
    runningTasks: 'unverified',
    references: [
      {
        collection: 'persistedTasks',
        reasonCode: 'TASK_REFERENCE_COVERAGE_UNAVAILABLE',
        action: 'repair-or-verify-task-history',
        message: '持久化任务或提炼历史不可读，或包含尚未支持的资产引用，无法确认可以安全永久清理。'
      }
    ]
  };
}
export function supplementPurgePreview<Preview extends { references: object[]; decision: string; coverage: object }>(
  preflight: Preview,
  coverage: TaskCoverage,
  epoch?: string | null
) {
  const references = [...preflight.references, ...coverage.references];
  return {
    ...preflight,
    references,
    decision:
      preflight.decision === 'can-purge-no-history' && references.length
        ? 'requires-dependency-action'
        : preflight.decision,
    ...(epoch ? { expectedDatasetEpoch: epoch } : {}),
    coverage: { ...preflight.coverage, runningTasks: coverage.runningTasks }
  };
}
export function assertPurgeDatasetEpoch(input: PurgeEpochInput, epoch?: string | null) {
  if (!Object.hasOwn(input, 'expectedDatasetEpoch')) return;
  const expected = input.expectedDatasetEpoch;
  if (typeof expected !== 'string' || !expected.trim() || expected.trim() !== expected || expected.length > 200) {
    throw createAppError('PURGE_DATASET_EPOCH_INVALID', '清理的数据世代无效，请重新预检。', 409);
  }
  if (!epoch || expected !== epoch)
    throw createAppError('DATASET_CHANGED', '数据集已变化，请重新同步并预检清理。', 409);
}
export function assertManualPurgeScope(
  type: string,
  asset: { sourceMode?: unknown; sourceType?: unknown },
  input: PurgeEpochInput,
  provenance: readonly object[] = []
) {
  if (!Object.hasOwn(input, 'expectedDatasetEpoch')) return;
  const manual =
    type === 'knowledgeItem'
      ? asset.sourceMode === 'manual' && provenance.length === 0
      : type === 'examFocus'
        ? asset.sourceType === 'manual'
        : type === 'question'
          ? asset.sourceMode === 'manual'
          : ['learningObjective', 'examProfile'].includes(type);
  if (!manual)
    throw createAppError(
      'PURGE_MANUAL_SCOPE_REQUIRED',
      '当前联网清理只支持已有的手工资产，请保留生成资产及其来源记录。',
      409
    );
}
