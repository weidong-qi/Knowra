import type { AppError } from '../../errors/app-error.ts';
import type { ValidateFunction } from 'ajv';
import type { ConversationKind, ConversationIndexRecord, ConversationCollection } from './private-store-types.ts';
import type {
  ConversationRecord,
  ConversationRecordByKind,
  AiConversationTurn,
  AiConversationMessage,
  AiConversationToolCall,
  AiConversationModelAttempt,
  AiConversationAttachment,
  RecordBoundary,
  ValidatedConversationState
} from './private-record-types.ts';
import { readAnnotationToolHistory } from './annotation-history.ts';
import { validateWriteIntent } from './note-write-intent.ts';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import schema from './contracts/ai-conversation-v2.schema.json' with { type: 'json' };
import { hashRecord } from './record-contract.ts';
import { validateAgentCheckpoint, validateDurableModelResult, REJECTED_RESPONSE_CODES } from './agent-checkpoint.ts';

// 会话持久记录的纯契约：不读写存储，不推进任务状态。
export const CONVERSATION_KINDS = Object.freeze({
  aiConversation: { collection: 'conversations', id: 'conversationId' },
  aiConversationTurn: { collection: 'conversationTurns', id: 'turnId' },
  aiConversationMessage: { collection: 'conversationMessages', id: 'messageId' },
  aiConversationToolCall: { collection: 'conversationToolCalls', id: 'callId' },
  aiConversationModelAttempt: { collection: 'conversationModelAttempts', id: 'attemptId' },
  aiConversationAttachment: { collection: 'conversationAttachments', id: 'attachmentId' }
} as const);
const collections = Object.values(CONVERSATION_KINDS).map(item => item.collection);
const ajv = new (Ajv2020 as unknown as typeof import('ajv/dist/2020.js').Ajv2020)({
  strict: false,
  allErrors: true
});
(addFormats as unknown as import('ajv-formats').FormatsPlugin)(ajv);
ajv.addSchema(schema);
const validators: Record<string, ValidateFunction<ConversationRecord>> = Object.fromEntries(
  Object.keys(CONVERSATION_KINDS).map(kind => [
    kind,
    ajv.compile<ConversationRecord>({ $ref: `${schema.$id}#/$defs/${kind}` })
  ])
);
export const emptyConversationState = (): ValidatedConversationState =>
  Object.fromEntries(collections.map(name => [name, []])) as unknown as ValidatedConversationState;

export function conversationError(code: string, message: string): never {
  const error = new Error(message) as AppError;
  error.code = code;
  throw error;
}

