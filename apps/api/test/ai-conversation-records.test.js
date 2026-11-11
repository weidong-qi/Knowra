import assert from 'node:assert/strict';
import * as records from '../src/modules/ai/conversation-records.ts';
import * as legacy from '../src/modules/ai/conversation-store.js';
import { createPostgresAiConversationStore } from '../src/modules/ai/postgres-conversation-store.ts';
import { validateSqliteConversationRows } from '../../desktop-runtime/src/ai-sqlite-conversation-store.mjs';
import { emptyAgentCheckpoint } from '../src/modules/ai/agent-checkpoint.ts';
import { hashRecord } from '../src/modules/ai/record-contract.ts';

const identity = { datasetId: 'dataset-contract', datasetEpoch: 'epoch-contract' };
const ref = {
  noteId: 'note-contract',
  noteVersionId: 'version-contract',
  contentHash: 'a'.repeat(64),
  start: 0,
  end: 4,
  quoteHash: 'b'.repeat(64)
};
const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
async function fixture() {
  const state = records.emptyConversationState();
  const store = legacy.createAiConversationStore(
    { read: () => state, identity: () => identity, write: action => action(state, identity) },
    { now: () => new Date('2026-01-01T00:00:00.000Z') }
  );
  const conversation = await store.createConversation({
    ownerId: 'owner-contract',
    actorId: 'owner-contract',
    spaceId: 'space-contract'
  });
  const turn = await store.submitTurn({
    ownerId: conversation.ownerId,
    conversationId: conversation.conversationId,
    content: '合成问题',
    idempotencyKey: 'contract-request'
  });
  await store.stageAttachment({
    ownerId: conversation.ownerId,
    conversationId: conversation.conversationId,
    uploadKey: 'contract-upload',
    fileName: '合成.txt',
    mimeType: 'text/plain',
    size: 4,
    sha256: 'c'.repeat(64)
  });
  await store.claimTurn(turn.turnId);
  const generation = turn.leaseGeneration;
  await store.appendToolCall(turn.turnId, generation, {
    callId: 'call-contract',
    toolName: 'notes_read',
    argumentsJson: { noteId: ref.noteId }
  });
  await store.settleToolCall(turn.turnId, generation, 'call-contract', {
    resultJson: { text: '合成来源' },
    sourceRefs: [ref]
  });
  await store.createModelAttempt(turn.turnId, generation, {
    attemptId: 'attempt-contract',
    modelId: 'deepseek-flash',
    payloadHash: 'd'.repeat(64),
    reservedMicrounits: 100
  });
  await store.advanceModelAttempt('attempt-contract', 'reserved', { generation });
  await store.advanceModelAttempt('attempt-contract', 'sent', { generation });
  await store.advanceModelAttempt('attempt-contract', 'settled', {
    generation,
    actualMicrounits: 10,
    modelResult: { content: '合成回答', toolCalls: [], finishReason: 'stop', truncated: false, refused: false }
  });
  await store.saveCheckpoint(turn.turnId, generation, {
    ...emptyAgentCheckpoint(),
    totalTools: 1,
    handledAttemptOrdinal: 1
  });
  await store.completeTurn(turn.turnId, generation, {
    content: '合成回答',
    sourceRefs: [ref],
    citations: [{ ...ref }],
    provenanceManifestId: 'manifest-contract'
  });
  return state;
}
const invalid = (state, change, code, message) => {
  const copy = structuredClone(state);
  change(copy);
  freeze(copy);
  assert.throws(() => records.validateConversationState(copy), { code, message });
};
const rowsFor = state =>
  Object.entries(records.CONVERSATION_KINDS).flatMap(([kind, { collection, id }]) =>
    state[collection].map(record => ({
      kind,
      record_id: record[id],
      owner_id: record.ownerId,
      dataset_id: record.datasetId,
      dataset_epoch: record.datasetEpoch,
      space_id: record.spaceId,
      record_hash: hashRecord(record),
      record_json: JSON.stringify(record)
    }))
  );

