import type { createAiConversationStore, TurnSubmission } from './conversation-store.ts';
import type { AiConversation, AiAccessPolicy } from './private-record-types.ts';
import type { AiRecordRepositoryPort } from './record-types.ts';
import type { AppError } from '../../errors/app-error.ts';
interface ConversationAgent {
  run(turnId: string): Promise<object | void>;
  retry?(turnId: string): Promise<object | void>;
  cancel(turnId: string): void;
}
interface ConversationServiceOptions {
  store: ReturnType<typeof createAiConversationStore>;
  legacyRepository: Pick<AiRecordRepositoryPort, 'get' | 'list' | 'listEvents'>;
  accessStore?: { get(kind: 'aiAccessPolicy', id: string): AiAccessPolicy | null | Promise<AiAccessPolicy | null> };
  spaceRepository: { findById(id: string): { userId?: string } | null | Promise<{ userId?: string } | null> };
  ownerId: string;
  agent?: ConversationAgent | null;
  logger?: Pick<Console, 'warn'>;
}
type ConversationCreateInput = { spaceId: string; conversationId?: string };
type ConversationSubmitInput = Omit<TurnSubmission, 'ownerId' | 'conversationId'> & { execute?: boolean };
import { validateWriteIntent } from './note-write-intent.ts';
import { conversationError } from './conversation-records.ts';
import { assertResumableAttempts } from './agent-checkpoint.ts';

const validId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 128;

