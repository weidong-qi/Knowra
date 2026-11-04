import { extractionHttpError, extractionSafeError, extractionUnavailable } from './knowledge-extraction-http-errors.ts';
import type {
  ExtractionHttpOptions,
  ExtractionHttpTasks,
  RawExtractionHttpError
} from './knowledge-extraction-query-types.ts';

/** 只包装显式宿主注入的服务；null 不创建 reader、worker、模型设置或凭据依赖。 */
export function createKnowledgeExtractionHttpService({
  tasks = null,
  location = 'server',
  enabled = () => process.env.KNOWRA_AI_ENABLED !== '0',
  logger = console
}: ExtractionHttpOptions = {}) {
  // 本批只验隔离 Web 宿主；本地运行服务的写屏障/退出恢复尚未接入，不能凭注入就宣称支持。
  const hostEnabled = () => location !== 'local' && enabled();
  let recovering = Boolean(tasks && hostEnabled()),
    recoveryFailed = false;
  Promise.resolve()
    .then(async () => {
      if (tasks && hostEnabled()) {
        if (!(await tasks.ready())) {
          recoveryFailed = true;
          return;
        }
        await tasks.recover();
      }
    })
    .catch(() => {
      recoveryFailed = true;
      logger.warn?.('Knowledge extraction recovery unavailable', { code: 'KNOWLEDGE_EXTRACTION_UNAVAILABLE' });
    })
    .finally(() => {
      recovering = false;
    });

  async function available() {
    return Boolean(tasks && hostEnabled() && !recoveryFailed && (await tasks.ready()));
  }
  async function requireTasks(): Promise<ExtractionHttpTasks> {
    if (recovering) throw extractionHttpError({ code: 'KNOWLEDGE_EXTRACTION_RECOVERING' });
    if (!(await available())) throw extractionUnavailable();
    return tasks!;
  }
  const call = <Result>(operation: () => Result | PromiseLike<Result>) =>
    Promise.resolve()
      .then(operation)
      .catch((error: unknown) => {
        const safe = extractionHttpError(error);
        if (
          [
            'KNOWLEDGE_EXTRACTION_TASK_INVALID',
            'KNOWLEDGE_EXTRACTION_COMMIT_INVALID',
            'KNOWLEDGE_EXTRACTION_MOCK_ONLY'
          ].includes((error as Partial<RawExtractionHttpError> | null | undefined)?.code as string)
        )
          recoveryFailed = true;
        throw safe;
      });
  return {
    async capabilities() {
      let usable = false;
      try {
        usable = !recovering && (await available());
      } catch {
        /* 本能力隔离，核心资料可继续使用。 */
      }
      const reason = usable
        ? null
        : extractionSafeError(recovering ? 'KNOWLEDGE_EXTRACTION_RECOVERING' : 'KNOWLEDGE_EXTRACTION_UNAVAILABLE');
      return {
        contractVersion: 1,
        knowledgeExtraction: {
          available: usable,
          executionMode: usable ? 'mock' : 'unavailable',
          executionLocation: location === 'local' ? 'local' : 'server',
          canReadJobs: usable,
          canStart: usable,
          reasonCode: reason?.code ?? null,
          message: reason?.message ?? '模拟演示，结果仅用于流程验收。'
        }
      };
    },
    list: (input: unknown) => call(async () => (await requireTasks()).list(input)),
    get: (jobId: string) => call(async () => (await requireTasks()).inspect(jobId)),
    start: (input: unknown) =>
      call(async () => {
        const service = await requireTasks();
        const job = await service.start(input);
        return service.inspect(job.jobId);
      }),
    cancel: (jobId: string) =>
      call(async () => {
        const service = await requireTasks();
        await service.cancel(jobId);
        return service.inspect(jobId);
      }),
    retry: (jobId: string) =>
      call(async () => {
        const service = await requireTasks();
        await service.retry(jobId);
        return service.inspect(jobId);
      })
  };
}
