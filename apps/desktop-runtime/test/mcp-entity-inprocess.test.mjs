import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { openWorkspace, temporaryDirectory } from './helpers.mjs';
import { createAgentKnowledgeCommitService } from '../../api/src/modules/ai/agent-knowledge-commit.ts';
import { createAiAccessService } from '../../api/src/modules/ai/access-service.js';
import { createMcpKnowledgeReadService } from '../../api/src/modules/ai/mcp-knowledge-read.js';
import { createPairingStore } from '../src/mcp/pairing-store.mjs';
import { createMcpPairingService } from '../src/mcp/pairing-service.mjs';
import { createMcpGate } from '../src/mcp/mcp-gate.mjs';
import { createMcpTools } from '../src/mcp/tools.mjs';
import { createMcpEntityOutput } from '../src/mcp/entity-output.mjs';

/** 真 SQLite 与真实授权服务的进程内集成，不替代 stdio/socket 传输测试。 */
async function setup(t) {
  const root = temporaryDirectory(t),
    workspace = openWorkspace(root),
    { store, knowledge, space } = workspace;
  t.after(() => store.close());
  const repos = knowledge.repositories;
  const access = createAiAccessService({
    store: store.aiAccessStore,
    noteRepository: repos.noteRepository,
    noteVersionRepository: repos.noteVersionRepository,
    folderRepository: repos.folderRepository,
    spaceRepository: repos.knowledgeSpaceRepository,
    ownerId: 'demo'
  });
  const knowledgeCommit = createAgentKnowledgeCommitService({
    core: store.coreOperationStore,
    knowledge,
    ownerId: 'demo',
    conversationStore: store.aiConversationStore,
    accessStore: store.aiAccessStore
  });
  const ai = {
    access,
    accessStore: store.aiAccessStore,
    knowledgeCommit,
    mcpKnowledgeRead: createMcpKnowledgeReadService({
      knowledge,
      ownerId: 'demo',
      accessStore: store.aiAccessStore,
      knowledgeCommit
    })
  };
  const pairings = createPairingStore({ directory: path.join(root, 'mcp') });
  const audit = { append() {}, recent: () => [] },
    flags = () => ({ aiEnabled: true, allowExternal: true });
  const gate = createMcpGate({
    pairings,
    getAccess: () => access,
    flags,
    audit,
    proposalsEnabled: async () => true,
    proposalsNow: () => true,
    tools: createMcpTools({ getAi: () => ai, getAnnotations: () => null }),
    getEntityResult: createMcpEntityOutput({ getAi: () => ai })
  });
  const service = createMcpPairingService({
    pairings,
    getAccess: () => access,
    audit,
    gate,
    flags,
    dataDirectory: root,
    socketPath: path.join(root, 'not-started.sock')
  });
  const pairing = await service.create({
    label: '进程内合成验收',
    spaceId: space.id,
    scope: { kind: 'library' },
    egressConfirmed: true,
    allowKnowledgeRead: true,
    knowledgeReadConfirmed: true,
    allowPropose: true,
    proposeConfirmed: true
  });
  const { token } = JSON.parse(fs.readFileSync(pairing.pairingFile, 'utf8'));
  return { ...workspace, service, pairing, call: (tool, input = {}) => gate.call({ token, tool, input }) };
}

test('真实 SQLite→授权服务→实体出口：导航与独立知识正文许可无需来源字面匹配', async t => {
  const env = await setup(t);
  const note = env.knowledge.noteService.createNote({
    spaceId: env.space.id,
    title: '可读笔记',
    rawMarkdown: '当前笔记原文。'
  });
  env.knowledge.noteService.createNote({
    spaceId: env.space.id,
    title: '私密标题',
    rawMarkdown: '私密内容。',
    aiVisibility: 'private'
  });
  const created = env.knowledge.knowledgeItemService.createCandidate({
    title: '手写归纳',
    canonicalStatement: '独立知识许可覆盖此正文。',
    userExplanation: '允许读取解释',
    knowledgeType: 'concept',
    sourceMode: 'manual'
  });
  const listed = await env.call('notes_list');
  assert.deepEqual(
    listed.data.notes.map(row => row.noteId),
    [note.id]
  );
  assert.equal((await env.call('workspace_describe')).data.noteCount, 1);
  const read = await env.call('knowledge_read', { knowledgeId: created.item.id });
  assert.equal(read.data.canonicalStatement, '独立知识许可覆盖此正文。');
  assert.deepEqual(read.data.sources, []);
  assert.equal(
    (await env.call('knowledge_search', { query: '手写归纳', reviewStatus: 'all' })).data.items[0].knowledgeId,
    created.item.id
  );
  env.service.setKnowledgeRead(env.pairing.pairingId, { allowKnowledgeRead: false });
  await assert.rejects(env.call('knowledge_read', { knowledgeId: created.item.id }), {
    code: 'MCP_KNOWLEDGE_READ_NOT_ALLOWED'
  });
});

test('真实 SQLite→提议账本→实体回执：ID 稳定、状态准确、已知私密来源阻断', async t => {
  const env = await setup(t);
  const body = '模型过度贴合训练样本时，对新样本表现可能下降。';
  const note = env.knowledge.noteService.createNote({ spaceId: env.space.id, title: '模型概念', rawMarkdown: body });
  await env.call('notes_read', { noteId: note.id });
  const input = {
    idempotencyKey: 'inprocess-receipt-001',
    candidates: [
      {
        title: '过拟合',
        canonicalStatement: '过拟合可能导致泛化能力下降。',
        knowledgeType: 'concept',
        citations: [{ noteId: note.id, quote: body }]
      }
    ]
  };
  const result = await env.call('knowledge_propose', input);
  const knowledgeId = result.data.candidateIds[0],
    requestId = result.data.requestId;
  assert.equal((await env.call('knowledge_propose', input)).data.requestId, requestId);
  assert.equal((await env.call('proposals_get', { requestId })).data.candidates[0].reviewStatus, 'candidate');
  assert.equal(
    (await env.call('knowledge_read', { knowledgeId })).data.canonicalStatement,
    '过拟合可能导致泛化能力下降。'
  );
  env.knowledge.knowledgeItemService.confirmItem(knowledgeId);
  assert.equal((await env.call('proposals_get', { requestId })).data.candidates[0].reviewStatus, 'confirmed');
  assert.equal((await env.call('knowledge_search', { query: '过拟合' })).data.items[0].knowledgeId, knowledgeId);
  env.knowledge.noteService.updateNote(note.id, { aiVisibility: 'private' });
  await assert.rejects(env.call('knowledge_read', { knowledgeId }), { code: 'MCP_ENTITY_UNAVAILABLE' });
  await assert.rejects(env.call('proposals_get', { requestId }), { code: 'MCP_ENTITY_UNAVAILABLE' });
  assert.equal((await env.call('knowledge_search', { query: '过拟合', reviewStatus: 'all' })).data.items.length, 0);
});
