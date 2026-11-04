import type { DatasetIdentity } from '../task-workspaces/repository-port.ts';
import type {
  AiAccessCollections,
  AiConversationCollections,
  AiPrivateState,
  AiRecordFields,
  JsonAiRepositoryOptions
} from './record-infrastructure-types.ts';
import type {
  AiRecord,
  AiRecordByKind,
  AiRecordCollections,
  AiRecordKind,
  AiRecordStorage,
  SyncAiRecordRepository
} from './record-types.ts';
import { emptyActionState, validateActionState } from './action-state.js';
import { randomUUID } from 'node:crypto';
import { AI_RECORD_KINDS, validateAiEvent, validateAiRecord } from './record-contract.ts';
import { createAiRecordRepository } from './record-repository.ts';
import { validateBudgetState } from './budget-ledger.js';
import {
  ACCESS_KINDS,
  createJsonAiAccessStore,
  validateAccessRecord,
  validateAccessRelationships
} from './access-records.js';
import { CONVERSATION_KINDS, emptyConversationState, validateConversationState } from './conversation-records.js';
import { createJsonAiConversationStore } from './conversation-store.js';

export const AI_PRIVATE_STATE_VERSION = 6;
const collections = Object.values(AI_RECORD_KINDS).map(value => value.collection);
const accessCollections = Object.values(ACCESS_KINDS).map(value => value.collection);
const conversationCollections = Object.values(CONVERSATION_KINDS).map(value => value.collection);
const v5ConversationCollections = conversationCollections.filter(name => name !== 'conversationAttachments');

export function createEmptyAiState({
  datasetId = randomUUID(),
  datasetEpoch = randomUUID()
}: Partial<DatasetIdentity> = {}): AiPrivateState {
  return {
    version: AI_PRIVATE_STATE_VERSION,
    datasetId,
    datasetEpoch,
    ...(Object.fromEntries<AiRecord[]>(collections.map(name => [name, []])) as AiRecordCollections),
    ...(Object.fromEntries<AiAccessCollections[keyof AiAccessCollections]>(
      accessCollections.map(name => [name, []])
    ) as AiAccessCollections),
    ...(emptyConversationState() as Record<string, object[]> as AiConversationCollections),
    actionLedger: emptyActionState() as AiPrivateState['actionLedger'],
    events: [],
    budgetDays: [],
    budgetReservations: [],
    budgetMonths: []
  };
}

