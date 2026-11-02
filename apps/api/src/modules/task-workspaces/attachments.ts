import { fail, hash, uuid, text, fields, revision, imageReferences, imageUri, safeAttachment } from './contract.ts';
import type {
  AttachmentRecord,
  TaskWorkspaceContext,
  TaskWorkspaceFiles,
  TaskWorkspaceQuery,
  TaskWorkspaceTransactions,
  UploadAttachmentInput
} from './repository-port.ts';

export interface TaskWorkspaceAttachmentDependencies {
  files?: TaskWorkspaceFiles | null;
  read: TaskWorkspaceTransactions['read'];
  mutate: TaskWorkspaceTransactions['mutate'];
  idGenerator: () => string;
}

/** 文件 staging/读取在事务外；提交后的输出失败绝不能清理已归属文档的文件。 */
export function createTaskWorkspaceAttachments({
  files,
  read,
  mutate,
  idGenerator
}: TaskWorkspaceAttachmentDependencies) {
  return {
    async uploadAttachment(ctx: TaskWorkspaceContext, input: UploadAttachmentInput) {
      fields(
        input,
        ['operationId', 'workspaceId', 'documentId', 'expectedRevision', 'fileName', 'mimeType', 'bytes'],
        ['operationId', 'workspaceId', 'documentId', 'expectedRevision', 'fileName', 'mimeType', 'bytes']
      );
      uuid(input.operationId);
      uuid(input.documentId);
      revision(input.expectedRevision);
      text(input.fileName, 512);
      if (ctx.actor.kind !== 'user') fail('FORBIDDEN');
      if (!files) fail('UNAVAILABLE');
      if (!Buffer.isBuffer(input.bytes) && !(input.bytes instanceof Uint8Array)) fail();
      const bytes = Buffer.from(input.bytes);
      const request = { ...input, bytes: undefined, bytesHash: hash(bytes) };
      delete request.bytes;
      read(ctx, 'uploadAttachment', input, (tx, h) => {
        h.liveWorkspace(input.workspaceId);
        h.entity('documents', input.documentId, input.workspaceId);
      });
      const attachmentId = idGenerator();
      const staged = await files.stage({ ...input, attachmentId, bytes });
      let committed = false;
      try {
        const result = mutate(
          ctx,
          'uploadAttachment',
          request,
          (tx, h) => {
            h.liveWorkspace(input.workspaceId);
            const d = h.entity('documents', input.documentId, input.workspaceId);
            if (d.revision !== input.expectedRevision) fail('CONFLICT');
            const a: AttachmentRecord = {
              ...staged.metadata,
              id: attachmentId,
              documentId: d.id,
              status: 'ready',
              createdAt: h.iso
            };
            d.attachments.push(a);
            h.save('documents', d);
            return {
              attachment: safeAttachment(a),
              documentRevision: d.revision,
              imageUri: imageUri(d.workspaceId, d.id, a.id)
            };
          },
          result => {
            if (!result.reused) {
              committed = true;
              staged.commit();
            }
          }
        );
        if (result.reused) await staged.discard();
        return result;
      } catch (error) {
        if (!committed) await staged.discard();
        throw error;
      }
    },
    async readAttachment(ctx: TaskWorkspaceContext, input: TaskWorkspaceQuery) {
      fields<Required<Pick<TaskWorkspaceQuery, 'workspaceId' | 'documentId' | 'versionId' | 'attachmentId'>>>(
        input,
        ['workspaceId', 'documentId', 'versionId', 'attachmentId'],
        ['workspaceId', 'documentId', 'versionId', 'attachmentId']
      );
      if (!files) fail('UNAVAILABLE');
      const snapshot = () =>
        read(ctx, 'readAttachment', input, (tx, h) => {
          h.liveWorkspace(input.workspaceId);
          const { document: d, version: v } = h.versionRef(
            { documentId: input.documentId, versionId: input.versionId },
            input.workspaceId
          );
          const a = d.attachments.find(a => a.id === uuid(input.attachmentId));
          if (!a || !imageReferences(v.markdown, d.workspaceId, d.id, d.attachments).has(a.id)) fail('FORBIDDEN');
          return { attachment: a, versionContentHash: v.contentHash };
        });
      const captured = snapshot();
      const { attachment, versionContentHash } = captured;
      const data = await files.read(attachment);
      if (hash(data.bytes) !== attachment.sha256 || hash(snapshot()) !== hash(captured)) fail('FORBIDDEN');
      return {
        ...data,
        attachment: safeAttachment(attachment),
        workspaceId: input.workspaceId,
        documentId: input.documentId,
        versionId: input.versionId,
        versionContentHash
      };
    }
  };
}