export function validateConversationRecord<K extends ConversationKind>(
  kind: K,
  record: unknown
): ConversationRecordByKind[K];
export function validateConversationRecord(kind: string, record: unknown): ConversationRecord;
export function validateConversationRecord(kind: string, record: unknown): ConversationRecord {
  if (!validators[kind]?.(record) || record.kind !== kind) {
    conversationError('AI_RECORD_INVALID', `AI ${kind} 会话记录无效。`);
  }
  if (kind === 'aiConversationTurn' && (record as AiConversationTurn).writeIntent) {
    try {
      validateWriteIntent((record as AiConversationTurn).writeIntent);
    } catch {
      conversationError('AI_RECORD_INVALID', '恢复的写入意图缺少固定目标。');
    }
  }
  if (kind === 'aiConversationTurn' && (record as AiConversationTurn).checkpoint)
    validateAgentCheckpoint((record as AiConversationTurn).checkpoint);
  if (kind === 'aiConversationModelAttempt' && (record as AiConversationModelAttempt).modelResult) {
    validateDurableModelResult((record as AiConversationModelAttempt).modelResult);
    if (!['settled', 'unknown'].includes((record as AiConversationModelAttempt).status))
      conversationError('AI_RECORD_INVALID', '响应与费用结算状态不一致。');
  }
  if (
    kind === 'aiConversationModelAttempt' &&
    (Boolean((record as AiConversationModelAttempt).responseRejectedCode) !==
      Boolean((record as AiConversationModelAttempt).responseRejectedAt) ||
      ((record as AiConversationModelAttempt).responseRejectedCode &&
        (!(record as AiConversationModelAttempt).modelResult ||
          !REJECTED_RESPONSE_CODES.has((record as AiConversationModelAttempt).responseRejectedCode as string))))
  ) {
    conversationError('AI_RECORD_INVALID', '模型响应拒绝状态无效。');
  }
  if (kind === 'aiConversationTurn' && (record as AiConversationTurn).turnId !== (record as AiConversationTurn).jobId) {
    conversationError('AI_RECORD_INVALID', '会话轮次与任务 ID 不一致。');
  }
  if (kind === 'aiConversationAttachment') {
    if (
      (record as AiConversationAttachment).segments.length ||
      (record as AiConversationAttachment).parsedTextHash !== null ||
      (record as AiConversationAttachment).parserVersion !== null ||
      (record as AiConversationAttachment).imageMetadata !== null ||
      Boolean((record as AiConversationAttachment).removedAt) !==
        ((record as AiConversationAttachment).storageStatus === 'removed') ||
      ((record as AiConversationAttachment).removedAt &&
        (record as AiConversationAttachment).cleanupStatus === 'none') ||
      ((record as AiConversationAttachment).storageStatus !== 'removed' &&
        (record as AiConversationAttachment).cleanupStatus !== 'none') ||
      (['missing', 'removed'].includes((record as AiConversationAttachment).storageStatus) &&
        (record as AiConversationAttachment).parseStatus !== 'failed') ||
      (['pending', 'ready'].includes((record as AiConversationAttachment).storageStatus) &&
        ((record as AiConversationAttachment).parseStatus !== 'not_parsed' ||
          (record as AiConversationAttachment).errorCode !== 'AI_ATTACHMENT_NOT_PARSED'))
    ) {
      conversationError('AI_RECORD_INVALID', '附件读取、解析或移除状态无效。');
    }
  }
  if (
    kind === 'aiConversationTurn' &&
    (((record as AiConversationTurn).status === 'running') !== Boolean((record as AiConversationTurn).leaseExpiresAt) ||
      ((record as AiConversationTurn).status === 'running' && (record as AiConversationTurn).leaseGeneration < 1) ||
      ['succeeded', 'failed', 'cancelled'].includes((record as AiConversationTurn).status) !==
        ((record as AiConversationTurn).phase === 'finished') ||
      ((record as AiConversationTurn).status === 'staged' && (record as AiConversationTurn).leaseGeneration !== 0) ||
      (((record as AiConversationTurn).status === 'failed') !== Boolean((record as AiConversationTurn).errorCode) &&
        (record as AiConversationTurn).status !== 'cancelled'))
  )
    conversationError('AI_RECORD_INVALID', '任务状态、租约或错误码不一致。');
  if (
    kind === 'aiConversationMessage' &&
    (record as AiConversationMessage).sourceRefs.some(ref => ref.end <= ref.start)
  ) {
    conversationError('AI_RECORD_INVALID', '消息来源区间无效。');
  }
  if (
    kind === 'aiConversationMessage' &&
    ((record as AiConversationMessage).role === 'user'
      ? (record as AiConversationMessage).sourceRefs.length ||
        (record as AiConversationMessage).citations?.length ||
        !(record as AiConversationMessage).sourceFree ||
        (record as AiConversationMessage).provenanceManifestId ||
        (record as AiConversationMessage).finishReason
      : (record as AiConversationMessage).finishReason !== 'stop' ||
        (record as AiConversationMessage).sourceFree === Boolean((record as AiConversationMessage).sourceRefs.length) ||
        (!(record as AiConversationMessage).sourceFree && !(record as AiConversationMessage).provenanceManifestId))
  ) {
    conversationError('AI_RECORD_INVALID', '消息角色、终止状态或来源声明无效。');
  }
  if (
    kind === 'aiConversationMessage' &&
    (record as AiConversationMessage).citations?.some(
      citation =>
        !(record as AiConversationMessage).sourceRefs.some(
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
    (((record as AiConversationToolCall).status === 'requested' &&
      ((record as AiConversationToolCall).resultJson ||
        (record as AiConversationToolCall).errorCode ||
        (record as AiConversationToolCall).sourceRefs.length ||
        (record as AiConversationToolCall).provenanceManifestId)) ||
      ((record as AiConversationToolCall).status === 'succeeded' &&
        (!(record as AiConversationToolCall).resultJson || (record as AiConversationToolCall).errorCode)) ||
      ((record as AiConversationToolCall).status === 'failed' &&
        (!(record as AiConversationToolCall).errorCode ||
          (record as AiConversationToolCall).resultJson ||
          (record as AiConversationToolCall).sourceRefs.length ||
          (record as AiConversationToolCall).provenanceManifestId)) ||
      (record as AiConversationToolCall).sourceRefs.some(ref => ref.end <= ref.start))
  )
    conversationError('AI_RECORD_INVALID', '工具调用与结果状态不一致。');
  if (
    kind === 'aiConversationModelAttempt' &&
    (((record as AiConversationModelAttempt).status === 'settled') !==
      ((record as AiConversationModelAttempt).actualMicrounits !== null) ||
      ((record as AiConversationModelAttempt).actualMicrounits !== null &&
        ((record as AiConversationModelAttempt).actualMicrounits as number) >
          (record as AiConversationModelAttempt).reservedMicrounits) ||
      Boolean((record as AiConversationModelAttempt).manifestId) !==
        Boolean((record as AiConversationModelAttempt).grantId))
  )
    conversationError('AI_RECORD_INVALID', '模型尝试状态或授权引用无效。');
  if (kind === 'aiConversationToolCall') readAnnotationToolHistory(record);
  return structuredClone(record);
}

export function validateConversationState(input: unknown): ValidatedConversationState {
  const state = structuredClone(input) as ValidatedConversationState;
  for (const [kind, { collection, id }] of Object.entries(CONVERSATION_KINDS)) {
    if (!Array.isArray(state[collection as ConversationCollection] as ConversationRecord[]))
      conversationError('AI_RECORD_INVALID', `AI ${collection} 集合无效。`);
    const ids = new Set();
    for (const record of state[collection as ConversationCollection] as ConversationRecord[]) {
      validateConversationRecord(kind, record);
      if (ids.has((record as ConversationIndexRecord)[id as keyof ConversationIndexRecord]))
        conversationError('AI_RECORD_DUPLICATE', `AI ${collection} ID 重复。`);
      ids.add((record as ConversationIndexRecord)[id as keyof ConversationIndexRecord]);
    }
  }
  const conversations = new Map(state.conversations.map(row => [row.conversationId, row]));
  const turns = new Map(state.conversationTurns.map(row => [row.turnId, row]));
  const messages = new Map(state.conversationMessages.map(row => [row.messageId, row]));
  const boundary = (a: RecordBoundary, b: RecordBoundary) =>
    (['ownerId', 'datasetId', 'datasetEpoch', 'spaceId'] as const).every(key => a[key] === b[key]);
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
        row => row.turnId === turn.turnId && row.ordinal === turn.checkpoint!.handledAttemptOrdinal && row.modelResult
      )
    ) {
      conversationError('AI_REFERENCE_INVALID', '检查点引用的模型响应不存在。');
    }
  }
  return state;
}
