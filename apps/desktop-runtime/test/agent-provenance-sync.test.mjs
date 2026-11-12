import assert from 'node:assert/strict';
import path from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';
import { calculateContentHash } from '@study-accelerator/content-anchor';
import { createAppContext } from '../../api/src/app.factory.ts';
import { createFileDataStore } from '../../api/src/infrastructure/file-data-store.ts';
import { createServer } from '../../api/src/server.ts';
import { createAttachmentTransfer } from '../../api/src/modules/sync/attachment-transfer.ts';
import {
  assertSyncContract,
  KNOWLEDGE_AGENT_PROVENANCE_SYNC_CAPABILITY,
  REQUIRED_SYNC_CAPABILITIES,
  syncContract
} from '../../api/src/modules/sync/protocol-contract.ts';
import { buildKnowledgeProposalPlan } from '../../api/src/modules/ai/knowledge-propose-tool.ts';
import { createAgentKnowledgeCommitService } from '../../api/src/modules/ai/agent-knowledge-commit.ts';
import { createSyncEngine } from '../src/sync-engine.mjs';
import { temporaryDirectory, openWorkspace } from './helpers.mjs';

const QUOTE = '数据增强通过变换样本增加训练变化。';
const CONTENT = `${QUOTE}\n\n过拟合指模型在训练集表现好而泛化差。`;

