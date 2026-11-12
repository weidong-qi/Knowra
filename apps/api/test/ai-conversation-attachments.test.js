import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createFileDataStore } from '../src/infrastructure/file-data-store.js';
import {
  createConversationAttachmentService,
  CONVERSATION_ATTACHMENT_LIMITS
} from '../src/modules/ai/conversation-attachments.ts';

const sha256 = value => createHash('sha256').update(value).digest('hex');
function assertNotParsed(row) {
  assert.equal(row.parseStatus, 'not_parsed');
  assert.equal(row.errorCode, 'AI_ATTACHMENT_NOT_PARSED');
  assert.equal(row.parserVersion, null);
  assert.equal(row.parsedTextHash, null);
  assert.equal(row.imageMetadata, null);
  assert.deepEqual(row.segments, []);
}
async function fixture(run) {
  // macOS 的 /var、/tmp 是系统软链；测试根规范化后，仍由服务拒绝上传路径内的软链。
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-conversation-files-')));
  const uploadsDir = path.join(root, 'uploads');
  let data, service;
  const restart = async () => {
    await service?.close();
    data = createFileDataStore(path.join(root, 'data.json'));
    service = createConversationAttachmentService({
      conversationStore: data.aiConversationStore,
      uploadsDir,
      ownerId: 'test'
    });
  };
  try {
    await restart();
    const conversation = await data.aiConversationStore.createConversation({
      ownerId: 'test',
      actorId: 'test',
      spaceId: 'space-one'
    });
    await run({
      root,
      uploadsDir,
      conversation,
      restart,
      get service() {
        return service;
      },
      get store() {
        return data.aiConversationStore;
      },
      rotate: () => data.aiRepository.rotateEpoch(),
      upload: (bytes = Buffer.from('合成附件'), extra = {}) =>
        service.upload({
          conversationId: conversation.conversationId,
          uploadKey: randomUUID(),
          fileName: '附件.txt',
          mimeType: 'text/plain',
          bytes,
          ...extra
        }),
      file: record => path.join(uploadsDir, 'ai-conversations', `${record.attachmentId}.bin`)
    });
  } finally {
    await service?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

export const aiConversationAttachmentTests = [
  {
    name: '附件文件名拒绝全部C0控制字符及分隔符但保留相邻Unicode字符',
    run: () =>
      fixture(async f => {
        const forbidden = [
          ...Array.from({ length: 32 }, (_, code) => String.fromCharCode(code)),
          String.fromCharCode(127),
          '/',
          '\\'
        ];
        for (const character of forbidden) {
          await assert.rejects(f.upload(Buffer.from('文件名边界'), { fileName: `前${character}后.txt` }), {
            code: 'AI_ATTACHMENT_UPLOAD_INVALID'
          });
        }
        assert.equal((await f.store.listAttachments()).length, 0);
        for (const character of [' ', '!', '~', String.fromCharCode(128), String.fromCharCode(159), '中', '😀']) {
          const fileName = `前${character}后.txt`;
          const record = await f.upload(Buffer.from('文件名边界'), { fileName });
          assert.equal(record.fileName, fileName);
          assert.equal(record.storageStatus, 'ready');
        }
      })
  },
  {
    name: '上传临时清理保留错误优先级并释放失败临时文件以供原实例恢复',
    run: async () => {
      for (const publishFails of [false, true]) {
        for (const cleanupFailure of [null, 'ENOENT', 'EACCES']) {
          await fixture(async f => {
            const originalLink = fs.promises.link;
            const originalUnlink = fs.promises.unlink;
            const publishError = Object.assign(new Error('合成发布失败'), { code: 'EIO' });
            const cleanupError = Object.assign(new Error('合成清理失败'), { code: cleanupFailure });
            let temporary;
            fs.promises.link = async (...args) => {
              if (publishFails) throw publishError;
              return originalLink(...args);
            };
            fs.promises.unlink = async target => {
              if (!String(target).endsWith('.pending')) return originalUnlink(target);
              temporary = String(target);
              if (cleanupFailure === 'ENOENT') await originalUnlink(target);
              if (cleanupFailure) throw cleanupError;
              return originalUnlink(target);
            };
            try {
              if (cleanupFailure === 'EACCES') await assert.rejects(f.upload(), error => error === cleanupError);
              else if (publishFails) await assert.rejects(f.upload(), error => error === publishError);
              else assert.equal((await f.upload()).storageStatus, 'ready');
            } finally {
              fs.promises.link = originalLink;
              fs.promises.unlink = originalUnlink;
            }
            assert.ok(temporary);
            if (cleanupFailure === 'EACCES') {
              assert.equal(fs.existsSync(temporary), true);
              const old = new Date(Date.now() - 7200000);
              fs.utimesSync(temporary, old, old);
              await f.service.recover();
              assert.equal(fs.existsSync(temporary), false);
            } else assert.equal(fs.existsSync(temporary), false);
          });
        }
      }
    }
  },

  {
    name: '会话附件同payload键幂等、重启验证完整原字节，未解析且不自动入笔记',
    run: () =>
      fixture(async f => {
        const input = {
          conversationId: f.conversation.conversationId,
          uploadKey: 'upload-key-one',
          fileName: '显示名称.txt',
          mimeType: 'text/plain',
          bytes: Buffer.from('合成正文\n第二行')
        };
        await assert.rejects(f.service.upload({ ...input, fileName: '../../显示名称.txt' }), {
          code: 'AI_ATTACHMENT_UPLOAD_INVALID'
        });
        const row = await f.service.upload(input);
        assert.equal(row.storageStatus, 'ready');
        assertNotParsed(row);
        assert.equal(row.sha256, sha256(input.bytes));
        assert.deepEqual(await f.service.upload(input), row);
        await assert.rejects(f.service.upload({ ...input, bytes: Buffer.from('不同正文') }), {
          code: 'AI_IDEMPOTENCY_CONFLICT'
        });
        assert.equal(fs.existsSync(f.file(row)), true);
        assert.equal(fs.existsSync(path.join(f.root, '显示名称.txt')), false);
        await f.restart();
        const result = await f.service.readVerified({
          conversationId: row.conversationId,
          attachmentId: row.attachmentId
        });
        assert.deepEqual(result.bytes, input.bytes);
        assert.deepEqual(result.segments, []);
        assertNotParsed(result.record);
        assert.equal('path' in result, false);
        assert.equal('diskPath' in result, false);
        assert.equal((await f.service.list(row.conversationId)).length, 1);
      })
  },
  {
    name: '上传响应丢失后重启同键重试返回原记录与原字节',
    run: () =>
      fixture(async f => {
        const input = {
          conversationId: f.conversation.conversationId,
          uploadKey: 'lost-response-key',
          fileName: 'response.txt',
          mimeType: 'text/plain',
          bytes: Buffer.from('合成响应丢失正文')
        };
        const update = f.store.updateAttachment;
        let loseResponse = true;
        f.store.updateAttachment = async request => {
          const row = await update(request);
          if (request.patch.storageStatus === 'ready' && loseResponse) {
            loseResponse = false;
            throw Object.assign(new Error('合成提交后响应丢失'), { code: 'EIO' });
          }
          return row;
        };
        try {
          await assert.rejects(f.service.upload(input), { code: 'EIO' });
        } finally {
          f.store.updateAttachment = update;
        }
        const [persisted] = await f.store.listAttachments(input.conversationId);
        assert.equal(persisted.storageStatus, 'ready');
        assertNotParsed(persisted);
        await f.restart();
        const retried = await f.service.upload(input);
        assert.equal(retried.attachmentId, persisted.attachmentId);
        assert.equal(retried.revision, persisted.revision);
        assert.equal((await f.service.list(input.conversationId)).length, 1);
        const result = await f.service.readVerified({
          conversationId: input.conversationId,
          attachmentId: retried.attachmentId
        });
        assert.deepEqual(result.bytes, input.bytes);
        assert.deepEqual(result.segments, []);
      })
  },
  {
    name: '附件只属于当前owner、dataset、epoch、space和会话，其他会话及恢复后不可读',
    run: () =>
      fixture(async f => {
        const row = await f.upload(),
          other = await f.store.createConversation({ ownerId: 'test', actorId: 'test', spaceId: 'space-two' });
        await assert.rejects(
          f.service.readVerified({ conversationId: other.conversationId, attachmentId: row.attachmentId }),
          { code: 'AI_ATTACHMENT_SCOPE_FORBIDDEN' }
        );
        const outsider = createConversationAttachmentService({
          conversationStore: f.store,
          uploadsDir: f.uploadsDir,
          ownerId: 'another'
        });
        try {
          await assert.rejects(outsider.list(row.conversationId), { code: 'AI_ATTACHMENT_SCOPE_FORBIDDEN' });
        } finally {
          await outsider.close();
        }
        const getAttachment = f.store.getAttachment;
        try {
          for (const key of ['ownerId', 'datasetId', 'datasetEpoch', 'spaceId', 'conversationId']) {
            f.store.getAttachment = async id => {
              const stored = await getAttachment(id);
              return { ...stored, [key]: `${stored[key]}-other` };
            };
            await assert.rejects(
              f.service.readVerified({ conversationId: row.conversationId, attachmentId: row.attachmentId }),
              { code: 'AI_ATTACHMENT_SCOPE_FORBIDDEN' }
            );
          }
        } finally {
          f.store.getAttachment = getAttachment;
        }
        await f.rotate();
        await assert.rejects(
          f.service.readVerified({ conversationId: row.conversationId, attachmentId: row.attachmentId }),
          { code: 'AI_DATASET_STALE' }
        );
        await f.restart();
        assert.deepEqual(await f.service.recover(), []);
        assert.equal(fs.existsSync(f.file(row)), true);
      })
  },
  {
    name: '附件大小和会话active件数/总字节配额保留pending占用，删除释放配额',
    run: () =>
      fixture(async f => {
        await assert.rejects(f.upload(Buffer.alloc(CONVERSATION_ATTACHMENT_LIMITS.maxFileBytes + 1)), {
          code: 'AI_ATTACHMENT_UPLOAD_INVALID'
        });
        for (let i = 0; i < 20; i++) await f.upload(Buffer.from('x'));
        await assert.rejects(f.upload(), { code: 'AI_ATTACHMENT_QUOTA_EXCEEDED' });
        const [row] = await f.service.list(f.conversation.conversationId);
        await f.service.remove({
          conversationId: row.conversationId,
          attachmentId: row.attachmentId,
          expectedRevision: row.revision
        });
        await f.upload();
        const other = await f.store.createConversation({ ownerId: 'test', actorId: 'test', spaceId: 'space-one' });
        for (let i = 0; i < 5; i++) {
          const pending = await f.store.stageAttachment({
            ownerId: 'test',
            conversationId: other.conversationId,
            uploadKey: randomUUID(),
            fileName: 'pending.txt',
            mimeType: 'text/plain',
            size: 5 * 1024 * 1024,
            sha256: 'a'.repeat(64)
          });
          assert.equal(pending.storageStatus, 'pending');
          assertNotParsed(pending);
        }
        await assert.rejects(
          f.service.upload({
            conversationId: other.conversationId,
            uploadKey: randomUUID(),
            fileName: 'six.txt',
            mimeType: 'text/plain',
            bytes: Buffer.from('x')
          }),
          { code: 'AI_ATTACHMENT_QUOTA_EXCEEDED' }
        );
      })
  },
  {
    name: '删除先持久墓碑清正文，重启清理unlink故障且幂等键不复活',
    run: () =>
      fixture(async f => {
        const input = {
          conversationId: f.conversation.conversationId,
          uploadKey: 'remove-upload-key',
          fileName: 'delete.txt',
          mimeType: 'text/plain',
          bytes: Buffer.from('删除正文')
        };
        const row = await f.service.upload(input);
        await assert.rejects(
          f.service.remove({
            conversationId: row.conversationId,
            attachmentId: row.attachmentId,
            expectedRevision: row.revision - 1
          }),
          { code: 'AI_ATTACHMENT_CONFLICT' }
        );
        const unlink = fs.promises.unlink;
        fs.promises.unlink = async () => {
          throw Object.assign(new Error('合成unlink失败'), { code: 'EACCES' });
        };
        try {
          await assert.rejects(
            f.service.remove({
              conversationId: row.conversationId,
              attachmentId: row.attachmentId,
              expectedRevision: row.revision
            }),
            { code: 'EACCES' }
          );
        } finally {
          fs.promises.unlink = unlink;
        }
        const tombstone = await f.store.getAttachment(row.attachmentId);
        assert.equal(tombstone.storageStatus, 'removed');
        assert.equal(tombstone.cleanupStatus, 'pending');
        assert.deepEqual(tombstone.segments, []);
        assert.equal(tombstone.parsedTextHash, null);
        await f.restart();
        await f.service.recover();
        assert.equal(fs.existsSync(f.file(row)), false);
        assert.equal((await f.store.getAttachment(row.attachmentId)).cleanupStatus, 'complete');
        assert.equal((await f.service.upload(input)).storageStatus, 'removed');
        await assert.rejects(
          f.service.readVerified({ conversationId: row.conversationId, attachmentId: row.attachmentId }),
          { code: 'AI_ATTACHMENT_REMOVED' }
        );
      })
  },
  {
    name: '普通读取与删除交错拒绝迟到内容，关闭等待已接纳IO且拒绝新工作',
    run: () =>
      fixture(async f => {
        const row = await f.upload(Buffer.from('普通读取正文')),
          originalOpen = fs.promises.open;
        let entered, release;
        const started = new Promise(resolve => {
            entered = resolve;
          }),
          held = new Promise(resolve => {
            release = resolve;
          });
        fs.promises.open = async (...args) => {
          const handle = await originalOpen(...args);
          if (args[0] === f.file(row)) {
            const read = handle.read.bind(handle);
            let waitOnce = true;
            handle.read = async (...readArgs) => {
              if (waitOnce) {
                waitOnce = false;
                entered();
                await held;
              }
              return read(...readArgs);
            };
          }
          return handle;
        };
        let reading, close;
        try {
          reading = f.service.readVerified({ conversationId: row.conversationId, attachmentId: row.attachmentId }).then(
            result => ({ result }),
            error => ({ error })
          );
          assert.equal((await Promise.race([started.then(() => ({ started: true })), reading])).started, true);
          const deleted = await f.service.remove({
            conversationId: row.conversationId,
            attachmentId: row.attachmentId,
            expectedRevision: row.revision
          });
          let finished = false;
          close = f.service.close().then(() => {
            finished = true;
          });
          await Promise.resolve();
          assert.equal(finished, false);
          await assert.rejects(f.service.list(row.conversationId), { code: 'AI_ATTACHMENT_CLOSED' });
          release();
          const late = await reading;
          await close;
          assert.equal(late.error?.code, 'AI_ATTACHMENT_CONFLICT');
          assert.equal(late.result, undefined);
          assert.equal(deleted.storageStatus, 'removed');
          assert.deepEqual((await f.store.getAttachment(row.attachmentId)).segments, []);
          assert.equal(fs.existsSync(f.file(deleted)), false);
          await assert.rejects(
            f.service.readVerified({ conversationId: row.conversationId, attachmentId: row.attachmentId }),
            { code: 'AI_ATTACHMENT_CLOSED' }
          );
        } finally {
          release();
          await reading;
          await close;
          fs.promises.open = originalOpen;
        }
      })
  },
  {
    name: '重启修复pending文件并拒绝缺失、hash损坏、符号链接和非regular文件',
    run: () =>
      fixture(async f => {
        const bytes = Buffer.from('pending合成正文');
        const pending = await f.store.stageAttachment({
          ownerId: 'test',
          conversationId: f.conversation.conversationId,
          uploadKey: randomUUID(),
          fileName: 'pending.txt',
          mimeType: 'text/plain',
          size: bytes.length,
          sha256: sha256(bytes)
        });
        assertNotParsed(pending);
        await assert.rejects(
          f.service.readVerified({ conversationId: pending.conversationId, attachmentId: pending.attachmentId }),
          { code: 'AI_ATTACHMENT_NOT_READY' }
        );
        fs.mkdirSync(path.dirname(f.file(pending)), { recursive: true });
        fs.writeFileSync(f.file(pending), bytes);
        await f.restart();
        await f.service.recover();
        assertNotParsed(await f.store.getAttachment(pending.attachmentId));
        const broken = await f.upload(),
          link = await f.upload(),
          nonregular = await f.upload(),
          missing = await f.upload();
        fs.writeFileSync(f.file(broken), Buffer.from('wrong'));
        fs.unlinkSync(f.file(link));
        fs.symlinkSync(f.file(pending), f.file(link));
        fs.unlinkSync(f.file(nonregular));
        fs.mkdirSync(f.file(nonregular));
        fs.unlinkSync(f.file(missing));
        for (const row of [broken, link, nonregular])
          await assert.rejects(
            f.service.readVerified({ conversationId: row.conversationId, attachmentId: row.attachmentId }),
            { code: 'AI_ATTACHMENT_STORAGE_INVALID' }
          );
        await f.service.recover();
        for (const row of [broken, link, nonregular, missing]) {
          const recovered = await f.store.getAttachment(row.attachmentId);
          assert.equal(recovered.storageStatus, 'missing');
          assert.equal(recovered.parseStatus, 'failed');
          assert.equal(
            recovered.errorCode,
            row === missing ? 'AI_ATTACHMENT_FILE_MISSING' : 'AI_ATTACHMENT_STORAGE_INVALID'
          );
          assert.deepEqual(recovered.segments, []);
          assert.equal(recovered.parserVersion, null);
          assert.equal(recovered.parsedTextHash, null);
          assert.equal(recovered.imageMetadata, null);
        }
      })
  },
  {
    name: '目录symlink与伪造遍历ID拒绝，conversation边界回调阻止删除space访问',
    run: () =>
      fixture(async f => {
        fs.mkdirSync(f.uploadsDir);
        fs.symlinkSync(f.root, path.join(f.uploadsDir, 'ai-conversations'));
        await assert.rejects(f.upload(), { code: 'AI_ATTACHMENT_STORAGE_INVALID' });
        await assert.rejects(
          f.service.readVerified({ conversationId: f.conversation.conversationId, attachmentId: '../unsafe' }),
          { code: 'AI_ATTACHMENT_NOT_FOUND' }
        );
        fs.unlinkSync(path.join(f.uploadsDir, 'ai-conversations'));
        const row = await f.upload(),
          revision = row.revision;
        const blocked = createConversationAttachmentService({
          conversationStore: f.store,
          uploadsDir: f.uploadsDir,
          ownerId: 'test',
          assertConversation: async () => {
            throw Object.assign(new Error('space removed'), { code: 'AI_SCOPE_FORBIDDEN' });
          }
        });
        try {
          await assert.rejects(blocked.list(row.conversationId), { code: 'AI_SCOPE_FORBIDDEN' });
          assert.deepEqual(await blocked.recover(), []);
          assert.equal((await f.store.getAttachment(row.attachmentId)).revision, revision);
        } finally {
          await blocked.close();
        }
      })
  },
  {
    name: '附件发布采用完整临时文件atomic link，链接失败重启同key可恢复且两实例不重复',
    run: () =>
      fixture(async f => {
        const input = {
          conversationId: f.conversation.conversationId,
          uploadKey: 'atomic-upload-key',
          fileName: 'atomic.txt',
          mimeType: 'text/plain',
          bytes: Buffer.from('完整发布正文')
        };
        const link = fs.promises.link;
        fs.promises.link = async () => {
          throw Object.assign(new Error('合成发布失败'), { code: 'EIO' });
        };
        try {
          await assert.rejects(f.service.upload(input), { code: 'EIO' });
        } finally {
          fs.promises.link = link;
        }
        const [pending] = await f.store.listAttachments(input.conversationId);
        assert.equal(fs.existsSync(f.file(pending)), false);
        assert.deepEqual(fs.readdirSync(path.dirname(f.file(pending))), []);
        await f.restart();
        await f.service.recover();
        assert.equal((await f.store.getAttachment(pending.attachmentId)).storageStatus, 'missing');
        const other = createConversationAttachmentService({
          conversationStore: f.store,
          uploadsDir: f.uploadsDir,
          ownerId: 'test'
        });
        try {
          const [first, second] = await Promise.all([f.service.upload(input), other.upload(input)]);
          assert.equal(first.attachmentId, pending.attachmentId);
          assert.equal(second.attachmentId, pending.attachmentId);
          assert.equal((await f.store.listAttachments(input.conversationId)).length, 1);
          const final = await f.service.readVerified({
            conversationId: input.conversationId,
            attachmentId: first.attachmentId
          });
          assert.deepEqual(final.bytes, input.bytes);
          assertNotParsed(final.record);
          assert.deepEqual(final.segments, []);
        } finally {
          await other.close();
        }
      })
  },
  {
    name: '恢复missing期间删除CAS保留墓碑，当前资料旧临时文件有限清理且历史epoch保留',
    run: () =>
      fixture(async f => {
        const row = await f.upload(),
          temporary = path.join(path.dirname(f.file(row)), `${row.attachmentId}.${randomUUID()}.pending`);
        fs.writeFileSync(temporary, '孤儿临时文件');
        fs.utimesSync(temporary, new Date(Date.now() - 7200000), new Date(Date.now() - 7200000));
        await f.service.recover();
        assert.equal(fs.existsSync(temporary), false);
        fs.unlinkSync(f.file(row));
        const get = f.store.getAttachment;
        let removeOnce = true;
        f.store.getAttachment = async id => {
          if (id === row.attachmentId && removeOnce) {
            removeOnce = false;
            const latest = await get(id);
            await f.store.updateAttachment({
              ownerId: 'test',
              attachmentId: id,
              expectedRevision: latest.revision,
              patch: {
                storageStatus: 'removed',
                parseStatus: 'failed',
                removedAt: new Date().toISOString(),
                cleanupStatus: 'pending',
                segments: [],
                parsedTextHash: null,
                imageMetadata: null,
                parserVersion: null,
                errorCode: 'AI_ATTACHMENT_REMOVED'
              }
            });
          }
          return get(id);
        };
        await f.service.recover();
        assert.equal((await get(row.attachmentId)).storageStatus, 'removed');
        assert.deepEqual((await get(row.attachmentId)).segments, []);
        f.store.getAttachment = get;
        const historical = await f.upload();
        const oldTemporary = path.join(
          path.dirname(f.file(historical)),
          `${historical.attachmentId}.${randomUUID()}.pending`
        );
        fs.writeFileSync(oldTemporary, '旧epoch文件');
        fs.utimesSync(oldTemporary, new Date(Date.now() - 7200000), new Date(Date.now() - 7200000));
        await f.rotate();
        await f.service.recover();
        assert.equal(fs.existsSync(oldTemporary), true);
      })
  },
  {
    name: '图片附件作为普通原字节保存读取，始终没有解析正文和图片metadata',
    run: () =>
      fixture(async f => {
        const bytes = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKUcAAAAASUVORK5CYII=',
          'base64'
        );
        const row = await f.upload(bytes, { mimeType: 'image/png', fileName: 'image.png' });
        assertNotParsed(row);
        await f.restart();
        await f.service.recover();
        const result = await f.service.readVerified({
          conversationId: row.conversationId,
          attachmentId: row.attachmentId
        });
        assert.deepEqual(result.bytes, bytes);
        assert.deepEqual(result.segments, []);
        assertNotParsed(result.record);
      })
  },
  {
    name: '普通文件读取期间少量追加文本仍拒绝完整性变化',
    run: () =>
      fixture(async f => {
        const row = await f.upload(Buffer.from('增长前正文')),
          originalOpen = fs.promises.open;
        let largestRead = 0;
        fs.promises.open = async (...args) => {
          const handle = await originalOpen(...args);
          if (args[0] === f.file(row)) {
            const stat = handle.stat.bind(handle),
              read = handle.read.bind(handle);
            let grow = true;
            handle.stat = async () => {
              const snapshot = await stat();
              if (grow) {
                grow = false;
                fs.appendFileSync(f.file(row), '追加');
              }
              return snapshot;
            };
            handle.read = async (buffer, offset, length, position) => {
              largestRead = Math.max(largestRead, length);
              return read(buffer, offset, length, position);
            };
          }
          return handle;
        };
        try {
          await assert.rejects(
            f.service.readVerified({ conversationId: row.conversationId, attachmentId: row.attachmentId }),
            { code: 'AI_ATTACHMENT_STORAGE_INVALID' }
          );
        } finally {
          fs.promises.open = originalOpen;
        }
        assert.equal(largestRead, row.size + 1);
      })
  }
];
