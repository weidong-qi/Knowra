import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createPostgresAiRepository } from '../src/modules/ai/postgres-record-repository.ts';
import { createPostgresAiConversationStore } from '../src/modules/ai/postgres-conversation-store.js';

export const aiConversationAttachmentPostgresTests = process.env.KNOWRA_SYNC_TEST_DATABASE_URL
  ? [
      {
        name: '对话附件 PostgreSQL 双适配器并发幂等、配额、CAS墓碑、owner和epoch隔离',
        async run() {
          const db = new PrismaClient({
            datasources: { db: { url: process.env.KNOWRA_SYNC_TEST_DATABASE_URL } },
            log: []
          });
          const ownerId = `attachment-${randomUUID()}`,
            otherOwnerId = `attachment-other-${randomUUID()}`;
          try {
            await db.$connect();
            const repository = createPostgresAiRepository({ client: db, ownerId });
            const first = createPostgresAiConversationStore({ client: db, repository, ownerId });
            const second = createPostgresAiConversationStore({ client: db, repository, ownerId });
            const conversation = await first.createConversation({ ownerId, actorId: ownerId, spaceId: randomUUID() });
            const input = (suffix, size = 1) => ({
              ownerId,
              conversationId: conversation.conversationId,
              uploadKey: `pg-upload-${suffix}`,
              fileName: `${suffix}.txt`,
              mimeType: 'text/plain',
              size,
              sha256: 'a'.repeat(64)
            });
            const duplicates = await Promise.all([
              first.stageAttachment(input('same')),
              second.stageAttachment(input('same'))
            ]);
            assert.equal(duplicates[0].attachmentId, duplicates[1].attachmentId);
            await assert.rejects(second.stageAttachment({ ...input('same'), sha256: 'b'.repeat(64) }), {
              code: 'AI_IDEMPOTENCY_CONFLICT'
            });
            const record = duplicates[0];
            assert.equal(record.parseStatus, 'not_parsed');
            assert.equal(record.errorCode, 'AI_ATTACHMENT_NOT_PARSED');
            assert.equal(record.parserVersion, null);
            assert.equal(record.parsedTextHash, null);
            assert.equal(record.imageMetadata, null);
            assert.deepEqual(record.segments, []);
            const patch = {
              storageStatus: 'removed',
              parseStatus: 'failed',
              removedAt: new Date().toISOString(),
              cleanupStatus: 'pending',
              errorCode: 'AI_ATTACHMENT_REMOVED',
              segments: [],
              parsedTextHash: null,
              imageMetadata: null,
              parserVersion: null
            };
            const writes = await Promise.allSettled([
              first.updateAttachment({
                ownerId,
                attachmentId: record.attachmentId,
                expectedRevision: record.revision,
                patch
              }),
              second.updateAttachment({
                ownerId,
                attachmentId: record.attachmentId,
                expectedRevision: record.revision,
                patch
              })
            ]);
            assert.equal(writes.filter(row => row.status === 'fulfilled').length, 1);
            assert.equal(writes.find(row => row.status === 'rejected').reason.code, 'AI_ATTACHMENT_CONFLICT');
            assert.equal((await second.getAttachment(record.attachmentId)).storageStatus, 'removed');
            assert.equal((await first.stageAttachment(input('same'))).storageStatus, 'removed');
            for (let n = 0; n < 19; n++) await first.stageAttachment(input(`count-${n}`));
            const count = await Promise.allSettled([
              first.stageAttachment(input('last-a')),
              second.stageAttachment(input('last-b'))
            ]);
            assert.equal(count.filter(row => row.status === 'fulfilled').length, 1);
            assert.equal(count.find(row => row.status === 'rejected').reason.code, 'AI_ATTACHMENT_QUOTA_EXCEEDED');
            assert.equal(
              (await second.listAttachments(conversation.conversationId)).filter(row => !row.removedAt).length,
              20
            );
            const bytesConversation = await first.createConversation({
              ownerId,
              actorId: ownerId,
              spaceId: conversation.spaceId
            });
            const large = suffix => ({
              ...input(suffix, 5 * 1024 * 1024),
              conversationId: bytesConversation.conversationId
            });
            for (let n = 0; n < 4; n++) await first.stageAttachment(large(`bytes-${n}`));
            const bytes = await Promise.allSettled([
              first.stageAttachment(large('bytes-a')),
              second.stageAttachment(large('bytes-b'))
            ]);
            assert.equal(bytes.filter(row => row.status === 'fulfilled').length, 1);
            assert.equal(bytes.find(row => row.status === 'rejected').reason.code, 'AI_ATTACHMENT_QUOTA_EXCEEDED');
            const isolated = createPostgresAiConversationStore({
              client: db,
              repository: createPostgresAiRepository({ client: db, ownerId: otherOwnerId }),
              ownerId: otherOwnerId
            });
            assert.equal(await isolated.getAttachment(record.attachmentId), null);
            await assert.rejects(isolated.stageAttachment({ ...input('other'), ownerId: otherOwnerId }), {
              code: 'AI_CONVERSATION_NOT_FOUND'
            });
            await repository.rotateEpoch();
            await assert.rejects(first.stageAttachment(input('new-epoch')), { code: 'AI_DATASET_STALE' });
            await assert.rejects(
              second.updateAttachment({
                ownerId,
                attachmentId: record.attachmentId,
                expectedRevision: record.revision + 1,
                patch: { cleanupStatus: 'complete' }
              }),
              { code: 'AI_DATASET_STALE' }
            );
            assert.equal((await second.getAttachment(record.attachmentId)).removedAt !== null, true);
          } finally {
            await db
              .$executeRawUnsafe(
                'DELETE FROM ai_conversation_records WHERE owner_id IN ($1, $2)',
                ownerId,
                otherOwnerId
              )
              .catch(() => {});
            await db
              .$executeRawUnsafe('DELETE FROM ai_runtime_epochs WHERE owner_id IN ($1, $2)', ownerId, otherOwnerId)
              .catch(() => {});
            await db.$disconnect();
          }
        }
      }
    ]
  : [];
