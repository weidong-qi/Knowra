import { validateWriteIntent } from './note-write-intent.ts';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import schema from './contracts/ai-conversation-v2.schema.json' with { type: 'json' };
import { hashRecord } from './record-contract.js';
import { validateAgentCheckpoint, validateDurableModelResult, REJECTED_RESPONSE_CODES } from './agent-checkpoint.ts';

// 会话持久记录的纯契约：不读写存储，不推进任务状态。
export const CONVERSATION_KINDS = Object.freeze({
  aiConversation: { collection: 'conversations', id: 'conversationId' },
  aiConversationTurn: { collection: 'conversationTurns', id: 'turnId' },
  aiConversationMessage: { collection: 'conversationMessages', id: 'messageId' },
  aiConversationToolCall: { collection: 'conversationToolCalls', id: 'callId' },
  aiConversationModelAttempt: { collection: 'conversationModelAttempts', id: 'attemptId' },
  aiConversationAttachment: { collection: 'conversationAttachments', id: 'attachmentId' }
});
const collections = Object.values(CONVERSATION_KINDS).map(item => item.collection);
const ajv = new /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (/** @type {unknown} */ (Ajv2020))({
  strict: false,
  allErrors: true
});
/** @type {import('ajv-formats').FormatsPlugin} */ (/** @type {unknown} */ (addFormats))(ajv);
ajv.addSchema(schema);
/** @type {Record<string, (value: unknown) => boolean>} */
const validators = Object.fromEntries(
  Object.keys(CONVERSATION_KINDS).map(kind => [kind, ajv.compile({ $ref: `${schema.$id}#/$defs/${kind}` })])
);
export const emptyConversationState = () => Object.fromEntries(collections.map(name => [name, []]));

export function conversationError(code, message) {
  /** @type {Error & Partial<Pick<import('../../errors/app-error.ts').AppError, 'code'>>} */
  const error = new Error(message);
  error.code = code;
  throw error;
}

export function validateConversationRecord(kind, record) {
  if (!validators[kind]?.(record) || record.kind !== kind) {
    conversationError('AI_RECORD_INVALID', `AI ${kind} 会话记录无效。`);
  }
  if (kind === 'aiConversationTurn' && record.writeIntent) {
    try {
      validateWriteIntent(record.writeIntent);
    } catch {
      conversationError('AI_RECORD_INVALID', '恢复的写入意图缺少固定目标。');
    }
  }
  if (kind === 'aiConversationTurn' && record.checkpoint) validateAgentCheckpoint(record.checkpoint);
  if (kind === 'aiConversationModelAttempt' && record.modelResult) {
    validateDurableModelResult(record.modelResult);
    if (!['settled', 'unknown'].includes(record.status))
      conversationError('AI_RECORD_INVALID', '响应与费用结算状态不一致。');
  }
  if (
    kind === 'aiConversationModelAttempt' &&
    (Boolean(record.responseRejectedCode) !== Boolean(record.responseRejectedAt) ||
      (record.responseRejectedCode &&
        (!record.modelResult || !REJECTED_RESPONSE_CODES.has(record.responseRejectedCode))))
  ) {
    conversationError('AI_RECORD_INVALID', '模型响应拒绝状态无效。');
  }
  if (kind === 'aiConversationTurn' && record.turnId !== record.jobId) {
    conversationError('AI_RECORD_INVALID', '会话轮次与任务 ID 不一致。');
  }
  if (kind === 'aiConversationAttachment') {
    if (
      record.segments.length ||
      record.parsedTextHash !== null ||
      record.parserVersion !== null ||
      record.imageMetadata !== null ||
      Boolean(record.removedAt) !== (record.storageStatus === 'removed') ||
      (record.removedAt && record.cleanupStatus === 'none') ||
      (record.storageStatus !== 'removed' && record.cleanupStatus !== 'none') ||
      (['missing', 'removed'].includes(record.storageStatus) && record.parseStatus !== 'failed') ||
      (['pending', 'ready'].includes(record.storageStatus) &&
        (record.parseStatus !== 'not_parsed' || record.errorCode !== 'AI_ATTACHMENT_NOT_PARSED'))
    ) {
      conversationError('AI_RECORD_INVALID', '附件读取、解析或移除状态无效。');
    }
  }
  if (
    kind === 'aiConversationTurn' &&
    ((record.status === 'running') !== Boolean(record.leaseExpiresAt) ||
      (record.status === 'running' && record.leaseGeneration < 1) ||
      ['succeeded', 'failed', 'cancelled'].includes(record.status) !== (record.phase === 'finished') ||
      (record.status === 'staged' && record.leaseGeneration !== 0) ||
      ((record.status === 'failed') !== Boolean(record.errorCode) && record.status !== 'cancelled'))
  )
    conversationError('AI_RECORD_INVALID', '任务状态、租约或错误码不一致。');
  if (kind === 'aiConversationMessage' && record.sourceRefs.some(ref => ref.end <= ref.start)) {
    conversationError('AI_RECORD_INVALID', '消息来源区间无效。');
  }
  if (
    kind === 'aiConversationMessage' &&
    (record.role === 'user'
      ? record.sourceRefs.length ||
        record.citations?.length ||
        !record.sourceFree ||
        record.provenanceManifestId ||
        record.finishReason
      : record.finishReason !== 'stop' ||
        record.sourceFree === Boolean(record.sourceRefs.length) ||
        (!record.sourceFree && !record.provenanceManifestId))
  ) {
    conversationError('AI_RECORD_INVALID', '消息角色、终止状态或来源声明无效。');
  }
  if (
    kind === 'aiConversationMessage' &&
    record.citations?.some(
      citation =>
        !record.sourceRefs.some(
          ref =>
            ref.noteId === citation.noteId &&
            ref.noteVersionId === citation.noteVersionId &&
            ref.contentHash === citation.contentHash &&
            citation.start >= ref.start &&
            citation.end <= ref.end
        )
    )
  ) {
    conversationError('AI_RECORD_INVALID', '引用不在消息来源中。');
  }
  if (
    kind === 'aiConversationToolCall' &&
    ((record.status === 'requested' &&
      (record.resultJson || record.errorCode || record.sourceRefs.length || record.provenanceManifestId)) ||
      (record.status === 'succeeded' && (!record.resultJson || record.errorCode)) ||
      (record.status === 'failed' &&
        (!record.errorCode || record.resultJson || record.sourceRefs.length || record.provenanceManifestId)) ||
      record.sourceRefs.some(ref => ref.end <= ref.start))
  )
    conversationError('AI_RECORD_INVALID', '工具调用与结果状态不一致。');
  if (
    kind === 'aiConversationModelAttempt' &&
    ((record.status === 'settled') !== (record.actualMicrounits !== null) ||
      (record.actualMicrounits !== null && record.actualMicrounits > record.reservedMicrounits) ||
      Boolean(record.manifestId) !== Boolean(record.grantId))
  )
    conversationError('AI_RECORD_INVALID', '模型尝试状态或授权引用无效。');
  return structuredClone(record);
}

