import { fail, text, revision, uuid, hash, imageReferences, safeWorkspace, safeDocument, LIMITS } from './contract.ts';
import type {
  DocumentRecord,
  TaskWorkspaceContext,
  TaskWorkspaceMutation,
  TaskWorkspaceTransaction,
  TransactionHelpers
} from './repository-port.ts';

/** 工作区与不可变协作文档写入；任务执行状态在 task-lifecycle 中唯一维护。 */
export function applyWorkspaceMutation(
  kind: string,
  tx: TaskWorkspaceTransaction,
  ctx: TaskWorkspaceContext,
  input: TaskWorkspaceMutation,
  h: TransactionHelpers
) {
  const { iso, id, bound, entity, event, save, liveWorkspace } = h;
  const user = () => {
    if (ctx.actor.kind !== 'user') fail('FORBIDDEN');
  };
  if (kind === 'createWorkspace') {
    user();
    const w = {
      ...bound(),
      id: id(),
      name: text(input.name, 512),
      description: text(input.description ?? '', 4096, true),
      archivedAt: null,
      revision: 1,
      createdAt: iso,
      updatedAt: iso
    };
    tx.insert('workspaces', w);
    return { workspace: safeWorkspace(w) };
  }
  const workspace = liveWorkspace(input.workspaceId);
  if (kind === 'archiveWorkspace') {
    user();
    revision(input.expectedRevision);
    if (workspace.revision !== input.expectedRevision) fail('CONFLICT');
    workspace.archivedAt = iso;
    save('workspaces', workspace);
    for (const t of tx
      .list('tasks')
      .filter(t => t.workspaceId === workspace.id && ['running', 'ready', 'review', 'draft'].includes(t.status))) {
      if (t.activeAttemptId) {
        const a = entity('attempts', t.activeAttemptId);
        if (a.status === 'running') {
          a.status = 'cancelled';
          a.leaseExpiresAt = null;
          a.finishedAt = iso;
          tx.replace('attempts', a);
        }
      }
      t.status = 'cancelled';
      event(t, 'workspaceArchived');
      save('tasks', t);
    }
    return { workspace: safeWorkspace(workspace) };
  }
  if (kind === 'createDocument') {
    const documentId = id();
    const markdown = text(input.markdown, LIMITS.markdown, true);
    imageReferences(markdown, workspace.id, documentId, []);
    const v = {
      id: id(),
      ordinal: 1,
      markdown,
      contentHash: hash(markdown),
      createdAt: iso,
      actor: ctx.actor
    };
    const d: DocumentRecord = {
      ...bound(),
      id: documentId,
      workspaceId: workspace.id,
      title: text(input.title, 512),
      revision: 1,
      currentVersionId: v.id,
      versions: [v],
      attachments: [],
      createdAt: iso,
      updatedAt: iso
    };
    tx.insert('documents', d);
    return { document: safeDocument(d) };
  }
  if (kind === 'updateDocument') {
    const d = entity('documents', uuid(input.documentId), workspace.id);
    revision(input.expectedRevision);
    if (d.revision !== input.expectedRevision) fail('CONFLICT');
    if (input.title === undefined && input.markdown === undefined) fail();
    if (input.title !== undefined) d.title = text(input.title, 512);
    if (input.markdown !== undefined) {
      const markdown = text(input.markdown, LIMITS.markdown, true);
      imageReferences(markdown, workspace.id, d.id, d.attachments);
      const v = {
        id: id(),
        ordinal: d.versions.length + 1,
        markdown,
        contentHash: hash(markdown),
        createdAt: iso,
        actor: ctx.actor
      };
      d.versions.push(v);
      d.currentVersionId = v.id;
    }
    save('documents', d);
    return { document: safeDocument(d) };
  }
}
