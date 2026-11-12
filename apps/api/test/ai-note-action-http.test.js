import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPersistentAppContext } from '../src/app.factory.ts';
import { createServer } from '../src/server.js';
export const aiNoteActionHttpTests = [
  {
    name: 'P2 HTTP 写入需要受信指令/精确确认，重启查询保留回执',
    async run() {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-p2-http-'));
      let server;
      async function start() {
        const app = createPersistentAppContext({ storageRootDir: root, ownerId: 'test' });
        server = createServer({ appContext: app, logger: { warn() {}, error() {} } });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        return { app, origin: `http://127.0.0.1:${server.address().port}` };
      }
      const close = () => new Promise(resolve => server.close(resolve));
      try {
        let { app, origin } = await start();
        const space = app.http.knowledge.createDefaultKnowledgeSpace();
        const post = async (url, data, guard = '1') => {
          const response = await fetch(`${origin}/api/ai/actions${url}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Knowra-AI-Action': guard },
            body: JSON.stringify(data)
          });
          return { status: response.status, body: await response.json() };
        };
        const input = {
          spaceId: space.id,
          requestId: 'http-synthetic',
          toolName: 'notes_create',
          arguments: { title: 'HTTP 合成', rawMarkdown: '正文' }
        };
        assert.equal((await post('', input, '0')).status, 403);
        assert.equal((await post('', { ...input, operationId: 'fake' })).status, 422);
        const planned = await post('', input);
        assert.equal(planned.status, 200);
        const row = planned.body.data;
        assert.equal(app.dataStore.state.notes.length, 0);
        assert.equal((await post(`/${row.actionId}/apply`, {})).status, 403);
        assert.equal((await post(`/${row.actionId}/approve`, { planHash: 'fake' })).status, 409);
        assert.equal((await post(`/${row.actionId}/approve`, { planHash: row.plan.planHash })).status, 200);
        const applied = await post(`/${row.actionId}/apply`, {});
        assert.equal(applied.body.data.status, 'applied');
        assert.deepEqual((await post(`/${row.actionId}/apply`, {})).body.data.receipt, applied.body.data.receipt);
        await close();
        ({ app, origin } = await start());
        const persisted = (await (await fetch(`${origin}/api/ai/actions/${row.actionId}`)).json()).data;
        assert.equal(persisted.status, 'applied');
        assert.deepEqual(persisted.receipt, applied.body.data.receipt);
        assert.equal(app.dataStore.state.notes.length, 1);
      } finally {
        if (server?.listening) await close();
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }
];

aiNoteActionHttpTests.push({
  name: 'HTTP 记录助手回答保留来源契约，重启与私密转换阻止重新预览修订采纳',
  async run() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-message-action-http-'));
    let server, app, origin;
    const start = async () => {
      app = createPersistentAppContext({ storageRootDir: root, ownerId: 'test' });
      server = createServer({ appContext: app, logger: { warn() {}, error() {} } });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      origin = `http://127.0.0.1:${server.address().port}`;
    };
    const close = () => new Promise(resolve => server.close(resolve));
    const post = async (suffix, body) => {
      const response = await fetch(`${origin}/api/ai/actions${suffix}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Knowra-AI-Action': '1' },
        body: JSON.stringify(body)
      });
      return { status: response.status, body: await response.json() };
    };
    try {
      await start();
      const space = app.http.knowledge.createDefaultKnowledgeSpace();
      const source = app.modules.knowledge.noteService.createNote({
        spaceId: space.id,
        title: 'HTTP 合成资料',
        rawMarkdown: 'HTTP 合成个人原文'
      });
      const policy = await app.ai.access.createPolicy({
        spaceId: space.id,
        scope: { kind: 'library' },
        excludedNoteIds: [],
        includeAttachments: false,
        read: true,
        egress: true,
        recipients: ['deepseek'],
        expiresAt: new Date(Date.now() + 86400000).toISOString()
      });
      const conversation = await app.ai.conversationStore.createConversation({
        ownerId: 'test',
        actorId: 'test',
        spaceId: space.id
      });
      const submitted = await app.ai.conversationStore.submitTurn({
        ownerId: 'test',
        conversationId: conversation.conversationId,
        content: '个人问答',
        idempotencyKey: 'http-message-answer',
        requestedPolicyId: policy.policyId
      });
      const turn = await app.ai.conversationStore.claimTurn(submitted.turnId);
      const grant = await app.ai.access.createRunGrant({
        policyId: policy.policyId,
        conversationId: conversation.conversationId
      });
      const { manifest } = await app.ai.access.prepareRequest({
        grantId: grant.grantId,
        recipient: 'deepseek',
        modelId: 'synthetic',
        credentialRef: 'synthetic',
        userMessage: '合成问题',
        sourceRanges: [{ noteId: source.id, start: 0, end: source.rawMarkdown.length }]
      });
      const { message } = await app.ai.conversationStore.completeTurn(turn.turnId, turn.leaseGeneration, {
        content: 'HTTP 助手回答',
        sourceRefs: manifest.sources,
        provenanceManifestId: manifest.manifestId
      });
      const input = {
        spaceId: space.id,
        requestId: 'http-record-message',
        toolName: 'notes_create',
        arguments: { title: 'HTTP 回答草稿', rawMarkdown: message.content },
        sourceMessageId: message.messageId,
        conversationId: conversation.conversationId
      };
      const planned = await post('', input);
      assert.equal(planned.status, 200);
      const row = planned.body.data;
      assert.equal(row.plan.provenance.sourceKind, 'assistantMessage');
      assert.deepEqual(row.plan.provenance.sourceRefs, manifest.sources);
      assert.equal(row.requestId, input.requestId);
      assert.equal(row.grant.originTurnId, undefined);
      await close();
      await start();
      app.modules.knowledge.noteService.updateNote(source.id, { aiVisibility: 'private' });
      assert.equal(
        (await post('', { ...input, requestId: 'http-private-record' })).body.error.code,
        'AI_SCOPE_FORBIDDEN'
      );
      const review = { planHash: row.plan.planHash, requestId: 'http-message-repreview' };
      assert.equal((await post(`/${row.actionId}/repreview`, review)).body.error.code, 'AI_SCOPE_FORBIDDEN');
      assert.equal(
        (
          await post(`/${row.actionId}/revise`, {
            ...review,
            requestId: 'http-message-revise',
            arguments: { title: 'HTTP 回答草稿', rawMarkdown: '改写' }
          })
        ).body.error.code,
        'AI_SCOPE_FORBIDDEN'
      );
      assert.equal((await post(`/${row.actionId}/approve`, { planHash: row.plan.planHash })).status, 200);
      assert.equal((await post(`/${row.actionId}/apply`, {})).body.error.code, 'AI_SCOPE_FORBIDDEN');
      const stored = (await (await fetch(`${origin}/api/ai/actions/${row.actionId}`)).json()).data;
      assert.equal(stored.plan.items[0].after.rawMarkdown, message.content);
      assert.equal(app.modules.knowledge.noteService.listNotes().length, 1);
      const plainInput = await app.ai.conversationStore.submitTurn({
        ownerId: 'test',
        conversationId: conversation.conversationId,
        content: '纯写作问题',
        idempotencyKey: 'http-source-free-message',
        requestedPolicyId: policy.policyId
      });
      const plainTurn = await app.ai.conversationStore.claimTurn(plainInput.turnId);
      const plainGrant = await app.ai.access.createRunGrant({
        policyId: policy.policyId,
        conversationId: conversation.conversationId
      });
      const { manifest: plainManifest } = await app.ai.access.prepareRequest({
        grantId: plainGrant.grantId,
        recipient: 'deepseek',
        modelId: 'synthetic',
        credentialRef: 'synthetic',
        userMessage: '纯写作问题',
        sourceRanges: []
      });
      const { message: plainMessage } = await app.ai.conversationStore.completeTurn(
        plainTurn.turnId,
        plainTurn.leaseGeneration,
        { content: '无个人来源的写作', sourceFree: true, provenanceManifestId: plainManifest.manifestId }
      );
      const plainPlan = await post('', {
        ...input,
        requestId: 'http-source-free-record',
        sourceMessageId: plainMessage.messageId,
        arguments: { title: '无来源回答记录', rawMarkdown: plainMessage.content }
      });
      assert.equal(plainPlan.status, 200);
      const plain = plainPlan.body.data;
      assert.equal(plain.plan.provenance.sourceFree, true);
      assert.deepEqual(plain.plan.provenance.sourceRefs, []);
      assert.equal((await post(`/${plain.actionId}/approve`, { planHash: plain.plan.planHash })).status, 200);
      assert.equal((await post(`/${plain.actionId}/apply`, {})).body.data.status, 'applied');
      assert.equal(app.modules.knowledge.noteService.listNotes().length, 2);
    } finally {
      if (server?.listening) await close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});