export function validateConversationState(input) {
  const state = structuredClone(input);
  for (const [kind, { collection, id }] of Object.entries(CONVERSATION_KINDS)) {
    if (!Array.isArray(state[collection])) conversationError('AI_RECORD_INVALID', `AI ${collection} 集合无效。`);
    const ids = new Set();
    for (const record of state[collection]) {
      validateConversationRecord(kind, record);
      if (ids.has(record[id])) conversationError('AI_RECORD_DUPLICATE', `AI ${collection} ID 重复。`);
      ids.add(record[id]);
    }
  }
  const conversations = new Map(state.conversations.map(row => [row.conversationId, row]));
  const turns = new Map(state.conversationTurns.map(row => [row.turnId, row]));
  const messages = new Map(state.conversationMessages.map(row => [row.messageId, row]));
  const boundary = (a, b) => ['ownerId', 'datasetId', 'datasetEpoch', 'spaceId'].every(key => a[key] === b[key]);
  const ordinals = new Set(),
    sequences = new Set(),
    callOrdinals = new Set(),
    keys = new Set();
  const attemptOrdinals = new Set();
  const attachmentKeys = new Set();
  for (const attachment of state.conversationAttachments) {
    const conversation = conversations.get(attachment.conversationId);
    if (!conversation || !boundary(conversation, attachment))
      conversationError('AI_REFERENCE_INVALID', '附件会话引用无效。');
    const key = `${attachment.conversationId}:${attachment.uploadKey}`;
    if (attachmentKeys.has(key)) conversationError('AI_RECORD_DUPLICATE', '附件上传请求键重复。');
    attachmentKeys.add(key);
  }
  for (const turn of turns.values()) {
    const conversation = conversations.get(turn.conversationId);
    if (!conversation || !boundary(conversation, turn)) conversationError('AI_REFERENCE_INVALID', '会话任务引用无效。');
    const user = messages.get(turn.userMessageId);
    const assistant = turn.assistantMessageId ? messages.get(turn.assistantMessageId) : null;
    if (
      !user ||
      user.role !== 'user' ||
      user.turnId !== turn.turnId ||
      !boundary(user, turn) ||
      (turn.assistantMessageId &&
        (!assistant ||
          assistant.role !== 'assistant' ||
          assistant.turnId !== turn.turnId ||
          !boundary(assistant, turn))) ||
      (turn.status === 'succeeded') !== Boolean(assistant) ||
      (assistant && assistant.sequence <= user.sequence) ||
      turn.inputHash !==
        hashRecord({
          conversationId: turn.conversationId,
          content: user.content,
          requestedPolicyId: turn.requestedPolicyId,
          ...(turn.writeIntent ? { writeIntent: turn.writeIntent } : {})
        })
    ) {
      conversationError('AI_REFERENCE_INVALID', '任务消息引用或终态不一致。');
    }
    const ordinalKey = `${turn.conversationId}:${turn.ordinal}`;
    const requestKey = `${turn.ownerId}:${turn.datasetId}:${turn.datasetEpoch}:${turn.spaceId}:${turn.idempotencyKey}`;
    if (ordinals.has(ordinalKey) || keys.has(requestKey))
      conversationError('AI_RECORD_DUPLICATE', '会话任务序号或请求键重复。');
    ordinals.add(ordinalKey);
    keys.add(requestKey);
  }
  for (const message of messages.values()) {
    const conversation = conversations.get(message.conversationId),
      turn = turns.get(message.turnId);
    if (
      !conversation ||
      !turn ||
      turn.conversationId !== message.conversationId ||
      !boundary(message, conversation) ||
      !boundary(message, turn) ||
      (message.role === 'user' && turn.userMessageId !== message.messageId) ||
      (message.role === 'assistant' && turn.assistantMessageId !== message.messageId)
    ) {
      conversationError('AI_REFERENCE_INVALID', '消息引用无效。');
    }
    const sequenceKey = `${message.conversationId}:${message.sequence}`;
    if (sequences.has(sequenceKey)) conversationError('AI_RECORD_DUPLICATE', '消息序号重复。');
    sequences.add(sequenceKey);
  }
  for (const call of state.conversationToolCalls) {
    const conversation = conversations.get(call.conversationId),
      turn = turns.get(call.turnId);
    if (
      !conversation ||
      !turn ||
      turn.conversationId !== call.conversationId ||
      !boundary(call, conversation) ||
      !boundary(call, turn)
    )
      conversationError('AI_REFERENCE_INVALID', '工具调用引用无效。');
    const key = `${call.turnId}:${call.ordinal}`;
    if (callOrdinals.has(key)) conversationError('AI_RECORD_DUPLICATE', '工具调用序号重复。');
    callOrdinals.add(key);
  }
  for (const attempt of state.conversationModelAttempts) {
    const conversation = conversations.get(attempt.conversationId),
      turn = turns.get(attempt.turnId);
    if (
      !conversation ||
      !turn ||
      turn.conversationId !== attempt.conversationId ||
      !boundary(attempt, conversation) ||
      !boundary(attempt, turn)
    ) {
      conversationError('AI_REFERENCE_INVALID', '模型尝试引用无效。');
    }
    const key = `${attempt.turnId}:${attempt.ordinal}`;
    if (attemptOrdinals.has(key)) conversationError('AI_RECORD_DUPLICATE', '模型尝试序号重复。');
    attemptOrdinals.add(key);
  }
  for (const conversation of conversations.values()) {
    const turnOrdinals = state.conversationTurns
      .filter(row => row.conversationId === conversation.conversationId)
      .map(row => row.ordinal)
      .sort((a, b) => a - b);
    const messageSequences = state.conversationMessages
      .filter(row => row.conversationId === conversation.conversationId)
      .map(row => row.sequence)
      .sort((a, b) => a - b);
    if (
      turnOrdinals.some((value, index) => value !== index + 1) ||
      messageSequences.some((value, index) => value !== index + 1)
    ) {
      conversationError('AI_REFERENCE_INVALID', '会话序号不连续。');
    }
  }
  for (const turn of turns.values()) {
    const ordinals = state.conversationToolCalls
      .filter(row => row.turnId === turn.turnId)
      .map(row => row.ordinal)
      .sort((a, b) => a - b);
    if (ordinals.some((value, index) => value !== index + 1))
      conversationError('AI_REFERENCE_INVALID', '工具调用序号不连续。');
    const attempts = state.conversationModelAttempts
      .filter(row => row.turnId === turn.turnId)
      .map(row => row.ordinal)
      .sort((a, b) => a - b);
    if (attempts.some((value, index) => value !== index + 1))
      conversationError('AI_REFERENCE_INVALID', '模型尝试序号不连续。');
    if (
      turn.checkpoint?.handledAttemptOrdinal &&
      !state.conversationModelAttempts.some(
        row => row.turnId === turn.turnId && row.ordinal === turn.checkpoint.handledAttemptOrdinal && row.modelResult
      )
    ) {
      conversationError('AI_REFERENCE_INVALID', '检查点引用的模型响应不存在。');
    }
  }
  return state;
}