/** v2 会话读写与 v1 历史只读入口。空间 owner 始终由服务端校验。 */
export function createAiConversationService({
  store,
  legacyRepository,
  accessStore,
  spaceRepository,
  ownerId,
  agent = null,
  logger = console
}: ConversationServiceOptions) {
  if (!store || !legacyRepository || !spaceRepository || !validId(ownerId)) {
    throw new TypeError('AI conversation service requires private stores and owned space repository');
  }
  async function requireSpace(spaceId: string) {
    if (!validId(spaceId)) conversationError('AI_SCOPE_INVALID', '知识空间无效。');
    const space = await spaceRepository.findById(spaceId);
    if (!space || space.userId !== ownerId) conversationError('AI_SCOPE_FORBIDDEN', '无权访问该知识空间。');
  }
  async function ownedConversation(id: string) {
    const conversation = validId(id) ? await store.getConversation(id) : null;
    if (!conversation || conversation.ownerId !== ownerId)
      conversationError('AI_CONVERSATION_NOT_FOUND', '会话不存在。');
    await requireSpace(conversation.spaceId);
    return conversation;
  }
  async function ownedTurn(conversationId: string, turnId: string) {
    const conversation = await ownedConversation(conversationId);
    const turn = validId(turnId) ? await store.getTurn(turnId) : null;
    if (!turn || turn.conversationId !== conversation.conversationId || turn.ownerId !== ownerId) {
      conversationError('AI_TURN_NOT_FOUND', '会话任务不存在。');
    }
    return turn;
  }
  async function viewConversation(conversation: AiConversation) {
    const identity = await store.identity();
    const historicalDataset =
      conversation.datasetId !== identity.datasetId || conversation.datasetEpoch !== identity.datasetEpoch;
    return { ...conversation, historicalDataset, readOnly: historicalDataset || Boolean(conversation.archivedAt) };
  }
  return {
    async create(input: ConversationCreateInput) {
      if (
        !input ||
        !validId(input.spaceId) ||
        (input.conversationId !== undefined && !validId(input.conversationId)) ||
        Object.keys(input).some(key => !['spaceId', 'conversationId'].includes(key))
      ) {
        conversationError('AI_REQUEST_INVALID', '会话请求无效。');
      }
      await requireSpace(input.spaceId);
      return viewConversation(await store.createConversation({ ownerId, actorId: ownerId, ...input }));
    },
    async list(spaceId: string) {
      await requireSpace(spaceId);
      const conversations = (await store.listConversations({ ownerId, spaceId }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 100);
      return Promise.all(conversations.map(viewConversation));
    },
    async get(id: string) {
      return viewConversation(await ownedConversation(id));
    },
    async messages(id: string, afterSequence = 0, limit = 50) {
      await ownedConversation(id);
      if (
        !Number.isSafeInteger(afterSequence) ||
        afterSequence < 0 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 100
      ) {
        conversationError('AI_REQUEST_INVALID', '消息分页参数无效。');
      }
      return store.listMessages(id, afterSequence, limit);
    },
    async submit(id: string, input: ConversationSubmitInput) {
      const conversation = await ownedConversation(id);
      if (
        !input ||
        Object.keys(input).some(
          key => !['content', 'idempotencyKey', 'requestedPolicyId', 'execute', 'writeIntent'].includes(key)
        ) ||
        (input.execute !== undefined && typeof input.execute !== 'boolean') ||
        (input.execute && (typeof input.content !== 'string' || input.content.length > 3800))
      ) {
        conversationError('AI_REQUEST_INVALID', '消息请求无效。');
      }
      if (input.writeIntent) {
        validateWriteIntent(input.writeIntent);
        if (!agent || !input.execute) conversationError('AI_GENERATION_UNAVAILABLE', '写入计划需要可用的执行器。');
        if (input.writeIntent.toolName !== 'notes_create' && !input.requestedPolicyId)
          conversationError('AI_SCOPE_FORBIDDEN', '修改现有笔记需要选择读取授权。');
      }
      if (input.requestedPolicyId != null) {
        const policy = await accessStore?.get('aiAccessPolicy', input.requestedPolicyId);
        if (
          !policy ||
          policy.ownerId !== ownerId ||
          policy.spaceId !== conversation.spaceId ||
          policy.datasetId !== conversation.datasetId ||
          policy.datasetEpoch !== conversation.datasetEpoch ||
          policy.revokedAt ||
          Date.parse(policy.expiresAt) <= Date.now()
        ) {
          conversationError('AI_SCOPE_FORBIDDEN', '所选读取授权无效。');
        }
      }
      if (input.execute && !agent) conversationError('AI_GENERATION_UNAVAILABLE', '当前执行端不可用。');
      const { execute = false, ...submission } = input;
      const turn = await store.submitTurn({ ownerId, conversationId: id, ...submission });
      if (execute && ['staged', 'interrupted', 'failed'].includes(turn.status)) {
        (agent as ConversationAgent)
          .run(turn.turnId)
          .catch((error: AppError) => logger.warn?.('AI agent turn failed', { code: error.code ?? 'AI_TASK_FAILED' }));
      }
      return { ...turn, executionAvailable: Boolean(agent) && execute };
    },
    async turn(conversationId: string, turnId: string) {
      await store.recoverInterrupted();
      const turn = await ownedTurn(conversationId, turnId);
      const identity = await store.identity();
      return {
        ...turn,
        historicalDataset: turn.datasetId !== identity.datasetId || turn.datasetEpoch !== identity.datasetEpoch,
        toolCalls: await store.listToolCalls(turnId),
        modelAttempts: await store.listModelAttempts(turnId)
      };
    },
    async cancel(conversationId: string, turnId: string) {
      await ownedTurn(conversationId, turnId);
      const cancelled = await store.cancelTurn(turnId);
      agent?.cancel(turnId);
      return cancelled;
    },
    async retry(conversationId: string, turnId: string) {
      const turn = await ownedTurn(conversationId, turnId);
      if (!agent) conversationError('AI_GENERATION_UNAVAILABLE', '当前执行端不可用。');
      if (!['staged', 'interrupted', 'failed'].includes(turn.status)) {
        conversationError('AI_TURN_CONFLICT', '任务当前不可重试。');
      }
      (agent.retry ? agent.retry(turnId) : agent.run(turnId)).catch((error: AppError) =>
        logger.warn?.('AI agent retry failed', { code: error.code ?? 'AI_TASK_FAILED' })
      );
      return { ...turn, executionAvailable: true };
    },
    async resume(conversationId: string, turnId: string) {
      const turn = await ownedTurn(conversationId, turnId);
      if (!agent) conversationError('AI_GENERATION_UNAVAILABLE', '当前执行端不可用。');
      if (!['staged', 'interrupted', 'failed'].includes(turn.status))
        conversationError('AI_TURN_CONFLICT', '任务当前不可继续。');
      const identity = await store.identity();
      if (turn.datasetId !== identity.datasetId || turn.datasetEpoch !== identity.datasetEpoch)
        conversationError('AI_DATASET_STALE', '旧资料集的任务不能继续。');
      if (turn.executionStartedAt && Date.now() >= Date.parse(turn.executionStartedAt) + 10 * 60_000)
        conversationError('AI_RUN_LIMIT', '本轮任务的总执行时间已达到上限，请提交新一轮任务。');
      assertResumableAttempts(await store.listModelAttempts(turnId), turn.checkpoint);
      agent
        .run(turnId)
        .catch((error: AppError) => logger.warn?.('AI agent resume failed', { code: error.code ?? 'AI_TASK_FAILED' }));
      return { ...turn, executionAvailable: true };
    },
    async legacyList(spaceId: string) {
      await requireSpace(spaceId);
      const identity = await store.identity();
      const jobs = await legacyRepository.list('aiJob', { ownerId, spaceId, jobKind: 'answer' });
      return jobs
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 100)
        .map(job => ({
          jobId: job.jobId,
          spaceId,
          question: job.question ?? null,
          status: job.status,
          phase: job.phase,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
          contractVersion: 1,
          readOnly: true,
          historicalDataset: job.datasetId !== identity.datasetId || job.datasetEpoch !== identity.datasetEpoch
        }));
    },
    async legacyGet(jobId: string) {
      const job = validId(jobId) ? await legacyRepository.get('aiJob', jobId) : null;
      if (!job || job.ownerId !== ownerId || job.jobKind !== 'answer')
        conversationError('AI_JOB_NOT_FOUND', '历史任务不存在。');
      await requireSpace(job.spaceId);
      const manifest = await legacyRepository.get('contextManifest', job.manifestId);
      const diagnostics = await legacyRepository.listEvents(jobId);
      const identity = await store.identity();
      return {
        jobId,
        spaceId: job.spaceId,
        question: job.question ?? null,
        status: job.status,
        phase: job.phase,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        result: job.status === 'succeeded' ? (job.resultJson ?? null) : null,
        sources:
          manifest?.sources.map(({ sourceId, noteId, noteVersionId, start, end }) => ({
            sourceId,
            noteId,
            noteVersionId,
            start,
            end
          })) ?? [],
        omissions: manifest?.omissions ?? [],
        diagnostics,
        contractVersion: 1,
        readOnly: true,
        historicalDataset: job.datasetId !== identity.datasetId || job.datasetEpoch !== identity.datasetEpoch
      };
    }
  };
}
