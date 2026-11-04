import { fail, hash, uuid, fields, safeWorkspace, safeDocument, safeAttempt, taskSummary } from './contract.ts';
import type { TaskWorkspaceCapabilities } from '../../../../../packages/web-core/src/task-workspaces/types.ts';
import type {
  AuthorizeTaskWorkspace,
  TaskWorkspaceContext,
  TaskWorkspaceFiles,
  TaskWorkspaceQuery,
  TaskWorkspaceStore,
  TaskWorkspaceTransaction,
  TaskWorkspaceTransactions
} from './repository-port.ts';

export interface TaskWorkspaceQueryDependencies {
  store: TaskWorkspaceStore | null;
  files?: TaskWorkspaceFiles | null;
  read: TaskWorkspaceTransactions['read'];
  authorize?: AuthorizeTaskWorkspace;
}

export function createTaskWorkspaceQueries({ store, files, read, authorize }: TaskWorkspaceQueryDependencies) {
  function page<T>(
    tx: TaskWorkspaceTransaction,
    ctx: TaskWorkspaceContext,
    action: string,
    input: TaskWorkspaceQuery,
    items: T[]
  ) {
    const limit = input.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail();
    const binding = hash({
      action,
      workspaceId: input.workspaceId ?? null,
      status: input.status ?? null,
      actor: ctx.actor,
      epoch: ctx.datasetEpoch,
      authorizationRevision: ctx.authorizationRevision ?? null,
      items
    });
    let offset = 0;
    if (input.cursor) {
      try {
        const c = JSON.parse(Buffer.from(input.cursor, 'base64url').toString()) as { binding: string; offset: number };
        if (c.binding !== binding || !Number.isInteger(c.offset) || c.offset < 0 || c.offset > items.length)
          fail('CURSOR_INVALID');
        offset = c.offset;
      } catch {
        fail('CURSOR_INVALID');
      }
    }
    const slice = items.slice(offset, offset + limit);
    return {
      items: slice,
      nextCursor:
        offset + limit < items.length
          ? Buffer.from(JSON.stringify({ binding, offset: offset + limit })).toString('base64url')
          : null
    };
  }
  return {
    capabilities(ctx: TaskWorkspaceContext): TaskWorkspaceCapabilities {
      if (!store || store.available === false)
        return {
          available: false,
          contractVersion: 1,
          datasetId: null,
          datasetEpoch: null,
          images: false,
          reasonCode: 'TASK_WORKSPACE_UNAVAILABLE'
        };
      return read(ctx, 'capabilities', {}, tx => ({
        available: true,
        contractVersion: 1,
        ...tx.identity(),
        images: Boolean(files),
        reasonCode: null
      }));
    },
    listWorkspaces(ctx: TaskWorkspaceContext, input: TaskWorkspaceQuery = {}) {
      fields(input, ['limit', 'cursor']);
      return read(ctx, 'listWorkspaces', input, tx => {
        const rows = tx
          .list('workspaces')
          .filter(w => w.datasetId === ctx.datasetId && w.datasetEpoch === ctx.datasetEpoch && !w.archivedAt)
          .filter(w => authorize!(ctx, { action: 'listWorkspaces', workspaceId: w.id }, tx) !== false)
          .map(safeWorkspace);
        return page(tx, ctx, 'listWorkspaces', input, rows);
      });
    },
    getWorkspace(ctx: TaskWorkspaceContext, input: TaskWorkspaceQuery) {
      fields(input, ['workspaceId'], ['workspaceId']);
      return read(ctx, 'getWorkspace', input, (tx, h) => safeWorkspace(h.liveWorkspace(input.workspaceId)));
    },
    listDocuments(ctx: TaskWorkspaceContext, input: TaskWorkspaceQuery) {
      fields(input, ['workspaceId', 'limit', 'cursor'], ['workspaceId']);
      return read(ctx, 'listDocuments', input, (tx, h) => {
        h.liveWorkspace(input.workspaceId);
        return page(
          tx,
          ctx,
          'listDocuments',
          input,
          tx
            .list('documents')
            .filter(d => d.workspaceId === input.workspaceId)
            .map(d => safeDocument(d))
        );
      });
    },
    getDocument(ctx: TaskWorkspaceContext, input: TaskWorkspaceQuery) {
      fields(input, ['workspaceId', 'documentId', 'versionId', 'start'], ['workspaceId', 'documentId']);
      return read(ctx, 'getDocument', input, (tx, h) => {
        h.liveWorkspace(input.workspaceId);
        return safeDocument(
          h.entity('documents', uuid(input.documentId), input.workspaceId),
          input.versionId === undefined ? undefined : uuid(input.versionId),
          input.start ?? 0
        );
      });
    },
    listTasks(ctx: TaskWorkspaceContext, input: TaskWorkspaceQuery) {
      fields(input, ['workspaceId', 'status', 'limit', 'cursor'], ['workspaceId']);
      if (input.status && !['draft', 'ready', 'running', 'review', 'accepted', 'cancelled'].includes(input.status))
        fail();
      return read(ctx, 'listTasks', input, (tx, h) => {
        h.liveWorkspace(input.workspaceId);
        const execute =
          ctx.actor.kind === 'mcp' &&
          authorize!(ctx, { action: 'claimTask', workspaceId: input.workspaceId! }, tx) !== false;
        const rows = tx
          .list('tasks')
          .filter(t => t.workspaceId === input.workspaceId && (!input.status || t.status === input.status))
          .map(t => taskSummary(t, tx, h.now, execute));
        return page(tx, ctx, 'listTasks', input, rows);
      });
    },
    getTask(ctx: TaskWorkspaceContext, input: TaskWorkspaceQuery) {
      fields(input, ['workspaceId', 'taskId'], ['workspaceId', 'taskId']);
      return read(ctx, 'getTask', input, (tx, h) => {
        h.liveWorkspace(input.workspaceId);
        const t = h.entity('tasks', uuid(input.taskId), input.workspaceId);
        const a = t.activeAttemptId ? h.entity('attempts', t.activeAttemptId, input.workspaceId) : null;
        return {
          ...taskSummary(
            t,
            tx,
            h.now,
            ctx.actor.kind === 'mcp' &&
              authorize!(ctx, { action: 'claimTask', workspaceId: input.workspaceId! }, tx) !== false
          ),
          currentRequirement: t.requirements.find(r => r.id === t.currentRequirementId) ?? null,
          currentAttempt: safeAttempt(a),
          latestReview: t.reviews.at(-1) ?? null,
          events: { afterSequence: 0 }
        };
      });
    },
    listTaskEvents(ctx: TaskWorkspaceContext, input: TaskWorkspaceQuery) {
      fields(input, ['workspaceId', 'taskId', 'afterSequence', 'limit'], ['workspaceId', 'taskId']);
      return read(ctx, 'listTaskEvents', input, (tx, h) => {
        h.liveWorkspace(input.workspaceId);
        const t = h.entity('tasks', uuid(input.taskId), input.workspaceId);
        const after = input.afterSequence ?? 0,
          limit = input.limit ?? 20;
        if (!Number.isSafeInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 50) fail();
        const rows = t.events.filter(e => e.sequence > after),
          items = rows.slice(0, limit);
        return {
          items,
          nextAfterSequence: rows.length > limit ? items.at(-1)!.sequence : null
        };
      });
    }
  };
}
