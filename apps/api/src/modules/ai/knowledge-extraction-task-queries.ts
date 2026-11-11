import { EXTRACTION_MOCK_PROFILE as profile, taskError, taskId } from './knowledge-extraction-task-contract.ts';
import { verifyTaskRequest } from './knowledge-extraction-task-context.js';
import { extractionPageInput } from './knowledge-extraction-task-page.ts';
import { extractionSafeError } from './knowledge-extraction-http-errors.ts';
import type { AppError } from '../../errors/app-error.ts';
import type { DatasetIdentity } from '../task-workspaces/repository-port.ts';
import type { KnowledgeSpaceRecord } from '../knowledge/infrastructure/knowledge-space-repository.ts';
import type {
  ExtractionJobDetail,
  ExtractionJobPage,
  ExtractionJobSummary,
  ExtractionLoadedTask,
  ExtractionPageRow,
  ExtractionQueryEvent,
  ExtractionQueryJob,
  ExtractionQueryOptions,
  ExtractionQuerySteps
} from './knowledge-extraction-query-types.ts';

const retryRejections = new Set([
  'KNOWLEDGE_EXTRACTION_GRANT_INVALID',
  'KNOWLEDGE_EXTRACTION_SCOPE_FORBIDDEN',
  'KNOWLEDGE_EXTRACTION_SOURCE_UNAVAILABLE',
  'KNOWLEDGE_EXTRACTION_INPUT_TOO_LARGE',
  'KNOWLEDGE_EXTRACTION_GATEWAY_INPUT_TOO_LARGE'
]);

function summary(job: ExtractionQueryJob, descriptor: ExtractionLoadedTask['descriptor']): ExtractionJobSummary {
  return {
    contractVersion: 1,
    kind: 'knowledgeExtraction',
    jobId: job.jobId,
    scopeId: descriptor.scopeId,
    spaceId: job.spaceId,
    executionMode: 'mock',
    status: job.status,
    phase: job.phase,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
}

/** 只读协议投影；操作仍由原生命周期在写事务中复核。 */
export function createExtractionTaskQueries<Transaction>({
  read,
  load,
  view,
  store,
  ownerId,
  clock,
  canUse
}: ExtractionQueryOptions<Transaction>) {
  return {
    async ready() {
      if (!canUse()) return false;
      return read(function* (context): ExtractionQuerySteps<boolean> {
        const identity = (yield context.aiRepository.identity()) as DatasetIdentity;
        return taskId(identity?.datasetId) && taskId(identity?.datasetEpoch) && typeof store.listPage === 'function';
      });
    },
    list(input: unknown) {
      return read(function* (context): ExtractionQuerySteps<ExtractionJobPage> {
        const identity = (yield context.aiRepository.identity()) as DatasetIdentity;
        const { page, cursor } = extractionPageInput(input, identity, ownerId);
        const space = (yield context.repositories.knowledgeSpaceRepository.findById(
          page.spaceId
        )) as KnowledgeSpaceRecord | null;
        if (!space || space.userId !== ownerId)
          throw taskError('KNOWLEDGE_EXTRACTION_TASK_NOT_FOUND', '提炼空间不可用。', 404);
        const rows = (yield store.listPage!(page, context.transaction)) as ExtractionPageRow[];
        const items: ExtractionJobSummary[] = [];
        for (const row of rows.slice(0, page.limit)) {
          const task = yield* load(context, row.jobId);
          if (task.job.spaceId !== page.spaceId || task.job.createdAt !== row.createdAt) {
            throw taskError('KNOWLEDGE_EXTRACTION_TASK_INVALID', '提炼列表与任务边界不一致。', 422);
          }
          items.push(summary(task.job, task.descriptor));
        }
        return { items, nextCursor: rows.length > page.limit ? cursor(rows[page.limit - 1]) : null };
      });
    },
    async inspect(jobId: string) {
      const detail = await read(function* (context): ExtractionQuerySteps<ExtractionJobDetail> {
        const { job, descriptor } = yield* load(context, jobId);
        const base = yield* view(context, jobId);
        let retryCode: string | null = null;
        if (job.status === 'failed') {
          const attempts = (yield context.aiRepository.list('aiJobAttempt', { jobId })) as { attemptId: string }[];
          if (attempts.length >= profile.maxAttempts) retryCode = 'KNOWLEDGE_EXTRACTION_ATTEMPT_LIMIT';
        }
        const events =
          job.status === 'failed' ? ((yield context.aiRepository.listEvents(jobId)) as ExtractionQueryEvent[]) : [];
        const failure = [...events]
          .reverse()
          .find(event => ['attemptFailed', 'recoveryRequired'].includes(event.eventKind));
        return {
          ...summary(job, descriptor),
          candidateIds: base.candidateIds,
          error:
            job.status === 'failed'
              ? extractionSafeError((failure?.safePayload as { code?: unknown } | null | undefined)?.code)
              : null,
          actions: {
            canCancel: canUse() && ['pending', 'running', 'retrying', 'cancelling'].includes(job.status),
            canRetry: false,
            retryUnavailableReason: retryCode ? extractionSafeError(retryCode) : null
          }
        };
      }, jobId);
      if (detail.status === 'failed' && !detail.actions.retryUnavailableReason) {
        // 重新打开短事务：同步与异步驱动的校验错误在此统一处理，不吞掉存储损坏。
        try {
          await read(function* (context): ExtractionQuerySteps<void> {
            const task = yield* load(context, jobId);
            if (task.job.status !== 'failed') throw taskError('KNOWLEDGE_EXTRACTION_NOT_RETRYABLE', '任务状态已变化。');
            // 该生成器仍只读宿主持久化记录；返回的请求在本投影入口不使用。
            yield* verifyTaskRequest(context, ownerId, task, clock) as ExtractionQuerySteps<{ grantExpiresAt: string }>;
          }, jobId);
          detail.actions.canRetry = canUse();
          if (!detail.actions.canRetry)
            detail.actions.retryUnavailableReason = extractionSafeError('KNOWLEDGE_EXTRACTION_UNAVAILABLE');
        } catch (error) {
          if (
            !retryRejections.has((error as Partial<AppError>).code as string) &&
            (error as Partial<AppError>).code !== 'KNOWLEDGE_EXTRACTION_NOT_RETRYABLE'
          )
            throw error;
          detail.actions.retryUnavailableReason = extractionSafeError((error as Partial<AppError>).code);
        }
      }
      return detail;
    }
  };
}
