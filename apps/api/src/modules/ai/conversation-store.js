import { validateWriteIntent } from './note-write-intent.ts';
import { randomUUID } from 'node:crypto';
import { hashRecord } from './record-contract.js';
import {
  assertResumableAttempts,
  validateAgentCheckpoint,
  validateDurableModelResult,
  sameDurableModelResult,
  MAX_AGENT_RUN_MS,
  REJECTED_RESPONSE_CODES,
  retryRejectedResponses
} from './agent-checkpoint.ts';
import {
  CONVERSATION_KINDS,
  conversationError,
  validateConversationRecord,
  validateConversationState
} from './conversation-records.js';
// 保留已有消费者的入口；新消费者直接依赖纯记录契约。
export {
  CONVERSATION_KINDS,
  emptyConversationState,
  conversationError,
  validateConversationRecord,
  validateConversationState
} from './conversation-records.js';

/** 每次修改在私有存储事务中完成；适配器负责跨进程并发串行化。 */
export function createAiConversationStore(adapter, { now = () => new Date() } = {}) {
  const stamp = () => now().toISOString();
  const read = () => adapter.read();
  const write = action =>
    adapter.write((state, identity) => {
      const result = action(state, identity);
      validateConversationState(state);
      return result;
    });
  const current = (record, identity) =>
    record.datasetId === identity.datasetId && record.datasetEpoch === identity.datasetEpoch;
  const mustTurn = (state, turnId) =>
    state.conversationTurns.find(row => row.turnId === turnId) ??
    conversationError('AI_TURN_NOT_FOUND', '会话任务不存在。');
  const lease = (turn, identity, generation) => {
    if (
      !current(turn, identity) ||
      turn.status !== 'running' ||
      turn.leaseGeneration !== generation ||
      Date.parse(turn.leaseExpiresAt) <= now().getTime()
    ) {
      conversationError('AI_LEASE_STALE', '任务执行权已失效。');
    }
  };
  const leaseEnd = (turn, leaseMs) =>
    new Date(Math.min(now().getTime() + leaseMs, Date.parse(turn.executionStartedAt) + MAX_AGENT_RUN_MS)).toISOString();
  return {
    async listAttachments(conversationId = null) {
      return (await read()).conversationAttachments.filter(
        row => conversationId === null || row.conversationId === conversationId
      );
    },
    async getAttachment(id) {
      return (await read()).conversationAttachments.find(row => row.attachmentId === id) ?? null;
    },
    async stageAttachment({ ownerId, conversationId, uploadKey, fileName, mimeType, size, sha256 }) {
      return write((state, identity) => {
        const conversation = state.conversations.find(
          row => row.conversationId === conversationId && row.ownerId === ownerId
        );
        if (!conversation) conversationError('AI_CONVERSATION_NOT_FOUND', '会话不存在。');
        if (!current(conversation, identity) || conversation.archivedAt)
          conversationError('AI_DATASET_STALE', '会话已切换或归档。');
        const existing = state.conversationAttachments.find(
          row => row.conversationId === conversationId && row.uploadKey === uploadKey
        );
        if (existing) {
          if (
            ['fileName', 'mimeType', 'size', 'sha256'].some(
              key => existing[key] !== { fileName, mimeType, size, sha256 }[key]
            )
          ) {
            conversationError('AI_IDEMPOTENCY_CONFLICT', '上传请求键已用于不同内容。');
          }
          return existing;
        }
        const active = state.conversationAttachments.filter(
          row => row.conversationId === conversationId && !row.removedAt
        );
        if (active.length >= 20 || active.reduce((sum, row) => sum + row.size, 0) + size > 25 * 1024 * 1024) {
          conversationError('AI_ATTACHMENT_QUOTA_EXCEEDED', '此对话最多保存 20 个附件，总大小不超过 25 MB。');
        }
        const time = stamp();
        const record = validateConversationRecord('aiConversationAttachment', {
          kind: 'aiConversationAttachment',
          contractVersion: 2,
          ownerId,
          ...identity,
          spaceId: conversation.spaceId,
          conversationId,
          attachmentId: randomUUID(),
          uploadKey,
          fileName,
          mimeType,
          size,
          sha256,
          storageStatus: 'pending',
          parseStatus: 'not_parsed',
          parserVersion: null,
          parsedTextHash: null,
          segments: [],
          imageMetadata: null,
          errorCode: 'AI_ATTACHMENT_NOT_PARSED',
          revision: 1,
          removedAt: null,
          cleanupStatus: 'none',
          createdAt: time,
          updatedAt: time
        });
        state.conversationAttachments.push(record);
        return record;
      });
    },
    async updateAttachment({ ownerId, attachmentId, expectedRevision, patch }) {
      return write((state, identity) => {
        const row = state.conversationAttachments.find(
          item => item.attachmentId === attachmentId && item.ownerId === ownerId
        );
        if (!row) conversationError('AI_ATTACHMENT_NOT_FOUND', '附件不存在。');
        const conversation = state.conversations.find(item => item.conversationId === row.conversationId);
        if (!current(row, identity) || conversation?.archivedAt)
          conversationError('AI_DATASET_STALE', '附件执行权已失效。');
        if (row.revision !== expectedRevision)
          conversationError('AI_ATTACHMENT_CONFLICT', '附件已更新，请刷新后重试。');
        const allowed = [
          'storageStatus',
          'parseStatus',
          'errorCode',
          'parserVersion',
          'parsedTextHash',
          'segments',
          'imageMetadata',
          'cleanupStatus',
          'removedAt'
        ];
        if (
          !patch ||
          Object.keys(patch).some(key => !allowed.includes(key)) ||
          (row.removedAt && Object.keys(patch).some(key => key !== 'cleanupStatus'))
        ) {
          conversationError('AI_REQUEST_INVALID', '附件修改无效。');
        }
        Object.assign(row, structuredClone(patch), { revision: row.revision + 1, updatedAt: stamp() });
        validateConversationRecord('aiConversationAttachment', row);
        return row;
      });
    },
    peekTurn(id) {
      const value = adapter.read();
      const find = state =>
        structuredClone(validateConversationState(state).conversationTurns.find(row => row.turnId === id) ?? null);
      return value?.then ? value.then(find) : find(value);
    },
    identity: () => adapter.identity(),
    async listConversations(filter) {
      const state = await read();
      return state.conversations.filter(row => Object.entries(filter).every(([key, value]) => row[key] === value));
    },
    async getConversation(id) {
      return (await read()).conversations.find(row => row.conversationId === id) ?? null;
    },
    async getTurn(id) {
      return (await read()).conversationTurns.find(row => row.turnId === id) ?? null;
    },
    async listTurns(conversationId = null) {
      return (await read()).conversationTurns
        .filter(row => conversationId === null || row.conversationId === conversationId)
        .sort((a, b) => a.ordinal - b.ordinal);
    },
    async listMessages(conversationId, afterSequence = 0, limit = 50) {
      return (await read()).conversationMessages
        .filter(row => row.conversationId === conversationId && row.sequence > afterSequence)
        .sort((a, b) => a.sequence - b.sequence)
        .slice(0, limit);
    },
    async listToolCalls(turnId) {
      return (await read()).conversationToolCalls
        .filter(row => row.turnId === turnId)
        .sort((a, b) => a.ordinal - b.ordinal);
    },
    async listModelAttempts(turnId = null) {
      return (await read()).conversationModelAttempts
        .filter(row => turnId === null || row.turnId === turnId)
        .sort((a, b) => a.ordinal - b.ordinal);
    },
    async createConversation({ ownerId, spaceId, actorId, conversationId = randomUUID() }) {
      return write((state, identity) => {
        const existing = state.conversations.find(row => row.conversationId === conversationId);
        if (existing) {
          if (existing.ownerId === ownerId && existing.spaceId === spaceId && current(existing, identity))
            return existing;
          conversationError('AI_IDEMPOTENCY_CONFLICT', '会话 ID 已被其他请求使用。');
        }
        const time = stamp();
        const record = validateConversationRecord('aiConversation', {
          kind: 'aiConversation',
          contractVersion: 2,
          ownerId,
          ...identity,
          spaceId,
          actorId,
          conversationId,
          createdAt: time,
          updatedAt: time,
          archivedAt: null
        });
        state.conversations.push(record);
        return record;
      });
    },
    async submitTurn({
      ownerId,
      conversationId,
      content,
      idempotencyKey,
      requestedPolicyId = null,
      writeIntent = undefined
    }) {
      return write((state, identity) => {
        const conversation = state.conversations.find(row => row.conversationId === conversationId);
        if (!conversation || conversation.ownerId !== ownerId)
          conversationError('AI_CONVERSATION_NOT_FOUND', '会话不存在。');
        if (!current(conversation, identity) || conversation.archivedAt)
          conversationError('AI_DATASET_STALE', '会话资料集已切换或已归档。');
        if (
          typeof content !== 'string' ||
          !content.trim() ||
          content.length > 120000 ||
          !/^[a-zA-Z0-9-]{8,80}$/.test(idempotencyKey) ||
          (requestedPolicyId !== null &&
            (typeof requestedPolicyId !== 'string' || !requestedPolicyId || requestedPolicyId.length > 128))
        ) {
          conversationError('AI_REQUEST_INVALID', '消息或请求键无效。');
        }
        if (writeIntent) validateWriteIntent(writeIntent);
        const inputHash = hashRecord({
          conversationId,
          content,
          requestedPolicyId,
          ...(writeIntent ? { writeIntent } : {})
        });
        const prior = state.conversationTurns.find(
          row =>
            row.ownerId === ownerId &&
            current(row, identity) &&
            row.spaceId === conversation.spaceId &&
            row.idempotencyKey === idempotencyKey
        );
        if (prior) {
          if (prior.inputHash !== inputHash)
            conversationError('AI_IDEMPOTENCY_CONFLICT', '同一请求键的消息内容不一致。');
          return prior;
        }
        if (
          state.conversationTurns.some(
            row => row.conversationId === conversationId && ['staged', 'running', 'interrupted'].includes(row.status)
          )
        ) {
          conversationError('AI_TURN_ACTIVE', '请先完成或取消上一轮任务。');
        }
        const time = stamp(),
          turnId = randomUUID(),
          messageId = randomUUID();
        const common = {
          contractVersion: 2,
          ownerId,
          datasetId: conversation.datasetId,
          datasetEpoch: conversation.datasetEpoch,
          spaceId: conversation.spaceId,
          conversationId
        };
        const sequence =
          Math.max(
            0,
            ...state.conversationMessages.filter(row => row.conversationId === conversationId).map(row => row.sequence)
          ) + 1;
        const message = validateConversationRecord('aiConversationMessage', {
          ...common,
          kind: 'aiConversationMessage',
          messageId,
          turnId,
          sequence,
          role: 'user',
          content,
          sourceRefs: [],
          provenanceManifestId: null,
          sourceFree: true,
          finishReason: null,
          createdAt: time
        });
        const turn = validateConversationRecord('aiConversationTurn', {
          ...common,
          kind: 'aiConversationTurn',
          turnId,
          jobId: turnId,
          ordinal:
            Math.max(
              0,
              ...state.conversationTurns.filter(row => row.conversationId === conversationId).map(row => row.ordinal)
            ) + 1,
          idempotencyKey,
          inputHash,
          userMessageId: messageId,
          assistantMessageId: null,
          requestedPolicyId,
          ...(writeIntent ? { writeIntent } : {}),
          status: 'staged',
          phase: 'waiting',
          leaseGeneration: 0,
          leaseExpiresAt: null,
          errorCode: null,
          createdAt: time,
          updatedAt: time
        });
        state.conversationMessages.push(message);
        state.conversationTurns.push(turn);
        conversation.updatedAt = time;
        return turn;
      });
    },
    async claimTurn(turnId, leaseMs = 60_000, { mode = 'resume' } = {}) {
      return write((state, identity) => {
        const turn = mustTurn(state, turnId);
        if (!current(turn, identity) || !['staged', 'interrupted', 'failed'].includes(turn.status))
          conversationError('AI_TURN_CONFLICT', '任务不可领取。');
        if (!['resume', 'retry'].includes(mode)) conversationError('AI_REQUEST_INVALID', '任务恢复方式无效。');
        if (mode === 'resume')
          assertResumableAttempts(
            state.conversationModelAttempts.filter(row => row.turnId === turnId),
            turn.checkpoint
          );
        if (mode === 'retry')
          turn.checkpoint = retryRejectedResponses(
            state.conversationModelAttempts.filter(row => row.turnId === turnId),
            turn.checkpoint,
            state.conversationToolCalls.filter(row => row.turnId === turnId).length
          );
        if (!Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 300000)
          conversationError('AI_REQUEST_INVALID', '执行租期无效。');
        if (turn.executionStartedAt && now().getTime() >= Date.parse(turn.executionStartedAt) + MAX_AGENT_RUN_MS) {
          conversationError('AI_RUN_LIMIT', '本轮任务的总执行时间已达到上限，请提交新一轮任务。');
        }
        turn.executionStartedAt ??= stamp();
        turn.status = 'running';
        turn.phase = 'waiting';
        turn.errorCode = null;
        turn.leaseGeneration += 1;
        turn.leaseExpiresAt = leaseEnd(turn, leaseMs);
        turn.updatedAt = stamp();
        return turn;
      });
    },
    async saveCheckpoint(turnId, generation, checkpoint) {
      return write((state, identity) => {
        const turn = mustTurn(state, turnId);
        lease(turn, identity, generation);
        const next = validateAgentCheckpoint(checkpoint, turn.checkpoint);
        const attempts = state.conversationModelAttempts.filter(row => row.turnId === turnId);
        if (
          next.handledAttemptOrdinal > attempts.length ||
          next.totalTools < state.conversationToolCalls.filter(row => row.turnId === turnId).length
        ) {
          conversationError('AI_CHECKPOINT_INVALID', '检查点与持久调用记录不一致。');
        }
        turn.checkpoint = next;
        turn.updatedAt = stamp();
        validateConversationRecord('aiConversationTurn', turn);
        return turn;
      });
    },
    async rejectModelResult(turnId, generation, attemptOrdinal, errorCode) {
      return write((state, identity) => {
        const turn = mustTurn(state, turnId);
        lease(turn, identity, generation);
        const attempt = state.conversationModelAttempts.find(
          row => row.turnId === turnId && row.ordinal === attemptOrdinal
        );
        if (!attempt?.modelResult || !REJECTED_RESPONSE_CODES.has(errorCode)) {
          conversationError('AI_REQUEST_INVALID', '只有已持久保存且验证拒绝的模型响应可标记。');
        }
        if (attempt.responseRejectedCode) {
          if (attempt.responseRejectedCode !== errorCode)
            conversationError('AI_IDEMPOTENCY_CONFLICT', '响应拒绝原因与原记录不一致。');
          return attempt;
        }
        attempt.responseRejectedCode = errorCode;
        attempt.responseRejectedAt = stamp();
        attempt.updatedAt = stamp();
        validateConversationRecord('aiConversationModelAttempt', attempt);
        return attempt;
      });
    },
    async setPhase(turnId, generation, phase) {
      return write((state, identity) => {
        const turn = mustTurn(state, turnId);
        lease(turn, identity, generation);
        if (!['retrieving', 'generating', 'validating'].includes(phase))
          conversationError('AI_REQUEST_INVALID', '任务阶段无效。');
        turn.phase = phase;
        turn.updatedAt = stamp();
        return turn;
      });
    },
    async renewLease(turnId, generation, leaseMs = 300_000) {
      return write((state, identity) => {
        const turn = mustTurn(state, turnId);
        lease(turn, identity, generation);
        if (!Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 300_000) {
          conversationError('AI_REQUEST_INVALID', '执行租期无效。');
        }
        turn.leaseExpiresAt = turn.executionStartedAt
          ? leaseEnd(turn, leaseMs)
          : new Date(now().getTime() + leaseMs).toISOString();
        turn.updatedAt = stamp();
        return turn;
      });
    },
    // maxCalls：宿主按回合类型放宽的工具次数上限（提炼知识点回合），默认 6，硬顶 14，恢复不会重置计数。
    async appendToolCall(turnId, generation, { callId, toolName, argumentsJson, maxCalls = 6 }) {
      return write((state, identity) => {
        const turn = mustTurn(state, turnId);
        lease(turn, identity, generation);
        const existing = state.conversationToolCalls.find(row => row.callId === callId);
        if (existing) {
          if (
            existing.turnId === turnId &&
            existing.toolName === toolName &&
            hashRecord(existing.argumentsJson) === hashRecord(argumentsJson)
          )
            return existing;
          conversationError('AI_IDEMPOTENCY_CONFLICT', '工具调用 ID 已被其他请求使用。');
        }
        if (
          state.conversationToolCalls.filter(row => row.turnId === turnId).length >=
          (Number.isSafeInteger(maxCalls) ? Math.min(Math.max(maxCalls, 6), 14) : 6)
        ) {
          conversationError('AI_AGENT_LIMIT', '本轮工具次数已达到上限，恢复不会重置计数。');
        }
        const time = stamp();
        const record = validateConversationRecord('aiConversationToolCall', {
          kind: 'aiConversationToolCall',
          contractVersion: 2,
          ownerId: turn.ownerId,
          datasetId: turn.datasetId,
          datasetEpoch: turn.datasetEpoch,
          spaceId: turn.spaceId,
          conversationId: turn.conversationId,
          turnId,
          callId,
          ordinal:
            Math.max(0, ...state.conversationToolCalls.filter(row => row.turnId === turnId).map(row => row.ordinal)) +
            1,
          toolName,
          argumentsJson,
          resultJson: null,
          provenanceManifestId: null,
          status: 'requested',
          sourceRefs: [],
          errorCode: null,
          createdAt: time,
          updatedAt: time
        });
        state.conversationToolCalls.push(record);
        return record;
      });
    },
    async settleToolCall(turnId, generation, callId, { resultJson = null, sourceRefs = [], errorCode = null }) {
      return write((state, identity) => {
        const turn = mustTurn(state, turnId);
        lease(turn, identity, generation);
        const call = state.conversationToolCalls.find(row => row.callId === callId && row.turnId === turnId);
        if (!call || call.status !== 'requested') conversationError('AI_TOOL_CONFLICT', '工具调用不可结算。');
        if ((resultJson === null) === (errorCode === null))
          conversationError('AI_REQUEST_INVALID', '工具结果或错误码无效。');
        call.resultJson = resultJson;
        call.sourceRefs = sourceRefs;
        call.errorCode = errorCode;
        call.status = errorCode ? 'failed' : 'succeeded';
        call.updatedAt = stamp();
        validateConversationRecord('aiConversationToolCall', call);
        return call;
      });
    },
    async bindToolResultManifest(turnId, generation, callId, manifestId) {
      return write((state, identity) => {
        const turn = mustTurn(state, turnId);
        lease(turn, identity, generation);
        const call = state.conversationToolCalls.find(row => row.callId === callId && row.turnId === turnId);
        if (!call || call.status !== 'succeeded' || !call.sourceRefs.length) {
          conversationError('AI_TOOL_CONFLICT', '工具结果没有待发送的来源。');
        }
        if (typeof manifestId !== 'string' || !manifestId || manifestId.length > 128) {
          conversationError('AI_REQUEST_INVALID', '发送清单 ID 无效。');
        }
        if (call.provenanceManifestId && call.provenanceManifestId !== manifestId) {
          conversationError('AI_IDEMPOTENCY_CONFLICT', '工具结果已绑定其他发送清单。');
        }
        call.provenanceManifestId = manifestId;
        call.updatedAt = stamp();
        return call;
      });
    },
    async createModelAttempt(turnId, generation, input) {
      return write((state, identity) => {
        const turn = mustTurn(state, turnId);
        lease(turn, identity, generation);
        if (state.conversationModelAttempts.filter(row => row.turnId === turnId).length >= 8) {
          conversationError('AI_ATTEMPT_LIMIT', '本轮模型尝试已达到上限，恢复不会重置计数。');
        }
        const time = stamp();
        const record = validateConversationRecord('aiConversationModelAttempt', {
          kind: 'aiConversationModelAttempt',
          contractVersion: 2,
          ownerId: turn.ownerId,
          datasetId: turn.datasetId,
          datasetEpoch: turn.datasetEpoch,
          spaceId: turn.spaceId,
          conversationId: turn.conversationId,
          turnId,
          attemptId: input.attemptId,
          ordinal:
            Math.max(
              0,
              ...state.conversationModelAttempts.filter(row => row.turnId === turnId).map(row => row.ordinal)
            ) + 1,
          leaseGeneration: generation,
          modelId: input.modelId,
          recipient: 'deepseek',
          payloadHash: input.payloadHash,
          manifestId: input.manifestId ?? null,
          grantId: input.grantId ?? null,
          reservedMicrounits: input.reservedMicrounits,
          actualMicrounits: null,
          status: 'prepared',
          errorCode: null,
          createdAt: time,
          updatedAt: time
        });
        if (state.conversationModelAttempts.some(row => row.attemptId === record.attemptId)) {
          conversationError('AI_RECORD_DUPLICATE', '模型尝试 ID 重复。');
        }
        state.conversationModelAttempts.push(record);
        return record;
      });
    },
    async advanceModelAttempt(
      attemptId,
      status,
      { generation = null, actualMicrounits = null, errorCode = null, modelResult = undefined } = {}
    ) {
      return write((state, identity) => {
        const attempt = state.conversationModelAttempts.find(row => row.attemptId === attemptId);
        if (!attempt || !current(attempt, identity)) conversationError('AI_ATTEMPT_NOT_FOUND', '模型尝试不存在。');
        const turn = mustTurn(state, attempt.turnId);
        const transitions = {
          prepared: ['reserved', 'unknown', 'released'],
          reserved: ['sent', 'unknown', 'released'],
          sent: ['settled', 'unknown']
        };
        if (modelResult !== undefined) {
          lease(turn, identity, generation);
          validateDurableModelResult(modelResult);
          if (!['settled', 'unknown'].includes(status))
            conversationError('AI_ATTEMPT_CONFLICT', '模型响应只能随费用结算持久保存。');
        }
        if (attempt.status === status && attempt.actualMicrounits === actualMicrounits) {
          if (
            modelResult !== undefined &&
            (!attempt.modelResult || !sameDurableModelResult(attempt.modelResult, modelResult))
          ) {
            conversationError('AI_IDEMPOTENCY_CONFLICT', '模型响应结算与原记录不一致。');
          }
          return attempt;
        }
        if (!transitions[attempt.status]?.includes(status))
          conversationError('AI_ATTEMPT_CONFLICT', '模型尝试状态不可变更。');
        if (['reserved', 'sent'].includes(status)) lease(turn, identity, generation);
        if (status === 'settled' && (!Number.isSafeInteger(actualMicrounits) || actualMicrounits < 0)) {
          conversationError('AI_RECORD_INVALID', '实际费用无效。');
        }
        attempt.status = status;
        attempt.actualMicrounits = actualMicrounits;
        if (modelResult !== undefined) attempt.modelResult = structuredClone(modelResult);
        attempt.errorCode = errorCode;
        attempt.updatedAt = stamp();
        validateConversationRecord('aiConversationModelAttempt', attempt);
        return attempt;
      });
    },
    async completeTurn(
      turnId,
      generation,
      {
        content,
        sourceRefs = [],
        citations = [],
        provenanceManifestId = null,
        sourceFree = false,
        finishReason = 'stop'
      }
    ) {
      return write((state, identity) => {
        const turn = mustTurn(state, turnId);
        lease(turn, identity, generation);
        if (state.conversationToolCalls.some(row => row.turnId === turnId && row.status === 'requested')) {
          conversationError('AI_TOOL_CONFLICT', '仍有未结算的工具调用。');
        }
        if (
          state.conversationModelAttempts.some(
            row => row.turnId === turnId && ['prepared', 'reserved', 'sent'].includes(row.status)
          )
        ) {
          conversationError('AI_ATTEMPT_CONFLICT', '模型费用尚未结算。');
        }
        if ((!sourceFree && (!sourceRefs.length || !provenanceManifestId)) || (sourceFree && sourceRefs.length)) {
          conversationError('AI_SOURCE_REQUIRED', '回答来源与发送清单不匹配。');
        }
        const time = stamp(),
          messageId = randomUUID();
        const sequence =
          Math.max(
            0,
            ...state.conversationMessages
              .filter(row => row.conversationId === turn.conversationId)
              .map(row => row.sequence)
          ) + 1;
        const message = validateConversationRecord('aiConversationMessage', {
          kind: 'aiConversationMessage',
          contractVersion: 2,
          ownerId: turn.ownerId,
          datasetId: turn.datasetId,
          datasetEpoch: turn.datasetEpoch,
          spaceId: turn.spaceId,
          conversationId: turn.conversationId,
          turnId,
          messageId,
          sequence,
          role: 'assistant',
          content,
          sourceRefs,
          citations,
          provenanceManifestId,
          sourceFree,
          finishReason,
          createdAt: time
        });
        state.conversationMessages.push(message);
        turn.assistantMessageId = messageId;
        turn.status = 'succeeded';
        turn.phase = 'finished';
        turn.leaseExpiresAt = null;
        turn.updatedAt = time;
        state.conversations.find(row => row.conversationId === turn.conversationId).updatedAt = time;
        return { turn, message };
      });
    },
    async failTurn(turnId, generation, errorCode) {
      return write((state, identity) => {
        const turn = mustTurn(state, turnId);
        lease(turn, identity, generation);
        turn.status = 'failed';
        turn.phase = 'finished';
        turn.leaseExpiresAt = null;
        turn.errorCode = errorCode;
        turn.updatedAt = stamp();
        validateConversationRecord('aiConversationTurn', turn);
        return turn;
      });
    },
    async cancelTurn(turnId) {
      return write((state, identity) => {
        const turn = mustTurn(state, turnId);
        if (!current(turn, identity)) conversationError('AI_DATASET_STALE', '历史任务不可操作。');
        if (['succeeded', 'failed', 'cancelled'].includes(turn.status)) return turn;
        turn.status = 'cancelled';
        turn.phase = 'finished';
        turn.leaseExpiresAt = null;
        turn.errorCode = 'AI_CANCELLED';
        turn.updatedAt = stamp();
        return turn;
      });
    },
    async recoverInterrupted() {
      return write((state, identity) => {
        const recovered = [];
        for (const turn of state.conversationTurns) {
          if (
            current(turn, identity) &&
            turn.status === 'running' &&
            Date.parse(turn.leaseExpiresAt) <= now().getTime()
          ) {
            turn.status = 'interrupted';
            turn.leaseExpiresAt = null;
            turn.updatedAt = stamp();
            recovered.push(turn.turnId);
          }
        }
        return recovered;
      });
    }
  };
}

export function createJsonAiConversationStore({ getState, runTransaction, onChange }, options) {
  const read = () => validateConversationState(getState());
  const signature = () =>
    JSON.stringify(
      Object.fromEntries(
        Object.values(CONVERSATION_KINDS).map(({ collection }) => [collection, getState()[collection]])
      )
    );
  return createAiConversationStore(
    {
      identity: () => ({ datasetId: getState().datasetId, datasetEpoch: getState().datasetEpoch }),
      read,
      write: action =>
        runTransaction(() => {
          const before = signature();
          const result = action(getState(), { datasetId: getState().datasetId, datasetEpoch: getState().datasetEpoch });
          if (signature() !== before) onChange();
          return structuredClone(result);
        })
    },
    options
  );
}
