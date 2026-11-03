import { fields, uuid } from './contract.ts';
import { applyWorkspaceMutation } from './workspace-mutations.ts';
import { applyTaskMutation } from './task-lifecycle.ts';
import type {
  TaskWorkspaceContext,
  TaskWorkspaceMutation,
  TaskWorkspaceTransaction,
  TransactionHelpers
} from './repository-port.ts';
const configs = {
  createWorkspace: ['name', 'description'],
  archiveWorkspace: ['expectedRevision'],
  createDocument: ['title', 'markdown'],
  updateDocument: ['documentId', 'expectedRevision', 'title', 'markdown'],
  createTask: ['title'],
  publishTask: ['taskId', 'expectedRevision', 'description', 'acceptanceCriteria', 'inScope', 'outOfScope'],
  cancelTask: ['taskId', 'expectedRevision'],
  reviewSubmission: ['taskId', 'expectedRevision', 'submissionId', 'decision', 'comment'],
  claimTask: ['taskId', 'expectedRevision'],
  renewTask: ['taskId', 'attemptId', 'generation'],
  reportProgress: ['taskId', 'attemptId', 'generation', 'message'],
  submitTask: ['taskId', 'attemptId', 'generation', 'summary', 'artifacts'],
  releaseTask: ['taskId', 'attemptId', 'generation', 'message']
};
export type MutationKind = keyof typeof configs;
export const mutationNames = Object.keys(configs) as MutationKind[];
export function mutationFields(kind: MutationKind, input: unknown): asserts input is TaskWorkspaceMutation {
  fields<TaskWorkspaceMutation>(
    input,
    ['operationId', 'workspaceId', ...configs[kind]],
    ['operationId', ...(kind === 'createWorkspace' ? [] : ['workspaceId'])]
  );
  uuid(input.operationId);
  if (input.workspaceId) uuid(input.workspaceId);
}

export function applyMutation(
  kind: MutationKind,
  tx: TaskWorkspaceTransaction,
  ctx: TaskWorkspaceContext,
  input: TaskWorkspaceMutation,
  helpers: TransactionHelpers
) {
  return ['createWorkspace', 'archiveWorkspace', 'createDocument', 'updateDocument'].includes(kind)
    ? applyWorkspaceMutation(kind, tx, ctx, input, helpers)!
    : applyTaskMutation(kind, tx, ctx, input, helpers);
}