async function fixture(t) {
  const root = temporaryDirectory(t),
    store = createFileDataStore(path.join(root, 'cloud.json'));
  const app = createAppContext({ dataStore: store, uploadsDir: path.join(root, 'uploads'), storageRootDir: root });
  const knowledge = app.modules.knowledge;
  const space = knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
  const note = knowledge.noteService.createNote({ spaceId: space.id, title: '增强笔记', rawMarkdown: CONTENT });
  const server = createServer({ appContext: app, logger: { error() {} } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  function device(name, fetcher = fetch) {
    const directory = path.join(root, name),
      workspace = openWorkspace(directory);
    const context = createAppContext({
      dataStore: workspace.store,
      uploadsDir: path.join(directory, 'uploads'),
      storageRootDir: directory
    });
    const engine = createSyncEngine(workspace.store, {
      autoSync: false,
      fetcher,
      noteService: workspace.knowledge.noteService,
      entityTransfer: createAttachmentTransfer({
        uploadsDir: path.join(directory, 'uploads'),
        storageRootDir: directory
      })
    });
    t.after(async () => {
      await engine.close();
      workspace.store.close();
    });
    return { ...workspace, app: context, engine, connect: () => engine.configure({ serverUrl: origin }) };
  }
  // 默认写入云端；传入设备的知识模块、笔记与核心账本时，在该设备的 SQLite 本地保存。
  async function saveAgentCandidate({
    knowledge: host = knowledge,
    note: source = note,
    core = app.coreOperationStore
  } = {}) {
    const version = host.repositories.noteVersionRepository.findByNoteIdAndContentHash(
      source.id,
      calculateContentHash(CONTENT)
    );
    const access = {
      async verifyRead() {
        return { note: source, version, contentHash: version.contentHash };
      }
    };
    const ref = {
      noteId: source.id,
      noteVersionId: version.id,
      contentHash: version.contentHash,
      start: 0,
      end: CONTENT.length,
      quoteHash: calculateContentHash(CONTENT)
    };
    const plan = await buildKnowledgeProposalPlan({
      access,
      grantId: 'g',
      sourceRefs: [ref],
      turnId: 'turn-sync',
      callId: 'call-sync',
      args: {
        candidates: [
          {
            title: '数据增强',
            canonicalStatement: QUOTE,
            knowledgeType: 'concept',
            citations: [{ noteId: source.id, start: 0, end: QUOTE.length, quote: QUOTE }]
          }
        ]
      }
    });
    // 保存时会复核回合与授权：这里提供处于运行中的回合、有效运行授权与库级读取策略。
    const origin = { conversationId: 'conversation-sync', turnId: 'turn-sync', toolCallId: 'call-sync' };
    const identity = { datasetId: 'dataset-sync', datasetEpoch: 'epoch-sync' };
    const future = new Date(Date.now() + 3600_000).toISOString(),
      boundary = { ownerId: 'demo', ...identity, spaceId: source.spaceId };
    const turn = {
      ...boundary,
      turnId: origin.turnId,
      conversationId: origin.conversationId,
      status: 'running',
      leaseGeneration: 1,
      leaseExpiresAt: future
    };
    const grant = {
      ...boundary,
      conversationId: origin.conversationId,
      actorId: 'demo',
      policyId: 'policy-sync',
      policyRevision: 1,
      expiresAt: future,
      allowedTools: ['notes_search', 'notes_read']
    };
    const policy = {
      ...boundary,
      actorId: 'demo',
      revision: 1,
      read: true,
      revokedAt: null,
      expiresAt: future,
      excludedNoteIds: [],
      scope: { kind: 'library' }
    };
    const service = createAgentKnowledgeCommitService({
      core,
      knowledge: host,
      ownerId: 'demo',
      conversationStore: { peekTurn: () => turn },
      accessStore: { peek: kind => (kind === 'aiRunGrant' ? grant : policy) }
    });
    await service.commit({
      plan,
      origin,
      identity,
      grantId: 'grant-sync',
      generation: 1,
      provider: 'deepseek',
      modelId: 'deepseek-flash'
    });
    return plan.candidates[0].candidateInput.id;
  }
  return { store, app, knowledge, note, device, saveAgentCandidate };
}
const clean = device => assert.equal(device.engine.status().error, null, JSON.stringify(device.engine.status()));

test('同步协商要求 agent 来源摘要能力：缺失、未知或旧 schema 的端在握手阶段被拒绝', () => {
  assert(REQUIRED_SYNC_CAPABILITIES.includes(KNOWLEDGE_AGENT_PROVENANCE_SYNC_CAPABILITY));
  assert(syncContract().capabilities.includes(KNOWLEDGE_AGENT_PROVENANCE_SYNC_CAPABILITY));
  const without = syncContract().capabilities.filter(value => value !== KNOWLEDGE_AGENT_PROVENANCE_SYNC_CAPABILITY);
  assert.throws(() => assertSyncContract({ ...syncContract(), capabilities: without }), {
    code: 'SYNC_CLIENT_UPGRADE_REQUIRED'
  });
  assert.throws(
    () =>
      assertSyncContract({
        ...syncContract(),
        capabilities: [...syncContract().capabilities, 'knowledge-provenance-agent-v2']
      }),
    { code: 'SYNC_CLIENT_UPGRADE_REQUIRED' }
  );
  assert.throws(
    () => assertSyncContract({ entitySchemaVersion: '8', capabilities: without.join(',') }, { query: true }),
    { code: 'SYNC_CLIENT_UPGRADE_REQUIRED' }
  );
  assert.deepEqual(assertSyncContract(syncContract()), syncContract());
});

test('缺少 agent 来源摘要能力的旧云端在拉取前停止，本地待同步修改完整保留', async t => {
  const cloud = await fixture(t);
  let oldServer = false,
    dataRequests = 0;
  const a = cloud.device('old-agent-server', async (url, init) => {
    if (oldServer && !url.endsWith('/status')) dataRequests++;
    const response = await fetch(url, init);
    if (oldServer && url.endsWith('/status')) {
      const body = await response.json();
      body.data.capabilities = body.data.capabilities.filter(
        value => value !== KNOWLEDGE_AGENT_PROVENANCE_SYNC_CAPABILITY
      );
      return Response.json(body, { status: response.status });
    }
    return response;
  });
  await a.connect();
  clean(a);
  a.knowledge.noteService.createNote({
    title: '离线笔记',
    rawMarkdown: '离线编辑',
    spaceId: a.knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' }).id
  });
  const outbox = a.store.readOutbox(),
    state = a.store.exportSnapshot().data;
  oldServer = true;
  await a.engine.sync();
  assert.equal(a.engine.status().error.code, 'SYNC_CLIENT_UPGRADE_REQUIRED');
  assert.equal(dataRequests, 0);
  assert.deepEqual(a.store.readOutbox(), outbox);
  assert.deepEqual(a.store.exportSnapshot().data, state);
  oldServer = false;
  await a.engine.sync();
  clean(a);
});

test('云端 agent 来源摘要通过增量与逐页 bootstrap 同步到 SQLite 端，来源回读且不含对话内容', async t => {
  const cloud = await fixture(t),
    delta = cloud.device('delta');
  await delta.connect();
  clean(delta);
  const artifactId = await cloud.saveAgentCandidate();
  const record = cloud.store.state.knowledgeArtifactProvenance.find(item => item.artifactId === artifactId);
  assert.equal(record.executionMode, 'agent');
  let pages = 0;
  const fresh = cloud.device('fresh', (url, options) => {
    if (url.includes('/snapshot?')) {
      pages++;
      url += '&limit=1';
    }
    return fetch(url, options);
  });
  await fresh.connect();
  await delta.engine.sync();
  clean(fresh);
  clean(delta);
  assert(pages > 1);
  for (const device of [fresh, delta]) {
    assert.deepEqual(
      device.store.state.knowledgeArtifactProvenance.find(item => item.artifactId === artifactId),
      record
    );
    const read = await device.app.http.knowledge.getKnowledgeProvenance({ id: artifactId });
    assert.equal(read.record.provenanceHash, record.provenanceHash);
    assert.equal(read.sources[0].sourceState, 'available');
    const transported = JSON.stringify(device.store.exportSnapshot());
    for (const forbidden of ['argumentsJson', 'candidateInput', 'conversationMessages', 'credentialRef', 'apiKey'])
      assert(!transported.includes(forbidden), forbidden);
    assert.equal(device.store.state.knowledgeItems.find(item => item.id === artifactId).reviewStatus, 'candidate');
  }
});

test('SQLite 桌面端本地保存 agent 候选（核心账本原子提交）后可推送，云端与另一台设备得到相同的候选与来源摘要', async t => {
  const cloud = await fixture(t),
    a = cloud.device('local-save'),
    b = cloud.device('peer');
  await a.connect();
  clean(a);
  await b.connect();
  clean(b);
  const space = a.knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
  const note = a.knowledge.noteService.createNote({ spaceId: space.id, title: '本地笔记', rawMarkdown: CONTENT });
  assert(a.app.coreOperationStore, '桌面 SQLite 端必须提供核心操作账本');
  const artifactId = await cloud.saveAgentCandidate({ knowledge: a.knowledge, note, core: a.app.coreOperationStore });
  const local = a.store.state.knowledgeArtifactProvenance.find(item => item.artifactId === artifactId);
  assert.equal(local.executionMode, 'agent');
  assert.equal(a.store.state.knowledgeItems.find(item => item.id === artifactId).reviewStatus, 'candidate');
  await a.engine.sync();
  clean(a);
  await b.engine.sync();
  clean(b);
  for (const state of [cloud.store.state, b.store.state]) {
    assert.deepEqual(
      state.knowledgeArtifactProvenance.find(item => item.artifactId === artifactId),
      local
    );
    assert.equal(state.knowledgeItems.find(item => item.id === artifactId).reviewStatus, 'candidate');
  }
  const forbidden = JSON.stringify(cloud.store.state);
  for (const word of ['argumentsJson', 'candidateInput', 'credentialRef', 'apiKey'])
    assert(!forbidden.includes(word), word);
  // 同一回合与工具调用重复保存复用已提交回执，不重复创建
  const again = await cloud.saveAgentCandidate({ knowledge: a.knowledge, note, core: a.app.coreOperationStore });
  assert.equal(again, artifactId);
  assert.equal(a.store.state.knowledgeItems.filter(item => item.id === artifactId).length, 1);
});
