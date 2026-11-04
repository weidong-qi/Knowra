import { getKnowledgeOperationAccess } from './knowledge-operation-access.ts';
import type { KnowledgeOperationAccess } from './knowledge-operation-access.ts';
import type { PostgresTransactionHost } from './postgres-transaction-port.ts';
import type { HandlerResult } from './maintenance-gate.ts';

export interface AdvisoryLockTransaction {
  $queryRawUnsafe?: (query: string, ...parameters: number[]) => PromiseLike<object>;
}

export type AdvisoryLockClient<Transaction extends object> =
  PostgresTransactionHost<Transaction> | (Transaction & { $transaction?: undefined });

export interface AdvisoryLock {
  runShared<Result>(operation: () => Result | PromiseLike<Result>): Promise<Result>;
  runExclusive<Result>(operation: () => Result | PromiseLike<Result>): Promise<Result>;
}

export interface AdvisoryLockHandlerOptions {
  getAccess?: (name: string) => KnowledgeOperationAccess;
  skip?: (name: string) => boolean;
}

export type AdvisoryLockedHandlers<Handlers extends object> = {
  [Key in keyof Handlers]: Handlers[Key] extends (...args: infer Args) => infer Result
    ? (...args: Args) => Result | Promise<Awaited<Result>>
    : Handlers[Key];
};

const KNOWRA_LOCK_NAMESPACE = 1266775634;
const KNOWRA_LOCK_RESOURCE = 32;

async function acquireTransactionLock(
  transaction: AdvisoryLockTransaction | null | undefined,
  mode: 'shared' | 'exclusive'
) {
  if (typeof transaction?.$queryRawUnsafe !== 'function') return;
  const functionName = mode === 'shared' ? 'pg_advisory_xact_lock_shared' : 'pg_advisory_xact_lock';
  await transaction.$queryRawUnsafe(
    `SELECT ${functionName}($1::integer, $2::integer)::text AS lock_acquired`,
    KNOWRA_LOCK_NAMESPACE,
    KNOWRA_LOCK_RESOURCE
  );
}

export function createPostgresAdvisoryLock<Transaction extends object>(client: AdvisoryLockClient<Transaction>) {
  async function run<Result>(
    mode: 'shared' | 'exclusive',
    operation: (transaction: Transaction) => Result | PromiseLike<Result>
  ): Promise<Result> {
    if (typeof client?.$transaction !== 'function') {
      return operation(client);
    }
    return client.$transaction(
      async transaction => {
        await acquireTransactionLock(transaction as AdvisoryLockTransaction, mode);
        return operation(transaction);
      },
      { isolationLevel: 'Serializable' }
    );
  }

  return {
    runShared<Result>(operation: (transaction: Transaction) => Result | PromiseLike<Result>) {
      return run('shared', operation);
    },
    runExclusive<Result>(operation: (transaction: Transaction) => Result | PromiseLike<Result>) {
      return run('exclusive', operation);
    }
  };
}

export function wrapHandlersWithPostgresAdvisoryLock<Handlers extends object>(
  handlers: Handlers,
  advisoryLock: AdvisoryLock,
  {
    getAccess = getKnowledgeOperationAccess,
    skip = name => name === 'permanentlyDeleteNote' || name === 'emptyRecycleBin'
  }: AdvisoryLockHandlerOptions = {}
): AdvisoryLockedHandlers<Handlers> {
  return Object.fromEntries(
    Object.entries(handlers).map(([name, handler]) => {
      if (typeof handler !== 'function') return [name, handler];
      const access = getAccess(name);
      if (skip(name)) return [name, handler];
      return [
        name,
        (...args: never[]) =>
          access === 'mutation'
            ? advisoryLock.runExclusive(() => (handler as (...args: never[]) => HandlerResult<Handlers>)(...args))
            : advisoryLock.runShared(() => (handler as (...args: never[]) => HandlerResult<Handlers>)(...args))
      ];
    })
  ) as AdvisoryLockedHandlers<Handlers>;
}