export function validateAiState(input: unknown): AiPrivateState {
  if (input === undefined) return createEmptyAiState();
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    ![1, 2, 3, 4, 5, AI_PRIVATE_STATE_VERSION].includes((input as Record<string, unknown>).version as number) ||
    typeof (input as Record<string, unknown>).datasetId !== 'string' ||
    !(input as Record<string, unknown>).datasetId ||
    typeof (input as Record<string, unknown>).datasetEpoch !== 'string' ||
    !(input as Record<string, unknown>).datasetEpoch ||
    Object.keys(input).some(
      key =>
        ![
          'version',
          'datasetId',
          'datasetEpoch',
          'events',
          'budgetDays',
          'budgetReservations',
          'budgetMonths',
          'actionLedger',
          ...collections,
          ...accessCollections,
          ...conversationCollections
        ].includes(key)
    )
  ) {
    throw new Error('AI 私有存储版本或结构无效，已停止加载。');
  }
  const state = structuredClone(input) as Record<string, unknown>;
  if (state.version === 1) {
    if (accessCollections.some(collection => Object.hasOwn(state, collection))) {
      throw new Error('AI v1 私有状态不能包含 v2 授权记录。');
    }
    for (const collection of accessCollections) state[collection] = [];
    state.version = 2;
  }
  if (state.version === 2) {
    if (conversationCollections.some(collection => Object.hasOwn(state, collection))) {
      throw new Error('AI v2 私有状态不能包含 v3 会话记录。');
    }
    for (const collection of v5ConversationCollections.filter(name => name !== 'conversationModelAttempts'))
      state[collection] = [];
    state.version = 3;
  }
  if (state.version === 3) {
    if (Object.hasOwn(state, 'conversationModelAttempts')) {
      throw new Error('AI v3 私有状态不能包含 v4 模型尝试记录。');
    }
    state.conversationModelAttempts = [];
    state.version = 4;
  }
  if (state.version === 4) {
    if (Object.hasOwn(state, 'actionLedger')) throw new Error('旧版本不能包含新动作账本。');
    state.actionLedger = emptyActionState();
    state.version = 5;
  }
  if (state.version === 5) {
    if (Object.hasOwn(state, 'conversationAttachments')) throw new Error('旧版本不能包含对话附件。');
    state.conversationAttachments = [];
    state.version = 6;
  }
  validateActionState(state.actionLedger);
  for (const [kind, { collection, id }] of Object.entries(AI_RECORD_KINDS)) {
    if (!Array.isArray(state[collection])) throw new Error(`AI 私有集合 ${collection} 无效。`);
    const ids = new Set();
    for (const record of state[collection] as Record<string, unknown>[]) {
      validateAiRecord(kind as AiRecordKind, record);
      if (ids.has(record[id])) throw new Error(`AI 私有集合 ${collection} 存在重复 ID。`);
      ids.add(record[id]);
    }
  }
  if (!Array.isArray(state.events)) throw new Error('AI 事件集合无效。');
  (state.events as unknown[]).forEach(validateAiEvent);
  for (const [kind, { collection, id }] of Object.entries(ACCESS_KINDS)) {
    if (!Array.isArray(state[collection])) throw new Error(`AI v2 私有集合 ${collection} 无效。`);
    const ids = new Set();
    for (const record of state[collection] as Record<string, unknown>[]) {
      validateAccessRecord(kind, record);
      if (ids.has(record[id])) throw new Error(`AI v2 私有集合 ${collection} 存在重复 ID。`);
      ids.add(record[id]);
    }
  }
  validateAccessRelationships(state);
  validateConversationState(state);
  return validateBudgetState(state) as AiPrivateState;
}

export { createJsonAiAccessStore, createJsonAiConversationStore };

export function createJsonAiRepository({
  getState,
  runTransaction,
  onChange
}: JsonAiRepositoryOptions): SyncAiRecordRepository {
  const adapter: AiRecordStorage = {
    identity() {
      const { datasetId, datasetEpoch } = getState();
      return { datasetId, datasetEpoch };
    },
    get<Kind extends AiRecordKind>(kind: Kind, id: string): AiRecordByKind[Kind] | null {
      const { collection, id: idField } = AI_RECORD_KINDS[kind];
      return (
        (getState()[collection] as AiRecordByKind[Kind][]).find(record => (record as AiRecordFields)[idField] === id) ??
        null
      );
    },
    list<Kind extends AiRecordKind>(kind: Kind): AiRecordByKind[Kind][] {
      return getState()[AI_RECORD_KINDS[kind].collection] as AiRecordByKind[Kind][];
    },
    insert<Kind extends AiRecordKind>(kind: Kind, record: AiRecordByKind[Kind]) {
      (getState()[AI_RECORD_KINDS[kind].collection] as AiRecordByKind[Kind][]).push(record);
      onChange();
    },
    replace<Kind extends AiRecordKind>(kind: Kind, record: AiRecordByKind[Kind]) {
      const { collection, id } = AI_RECORD_KINDS[kind];
      const rows = getState()[collection] as AiRecordByKind[Kind][];
      rows[rows.findIndex(item => (item as AiRecordFields)[id] === (record as AiRecordFields)[id])] = record;
      onChange();
    },
    listEvents(jobId) {
      return getState().events.filter(event => event.jobId === jobId);
    },
    insertEvent(event) {
      getState().events.push(event);
      onChange();
    },
    transaction: runTransaction,
    rotateEpoch() {
      return runTransaction(() => {
        getState().datasetEpoch = randomUUID();
        onChange();
        return getState().datasetEpoch;
      });
    }
  };
  return createAiRecordRepository(adapter);
}
