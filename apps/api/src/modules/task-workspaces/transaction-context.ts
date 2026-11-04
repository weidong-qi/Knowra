import { fail, hash, uuid, fields, identity, imageReferences } from './contract.ts';
import type { DocumentReference, MutationResult } from '../../../../../packages/web-core/src/task-workspaces/types.ts';
import type {
  AuthorizeTaskWorkspace,
  Collection,
  GuardResult,
  MutationData,
  TaskWorkspaceContext,
  TaskWorkspaceMutation,
  TaskWorkspaceQuery,
  TaskWorkspaceRecords,
  TaskWorkspaceStore,
  TaskWorkspaceTransaction,
  TransactionHelpers
} from './repository-port.ts';

export interface TaskWorkspaceTransactionDependencies {
  store: TaskWorkspaceStore | null;
  clock: () => number | Date | string;
  idGenerator: () => string;
  authorize?: AuthorizeTaskWorkspace;
}

/** 同步事务内核：先授权，提交前复核，receipt 与领域记录同一次提交。 */
export function createTaskWorkspaceTransactions({
  store,
  clock,
  idGenerator,
  authorize
}: TaskWorkspaceTransactionDependencies) {
  const time = () => {
    const n = clock();
    return n instanceof Date ? n.getTime() : Number(n);
  };
  function check(
    tx: TaskWorkspaceTransaction,
    ctx: TaskWorkspaceContext,
    action: string,
    input: TaskWorkspaceQuery = {}
  ) {
    identity(tx, ctx);
    if (typeof ctx.guard !== 'function' || typeof authorize !== 'function') fail('FORBIDDEN');
    const guarded = ctx.guard() as GuardResult & { then?: PromiseLike<boolean | void>['then'] },
      authorized = authorize(ctx, { action, workspaceId: input.workspaceId ?? null }, tx) as GuardResult & {
        then?: PromiseLike<boolean | void>['then'];
      };
    if (guarded === false || guarded?.then || authorized === false || authorized?.then) fail('FORBIDDEN');
  }
  function available() {
    if (!store || store.available === false) fail('UNAVAILABLE');
  }
  function helpers(tx: TaskWorkspaceTransaction, ctx: TaskWorkspaceContext): TransactionHelpers {
    const now = time(),
      iso = new Date(now).toISOString();
    const bound = () => ({
      datasetId: ctx.datasetId!,
      datasetEpoch: ctx.datasetEpoch!
    });
    const entity = <K extends Collection>(
      collection: K,
      id: string | null | undefined,
      workspaceId?: string
    ): TaskWorkspaceRecords[K] => {
      const row = tx.get(collection, id!);
      if (
        !row ||
        row.datasetId !== ctx.datasetId ||
        row.datasetEpoch !== ctx.datasetEpoch ||
        (workspaceId && (row as { workspaceId?: string }).workspaceId !== workspaceId)
      )
        fail('FORBIDDEN');
      return row;
    };
    const liveWorkspace = (id: string | undefined) => {
      const w = entity('workspaces', uuid(id));
      if (w.archivedAt) fail('CONFLICT');
      return w;
    };
    const versionRef: TransactionHelpers['versionRef'] = (ref, workspaceId) => {
      fields<DocumentReference>(ref, ['documentId', 'versionId'], ['documentId', 'versionId']);
      const d = entity('documents', uuid(ref.documentId), workspaceId);
      const v = d.versions.find(v => v.id === uuid(ref.versionId));
      if (!v) fail('FORBIDDEN');
      imageReferences(v.markdown, workspaceId, d.id, d.attachments);
      return { document: d, version: v };
    };
    return {
      now,
      iso,
      id: idGenerator,
      bound,
      entity,
      liveWorkspace,
      versionRef,
      event(t, type, data = {}) {
        t.events.push({
          sequence: t.events.length + 1,
          type,
          actor: ctx.actor,
          createdAt: iso,
          data
        });
      },
      save(collection, row) {
        const expected = row.revision;
        row.revision++;
        row.updatedAt = iso;
        tx.replace(collection, row, expected);
      }
    };
  }
  function read<T>(
    ctx: TaskWorkspaceContext,
    action: string,
    input: TaskWorkspaceQuery,
    fn: (tx: TaskWorkspaceTransaction, helpers: TransactionHelpers) => T
  ): T {
    available();
    return store!.readSnapshot(tx => {
      check(tx, ctx, action, input);
      const value = fn(tx, helpers(tx, ctx));
      check(tx, ctx, action, input);
      return structuredClone(value);
    });
  }
  function mutate<T extends MutationData>(
    ctx: TaskWorkspaceContext,
    kind: string,
    input: TaskWorkspaceMutation,
    operation: (tx: TaskWorkspaceTransaction, helpers: TransactionHelpers) => T,
    onCommitted?: (result: MutationResult<T>) => void
  ): MutationResult<T> {
    available();
    let transactionTx: TaskWorkspaceTransaction;
    const result = store!.runTransaction(
      tx => {
        transactionTx = tx;
        check(tx, ctx, kind, input);
        if (ctx.actor.kind === 'mcp' && input.workspaceId) helpers(tx, ctx).liveWorkspace(input.workspaceId);
        const key = hash([ctx.datasetId, ctx.actor.kind, ctx.actor.id, input.operationId]);
        const requestHash = hash({
          kind,
          input,
          actor: ctx.actor,
          datasetEpoch: ctx.datasetEpoch
        });
        const existing = tx.get('receipts', key);
        if (existing) {
          if (existing.datasetEpoch !== ctx.datasetEpoch || existing.requestHash !== requestHash) fail('CONFLICT');
          check(tx, ctx, kind, input);
          return {
            operationId: input.operationId,
            reused: true,
            data: existing.result as T
          };
        }
        const h = helpers(tx, ctx);
        const data = operation(tx, h);
        check(tx, ctx, kind, input);
        tx.insert('receipts', {
          id: key,
          ...h.bound(),
          operationId: input.operationId,
          actor: ctx.actor,
          workspaceId: (input.workspaceId ?? data.workspace?.id)!,
          kind,
          requestHash,
          result: structuredClone(data),
          createdAt: h.iso
        });
        check(tx, ctx, kind, input);
        return { operationId: input.operationId, reused: false, data };
      },
      { beforeCommit: () => check(transactionTx, ctx, kind, input) }
    );
    onCommitted?.(result);
    store!.readSnapshot(tx => check(tx, ctx, kind, input));
    return structuredClone(result);
  }
  return { read, mutate };
}
