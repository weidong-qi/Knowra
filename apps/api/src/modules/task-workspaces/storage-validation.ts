import { hash, imageReferences } from './contract.ts';
import { TASK_WORKSPACE_COLLECTIONS } from './repository-port.ts';
import type { Actor, DocumentReference } from '../../../../../packages/web-core/src/task-workspaces/types.ts';
import type {
  AttemptRecord,
  Collection,
  DatasetIdentity,
  TaskRecord,
  TaskWorkspaceRecords,
  TaskWorkspaceSnapshot
} from './repository-port.ts';

const id = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 512;
const uuid = (value: unknown) =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const iso = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const revision = (value: unknown) => Number.isSafeInteger(value) && (value as number) > 0;
const actor = (value: Actor | null | undefined) => value && ['user', 'mcp'].includes(value.kind) && id(value.id);
function check(value: object | string | number | boolean | null | undefined): asserts value {
  if (!value) throw new Error('任务工作区持久化资料或引用校验失败。');
}
const unique = <T>(values: T[]) => new Set(values).size === values.length;
export const taskAttachmentStorageKey = (workspaceId: string, documentId: string, attachmentId: string) =>
  `task-workspaces/${workspaceId}/${documentId}/${attachmentId}.bin`;

/** 只验证结构、不可变内容及关系；业务转换唯一实现位于 service。 */
export function validateTaskWorkspaceSnapshot(value: unknown): TaskWorkspaceSnapshot {
  const snapshot = value as TaskWorkspaceSnapshot;
  check(snapshot?.version === 1 && id(snapshot.datasetId) && id(snapshot.datasetEpoch));
  const maps = {} as { [K in Collection]: Map<string, TaskWorkspaceRecords[K]> };
  for (const kind of TASK_WORKSPACE_COLLECTIONS) {
    const values = snapshot[kind];
    check(Array.isArray(values) && unique(values.map(value => value?.id)));
    (maps as Record<Collection, Map<string, TaskWorkspaceRecords[Collection]>>)[kind] = new Map(
      values.map(value => {
        check(value && id(value.id) && id(value.datasetId) && id(value.datasetEpoch));
        if (kind !== 'receipts')
          check(
            uuid(value.id) && value.datasetId === snapshot.datasetId && value.datasetEpoch === snapshot.datasetEpoch
          );
        return [value.id, value] as const;
      })
    );
  }
  const documentRef = (ref: DocumentReference, workspaceId: string) => {
    const document = maps.documents.get(ref?.documentId);
    check(document?.workspaceId === workspaceId && document.versions.some(version => version.id === ref.versionId));
  };
  for (const workspace of snapshot.workspaces)
    check(
      typeof workspace.name === 'string' &&
        typeof workspace.description === 'string' &&
        revision(workspace.revision) &&
        iso(workspace.createdAt) &&
        iso(workspace.updatedAt) &&
        (workspace.archivedAt === null || iso(workspace.archivedAt))
    );
  for (const document of snapshot.documents) {
    check(
      maps.workspaces.has(document.workspaceId) &&
        typeof document.title === 'string' &&
        revision(document.revision) &&
        iso(document.createdAt) &&
        iso(document.updatedAt) &&
        Array.isArray(document.versions) &&
        document.versions.length > 0 &&
        Array.isArray(document.attachments) &&
        unique(document.versions.map(v => v.id)) &&
        unique(document.attachments.map(a => a.id))
    );
    check(document.versions.some(v => v.id === document.currentVersionId));
    for (const attachment of document.attachments)
      check(
        uuid(attachment.id) &&
          attachment.documentId === document.id &&
          typeof attachment.fileName === 'string' &&
          attachment.fileName.trim() &&
          attachment.fileName.length <= 255 &&
          !/[\\/]|[^\x20-\x7e\u0080-\uffff]/.test(attachment.fileName) &&
          ['image/png', 'image/jpeg', 'image/webp'].includes(attachment.mimeType) &&
          Number.isSafeInteger(attachment.size) &&
          attachment.size > 0 &&
          attachment.size <= 5 * 1024 * 1024 &&
          /^[a-f0-9]{64}$/.test(attachment.sha256) &&
          attachment.status === 'ready' &&
          iso(attachment.createdAt) &&
          attachment.storageKey === taskAttachmentStorageKey(document.workspaceId, document.id, attachment.id)
      );
    for (const [index, version] of document.versions.entries()) {
      check(
        uuid(version.id) &&
          version.ordinal === index + 1 &&
          typeof version.markdown === 'string' &&
          version.contentHash === hash(version.markdown) &&
          iso(version.createdAt) &&
          actor(version.actor)
      );
      imageReferences(version.markdown, document.workspaceId, document.id, document.attachments);
    }
  }
  for (const task of snapshot.tasks) {
    check(
      maps.workspaces.has(task.workspaceId) &&
        typeof task.title === 'string' &&
        revision(task.revision) &&
        ['draft', 'ready', 'running', 'review', 'accepted', 'cancelled'].includes(task.status) &&
        Array.isArray(task.requirements) &&
        Array.isArray(task.reviews) &&
        Array.isArray(task.events) &&
        unique(task.requirements.map(r => r.id)) &&
        unique(task.reviews.map(r => r.id)) &&
        iso(task.createdAt) &&
        iso(task.updatedAt)
    );
    for (const [index, requirement] of task.requirements.entries()) {
      check(
        uuid(requirement.id) &&
          requirement.ordinal === index + 1 &&
          actor(requirement.actor) &&
          requirement.actor.kind === 'user' &&
          iso(requirement.createdAt) &&
          Array.isArray(requirement.acceptanceCriteria) &&
          requirement.acceptanceCriteria.every(c => typeof c === 'string') &&
          typeof requirement.inScope === 'string' &&
          typeof requirement.outOfScope === 'string'
      );
      documentRef(requirement.description, task.workspaceId);
    }
    check(task.currentRequirementId === null || task.requirements.some(r => r.id === task.currentRequirementId));
    if (['ready', 'running', 'review', 'accepted'].includes(task.status)) check(task.currentRequirementId !== null);
    if (task.activeAttemptId !== null) {
      const attempt = maps.attempts.get(task.activeAttemptId);
      check(attempt?.taskId === task.id && attempt.workspaceId === task.workspaceId);
      if (['running', 'review', 'accepted'].includes(task.status))
        check(attempt.requirementId === task.currentRequirementId);
      if (task.status === 'running') check(attempt.status === 'running');
      if (['review', 'accepted'].includes(task.status)) check(attempt.status === 'submitted');
    } else check(!['running', 'review', 'accepted'].includes(task.status));
    for (const review of task.reviews) {
      check(
        uuid(review.id) &&
          ['accepted', 'returned'].includes(review.decision) &&
          typeof review.comment === 'string' &&
          actor(review.actor) &&
          review.actor.kind === 'user' &&
          iso(review.createdAt)
      );
      check(
        [...maps.attempts.values()].some(
          a =>
            a.taskId === task.id && a.requirementId === review.requirementId && a.submission?.id === review.submissionId
        )
      );
    }
    for (const [index, event] of task.events.entries())
      check(
        event.sequence === index + 1 &&
          typeof event.type === 'string' &&
          actor(event.actor) &&
          iso(event.createdAt) &&
          event.data &&
          typeof event.data === 'object' &&
          !Array.isArray(event.data) &&
          Object.keys(event.data).every(key =>
            ['requirementId', 'reviewId', 'submissionId', 'attemptId', 'generation'].includes(key)
          ) &&
          JSON.stringify(event.data).length <= 4096
      );
    if (task.status === 'accepted') {
      const review = task.reviews.at(-1),
        attempt = maps.attempts.get(task.activeAttemptId!);
      check(
        review?.decision === 'accepted' &&
          review.requirementId === task.currentRequirementId &&
          review.submissionId === attempt?.submission?.id
      );
    }
  }
  check(unique(snapshot.attempts.map(a => `${a.taskId}:${a.generation}`)));
  for (const attempt of snapshot.attempts) {
    const task = maps.tasks.get(attempt.taskId);
    check(
      task?.workspaceId === attempt.workspaceId &&
        task.requirements.some(r => r.id === attempt.requirementId) &&
        revision(attempt.generation) &&
        actor(attempt.actor) &&
        attempt.actor.kind === 'mcp' &&
        ['running', 'submitted', 'released', 'expired', 'superseded', 'cancelled'].includes(attempt.status) &&
        iso(attempt.startedAt)
    );
    check(
      attempt.status === 'running'
        ? iso(attempt.leaseExpiresAt) && attempt.finishedAt === null
        : attempt.leaseExpiresAt === null && iso(attempt.finishedAt)
    );
    if (attempt.status === 'running')
      check(
        task.status === 'running' &&
          task.activeAttemptId === attempt.id &&
          task.currentRequirementId === attempt.requirementId
      );
    if (attempt.progress !== null)
      check(typeof attempt.progress?.message === 'string' && iso(attempt.progress.updatedAt));
    if (attempt.submission !== null) {
      const submission = attempt.submission;
      check(
        uuid(submission.id) &&
          submission.requirementId === attempt.requirementId &&
          typeof submission.summary === 'string' &&
          iso(submission.createdAt) &&
          Array.isArray(submission.artifacts) &&
          submission.artifacts.length <= 20
      );
      submission.artifacts.forEach(ref => documentRef(ref, attempt.workspaceId));
    }
    if (attempt.status === 'submitted') check(attempt.submission !== null);
  }
  for (const receipt of snapshot.receipts)
    check(
      uuid(receipt.operationId) &&
        actor(receipt.actor) &&
        receipt.id === hash([receipt.datasetId, receipt.actor.kind, receipt.actor.id, receipt.operationId]) &&
        maps.workspaces.has(receipt.workspaceId) &&
        typeof receipt.kind === 'string' &&
        /^[a-f0-9]{64}$/.test(receipt.requestHash) &&
        receipt.result &&
        iso(receipt.createdAt)
    );
  return snapshot;
}

/** 恢复是新的运行世代，旧回执只保留审计，不能复活租约。 */
export function rebindTaskWorkspaceSnapshot(
  snapshot: TaskWorkspaceSnapshot,
  { datasetId, datasetEpoch, now = new Date().toISOString() }: DatasetIdentity & { now?: string }
) {
  const next = structuredClone(snapshot);
  next.datasetId = datasetId;
  next.datasetEpoch = datasetEpoch;
  for (const kind of TASK_WORKSPACE_COLLECTIONS.filter(kind => kind !== 'receipts'))
    for (const record of next[kind]) {
      record.datasetId = datasetId;
      record.datasetEpoch = datasetEpoch;
      if (kind === 'attempts' && (record as AttemptRecord).status === 'running') {
        const attempt = record as AttemptRecord;
        attempt.status = 'expired';
        attempt.leaseExpiresAt = null;
        attempt.finishedAt = now;
      }
      if (kind === 'tasks' && (record as TaskRecord).status === 'running') {
        const task = record as TaskRecord;
        task.status = 'ready';
        task.activeAttemptId = null;
        task.revision++;
        task.updatedAt = now;
      }
    }
  return validateTaskWorkspaceSnapshot(next);
}
