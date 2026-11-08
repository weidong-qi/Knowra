import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPersistentAppContext } from '../src/app.factory.js';
import { createServer } from '../src/server.js';
import { createEmptyAiState, validateAiState } from '../src/modules/ai/record-state.ts';
const png = () =>
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
    'base64'
  );

async function withServer(run) {
  // 保留附件目录拒绝软链的安全边界，只规范化系统临时目录的别名。
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-conversation-attachment-http-')));
  const context = createPersistentAppContext({
    storageRootDir: directory,
    uploadsDir: path.join(directory, 'uploads'),
    ownerId: 'demo'
  });
  const space = context.http.knowledge.createDefaultKnowledgeSpace({});
  const conversation = await context.ai.conversation.create({ spaceId: space.id });
  const server = createServer({ appContext: context, logger: { warn() {}, error() {} } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const root = `http://127.0.0.1:${server.address().port}/api/ai/conversations/${conversation.conversationId}`;
  const call = async (suffix, body, method = 'POST', header = '1') => {
    const response = await fetch(
      `${root}${suffix}`,
      body === undefined
        ? undefined
        : {
            method,
            headers: { 'Content-Type': 'application/json', 'X-Knowra-AI-Conversation': header },
            body: JSON.stringify(body)
          }
    );
    return { response, payload: await response.json() };
  };
  try {
    await run({ context, root, call, conversation, directory });
  } finally {
    await new Promise(resolve => server.close(resolve));
    await context.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

export const aiConversationAttachmentHttpTests = [
  {
    name: '对话附件旧私有状态1至5逐级升级6，不接受倒签的新集合',
    run() {
      for (let version = 1; version <= 5; version++) {
        const old = createEmptyAiState();
        old.version = version;
        delete old.conversationAttachments;
        if (version < 5) delete old.actionLedger;
        if (version < 4) delete old.conversationModelAttempts;
        if (version < 3)
          for (const name of ['conversations', 'conversationTurns', 'conversationMessages', 'conversationToolCalls'])
            delete old[name];
        if (version < 2) for (const name of ['accessPolicies', 'runGrants', 'requestManifests']) delete old[name];
        assert.equal(validateAiState(old).version, 6);
        assert.deepEqual(validateAiState(old).conversationAttachments, []);
        old.conversationAttachments = [];
        assert.throws(() => validateAiState(old));
      }
    }
  },
  {
    name: '对话附件HTTP保存未解析信息/版本删除，普通聊天与导出不携带原文',
    run: () =>
      withServer(async ({ context, root, call, conversation }) => {
        const text = '# 对话独有附件秘密\n附件正文 😀';
        const input = {
          uploadKey: 'http-upload-0001',
          fileName: '资料.md',
          mimeType: 'text/markdown',
          contentBase64: Buffer.from(text).toString('base64')
        };
        assert.equal((await call('/attachments', input, 'POST', '0')).response.status, 403);
        const uploaded = await call('/attachments', input);
        assert.equal(uploaded.response.status, 201);
        const attachment = uploaded.payload.data.attachment;
        assert.equal(attachment.parseStatus, 'not_parsed');
        assert.equal(attachment.errorCode, 'AI_ATTACHMENT_NOT_PARSED');
        assert(!Object.hasOwn(attachment, 'segments'));
        assert(!Object.hasOwn(attachment, 'ownerId'));
        assert(!Object.hasOwn(attachment, 'uploadKey'));
        const preview = await call(`/attachments/${attachment.attachmentId}/preview`);
        assert.deepEqual(preview.payload.data.segments, []);
        assert.equal(preview.payload.data.imageMetadata, null);
        assert(!JSON.stringify(preview.payload).includes(text));
        assert.equal((await fetch(`${root}/attachments/${attachment.attachmentId}/content`)).status, 422);
        assert.equal((await call('/attachments', input)).payload.data.attachment.attachmentId, attachment.attachmentId);
        assert.equal(
          (await call('/attachments', { ...input, contentBase64: Buffer.from('不同内容').toString('base64') })).response
            .status,
          409
        );
        assert.equal(
          (
            await call(
              `/attachments/${attachment.attachmentId}`,
              { expectedRevision: attachment.revision - 1 },
              'DELETE'
            )
          ).response.status,
          409
        );
        const sent = await call('/messages', {
          content: '普通消息',
          idempotencyKey: 'http-message-0001',
          execute: false
        });
        assert.equal(sent.response.status, 202);
        assert(
          !JSON.stringify(await context.ai.conversationStore.listMessages(conversation.conversationId)).includes(text)
        );
        assert(!JSON.stringify(context.dataStore.exportSnapshot()).includes('对话独有附件秘密'));
        const removed = await call(
          `/attachments/${attachment.attachmentId}`,
          { expectedRevision: attachment.revision },
          'DELETE'
        );
        assert.equal(removed.response.status, 200);
        assert.equal(removed.payload.data.attachment.storageStatus, 'removed');
        assert.equal((await fetch(`${root}/attachments/${attachment.attachmentId}/preview`)).status, 410);
        assert.equal(
          (await call(`/attachments/${attachment.attachmentId}`, { expectedRevision: attachment.revision }, 'DELETE'))
            .response.status,
          200
        );
      })
  },
  {
    name: '对话附件HTTP图片原字节只预览/不解析，拒绝超量字段及附件模型输入',
    run: () =>
      withServer(async ({ root, call }) => {
        const uploaded = await call('/attachments', {
          uploadKey: 'http-image-0001',
          fileName: '合成.png',
          mimeType: 'image/png',
          contentBase64: png().toString('base64')
        });
        assert.equal(uploaded.response.status, 201);
        const attachment = uploaded.payload.data.attachment;
        assert.equal(attachment.parseStatus, 'not_parsed');
        assert.equal(attachment.imageMetadata, null);
        const content = await fetch(`${root}/attachments/${attachment.attachmentId}/content`);
        assert.equal(content.status, 200);
        assert.equal(content.headers.get('content-type'), 'image/png');
        assert.equal(content.headers.get('cache-control'), 'no-store');
        assert.equal(content.headers.get('x-content-type-options'), 'nosniff');
        assert.deepEqual(Buffer.from(await content.arrayBuffer()), png());
        assert.equal(
          (
            await call('/messages', {
              content: '理解图片',
              idempotencyKey: 'http-message-0002',
              execute: true,
              attachmentIds: [attachment.attachmentId]
            })
          ).response.status,
          422
        );
        assert.equal((await call('/attachments', { ownerId: 'other', contentBase64: 'AAAA' })).response.status, 422);
        assert.equal((await call('/attachments', { contentBase64: 'AAA=' })).response.status, 422);
        // 5MB边界不使用分组重复的Base64正则，避免合法大上传触发调用栈溢出。
        const large = await call('/attachments', {
          uploadKey: 'http-limit-0001',
          fileName: '大文本.txt',
          mimeType: 'text/plain',
          contentBase64: Buffer.alloc(5 * 1024 * 1024, 65).toString('base64')
        });
        assert.equal(large.response.status, 201);
        assert.equal(large.payload.data.attachment.parseStatus, 'not_parsed');
        assert.equal(large.payload.data.attachment.errorCode, 'AI_ATTACHMENT_NOT_PARSED');
      })
  }
];