export const aiConversationRecordsTests = [
  {
    name: '会话契约：旧导出保持同一性，冻结六类记录和状态的校验不改输入且深克隆',
    async run() {
      for (const key of Object.keys(records)) assert.equal(legacy[key], records[key], key);
      const state = freeze(await fixture()),
        before = JSON.stringify(state);
      const clone = records.validateConversationState(state);
      assert.deepEqual(clone, state);
      clone.conversationToolCalls[0].resultJson.text = '只修改返回值';
      for (const [kind, { collection }] of Object.entries(records.CONVERSATION_KINDS)) {
        const result = records.validateConversationRecord(kind, state[collection][0]);
        assert.deepEqual(result, state[collection][0]);
        assert.notEqual(result, state[collection][0]);
      }
      assert.equal(JSON.stringify(state), before);
      const empty = records.emptyConversationState();
      empty.conversations.push({});
      assert.deepEqual(records.emptyConversationState().conversations, []);
      assert.equal(Object.hasOwn(state.conversationMessages[0], 'citations'), false);
      assert.equal(Object.hasOwn(state.conversationTurns[0], 'writeIntent'), false);
    }
  },
  {
    name: '会话契约：坏记录优先于重复 ID，重复 ID 优先于跨记录引用',
    async run() {
      const state = await fixture();
      invalid(
        state,
        s => {
          s.conversationTurns.push({ ...s.conversationTurns[0], kind: 'bad' });
        },
        'AI_RECORD_INVALID',
        'AI aiConversationTurn 会话记录无效。'
      );
      invalid(
        state,
        s => {
          s.conversationTurns.push({ ...s.conversationTurns[0], ownerId: 'other-owner' });
        },
        'AI_RECORD_DUPLICATE',
        'AI conversationTurns ID 重复。'
      );
      invalid(
        state,
        s => {
          s.conversationAttachments[0].ownerId = 'other-owner';
          s.conversationTurns[0].spaceId = 'other-space';
        },
        'AI_REFERENCE_INVALID',
        '附件会话引用无效。'
      );
    }
  },
  {
    name: '会话契约：身份引用、输入哈希、连续序号和检查点关联保持拒绝',
    async run() {
      const state = await fixture();
      for (const key of ['ownerId', 'datasetId', 'datasetEpoch', 'spaceId']) {
        invalid(
          state,
          s => {
            s.conversationTurns[0][key] = 'other-boundary';
          },
          'AI_REFERENCE_INVALID',
          '会话任务引用无效。'
        );
      }
      invalid(
        state,
        s => {
          s.conversationTurns[0].inputHash = 'e'.repeat(64);
        },
        'AI_REFERENCE_INVALID',
        '任务消息引用或终态不一致。'
      );
      invalid(
        state,
        s => {
          s.conversationMessages[1].sequence = 3;
        },
        'AI_REFERENCE_INVALID',
        '会话序号不连续。'
      );
      invalid(
        state,
        s => {
          s.conversationToolCalls[0].ordinal = 2;
        },
        'AI_REFERENCE_INVALID',
        '工具调用序号不连续。'
      );
      invalid(
        state,
        s => {
          s.conversationModelAttempts[0].ordinal = 2;
        },
        'AI_REFERENCE_INVALID',
        '模型尝试序号不连续。'
      );
      invalid(
        state,
        s => {
          delete s.conversationModelAttempts[0].modelResult;
        },
        'AI_REFERENCE_INVALID',
        '检查点引用的模型响应不存在。'
      );
    }
  },
  {
    name: '会话契约：消息引用、附件状态和模型响应的语义校验保持原错误',
    async run() {
      const state = await fixture();
      invalid(
        state,
        s => {
          s.conversationMessages[1].citations[0].end = 5;
        },
        'AI_RECORD_INVALID',
        '引用不在消息来源中。'
      );
      invalid(
        state,
        s => {
          s.conversationMessages[1].sourceFree = true;
        },
        'AI_RECORD_INVALID',
        '消息角色、终止状态或来源声明无效。'
      );
      invalid(
        state,
        s => {
          s.conversationAttachments[0].cleanupStatus = 'pending';
        },
        'AI_RECORD_INVALID',
        '附件读取、解析或移除状态无效。'
      );
      invalid(
        state,
        s => {
          s.conversationModelAttempts[0].status = 'sent';
        },
        'AI_RECORD_INVALID',
        '响应与费用结算状态不一致。'
      );
      invalid(
        state,
        s => {
          s.conversationModelAttempts[0].actualMicrounits = 101;
        },
        'AI_RECORD_INVALID',
        '模型尝试状态或授权引用无效。'
      );
    }
  },
  {
    name: '会话契约：JSON、PG和SQLite读取适配器共享跨身份引用与索引校验（合成适配器）',
    async run() {
      const state = await fixture();
      const readers = current => {
        const rows = rowsFor(current);
        const json = legacy.createJsonAiConversationStore({
          getState: () => ({ ...identity, ...current }),
          runTransaction: () => {
            throw new Error('只读测试');
          }
        });
        const pg = createPostgresAiConversationStore({
          ownerId: 'owner-contract',
          repository: { identity: () => identity },
          client: {
            $transaction: () => {
              throw new Error('只读测试');
            },
            $queryRawUnsafe: async () => rows
          }
        });
        const sqlite = () => validateSqliteConversationRows({ prepare: () => ({ all: () => rows }) });
        return { rows, read: [() => json.listConversations({}), () => pg.listConversations({}), sqlite] };
      };
      for (const read of readers(state).read) await read();
      const bad = structuredClone(state);
      bad.conversationToolCalls[0].datasetEpoch = 'other-epoch';
      for (const read of readers(bad).read)
        await assert.rejects(async () => read(), { code: 'AI_REFERENCE_INVALID', message: '工具调用引用无效。' });
      const indexed = readers(state);
      indexed.rows[0].record_hash = '0'.repeat(64);
      for (const read of indexed.read.slice(1))
        await assert.rejects(async () => read(), { message: 'AI 会话私有索引与正文不一致。' });
    }
  }
];
