import { randomUUID } from 'node:crypto';
import { mutationNames, mutationFields, applyMutation } from './mutations.ts';
import { createTaskWorkspaceTransactions } from './transaction-context.ts';
import { createTaskWorkspaceQueries } from './queries.ts';
import { createTaskWorkspaceAttachments } from './attachments.ts';
import type { MutationKind } from './mutations.ts';
import type {
  AuthorizeTaskWorkspace,
  MutationData,
  TaskWorkspaceContext,
  TaskWorkspaceFiles,
  TaskWorkspaceStore
} from './repository-port.ts';
import type { MutationResult } from '../../../../../packages/web-core/src/task-workspaces/types.ts';

export interface TaskWorkspaceServiceDependencies {
  store: TaskWorkspaceStore | null;
  files?: TaskWorkspaceFiles | null;
  clock?: () => number | Date | string;
  idGenerator?: () => string;
  authorize?: AuthorizeTaskWorkspace;
}
type MutationHandler = (ctx: TaskWorkspaceContext, input: unknown) => MutationResult<MutationData>;
/** HTTP/MCP 共用领域服务；协议适配器不能自行修改状态。 */
export function createTaskWorkspaceService({
  store,
  files,
  clock = Date.now,
  idGenerator = randomUUID,
  authorize
}: TaskWorkspaceServiceDependencies) {
  const { read, mutate } = createTaskWorkspaceTransactions({
    store,
    clock,
    idGenerator,
    authorize
  });
  const service = {
    ...createTaskWorkspaceQueries({ store, files, read, authorize }),
    ...createTaskWorkspaceAttachments({ files, read, mutate, idGenerator })
  } as ReturnType<typeof createTaskWorkspaceQueries> &
    ReturnType<typeof createTaskWorkspaceAttachments> &
    Record<MutationKind, MutationHandler>;
  for (const kind of mutationNames) {
    service[kind] = (ctx, input) => {
      mutationFields(kind, input);
      return mutate(ctx, kind, input, (tx, helpers) => applyMutation(kind, tx, ctx, input, helpers));
    };
  }
  return service;
}
