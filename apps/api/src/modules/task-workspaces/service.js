import { randomUUID } from 'node:crypto';
import { mutationNames, mutationFields, applyMutation } from './mutations.js';
import { createTaskWorkspaceTransactions } from './transaction-context.js';
import { createTaskWorkspaceQueries } from './queries.js';
import { createTaskWorkspaceAttachments } from './attachments.js';

/**
 * @typedef {object} TaskWorkspaceServiceDependencies
 * @property {ReturnType<typeof import('../../infrastructure/task-workspace-json-store.js').createJsonTaskWorkspaceStore> | null} store
 * @property {ReturnType<typeof import('../../infrastructure/task-workspace-files.js').createTaskWorkspaceFiles>} [files]
 * @property {typeof Date.now} [clock]
 * @property {typeof randomUUID} [idGenerator]
 * @property {Parameters<typeof createTaskWorkspaceTransactions>[0]['authorize']} [authorize]
 */
/** HTTP/MCP 共用领域服务；协议适配器不能自行修改状态。
 * @param {TaskWorkspaceServiceDependencies} dependencies
 */
export function createTaskWorkspaceService({ store, files, clock = Date.now, idGenerator = randomUUID, authorize }) {
  const { read, mutate } = createTaskWorkspaceTransactions({
    store,
    clock,
    idGenerator,
    authorize
  });
  const service = {
    ...createTaskWorkspaceQueries({ store, files, read, authorize }),
    ...createTaskWorkspaceAttachments({ files, read, mutate, idGenerator })
  };
  for (const kind of mutationNames) {
    service[kind] = (ctx, input) => {
      mutationFields(kind, input);
      return mutate(ctx, kind, input, (tx, helpers) => applyMutation(kind, tx, ctx, input, helpers));
    };
  }
  return service;
}
