import { fail, uuid, text, revision, safeAttempt, taskSummary, LIMITS } from './contract.ts';
import type {
  DocumentReference,
  RequirementRevision,
  Review
} from '../../../../../packages/web-core/src/task-workspaces/types.ts';
import type {
  AttemptRecord,
  TaskRecord,
  TaskWorkspaceContext,
  TaskWorkspaceMutation,
  TaskWorkspaceTransaction,
  TransactionHelpers
} from './repository-port.ts';

/** 任务发布、领取、续租、提交与人工验收的唯一状态机。 */
export function applyTaskMutation(
  kind: string,
  tx: TaskWorkspaceTransaction,
  ctx: TaskWorkspaceContext,
  input: TaskWorkspaceMutation,
  h: TransactionHelpers
) {
  const { now, iso, id, bound, entity, event, save, versionRef, liveWorkspace } = h;
  const user = () => {
    if (ctx.actor.kind !== 'user') fail('FORBIDDEN');
  };
  const agent = () => {
    if (ctx.actor.kind !== 'mcp') fail('FORBIDDEN');
  };
  const taskDTO = (t: TaskRecord) => taskSummary(t, tx, now, ctx.actor.kind === 'mcp');
  const workspace = liveWorkspace(input.workspaceId);
  if (kind === 'createTask') {
    user();
    const t: TaskRecord = {
      ...bound(),
      id: id(),
      workspaceId: workspace.id,
      title: text(input.title, 512),
      status: 'draft',
      revision: 1,
      requirements: [],
      currentRequirementId: null,
      activeAttemptId: null,
      reviews: [],
      events: [],
      createdAt: iso,
      updatedAt: iso
    };
    event(t, 'created');
    tx.insert('tasks', t);
    return { task: taskDTO(t) };
  }
  const t = entity('tasks', uuid(input.taskId), workspace.id);
  if (['publishTask', 'cancelTask', 'reviewSubmission', 'claimTask'].includes(kind)) {
    revision(input.expectedRevision);
    if (t.revision !== input.expectedRevision) fail('CONFLICT');
  }
  const finishActive = (status: AttemptRecord['status']) => {
    if (!t.activeAttemptId) return;
    const a = entity('attempts', t.activeAttemptId, workspace.id);
    if (a.status === 'running' || a.status === 'submitted') {
      a.status = status;
      a.leaseExpiresAt = null;
      a.finishedAt = iso;
      tx.replace('attempts', a);
    }
  };
  if (kind === 'publishTask') {
    user();
    if (!['draft', 'ready', 'running', 'review'].includes(t.status)) fail('CONFLICT');
    versionRef(input.description, workspace.id);
    if (
      !Array.isArray(input.acceptanceCriteria) ||
      !input.acceptanceCriteria.length ||
      input.acceptanceCriteria.length > 50
    )
      fail();
    const r: RequirementRevision = {
      id: id(),
      ordinal: t.requirements.length + 1,
      description: input.description as DocumentReference,
      acceptanceCriteria: input.acceptanceCriteria.map(c => text(c, 4096)),
      inScope: text(input.inScope, 16384, true),
      outOfScope: text(input.outOfScope, 16384, true),
      createdAt: iso,
      actor: ctx.actor
    };
    finishActive('superseded');
    t.requirements.push(r);
    t.currentRequirementId = r.id;
    t.activeAttemptId = null;
    t.status = 'ready';
    event(t, 'published', { requirementId: r.id });
    save('tasks', t);
    return { task: taskDTO(t) };
  }
  if (kind === 'cancelTask') {
    user();
    if (['accepted', 'cancelled'].includes(t.status)) fail('CONFLICT');
    finishActive('cancelled');
    t.status = 'cancelled';
    event(t, 'cancelled');
    save('tasks', t);
    return { task: taskDTO(t) };
  }
  if (kind === 'reviewSubmission') {
    user();
    uuid(input.submissionId);
    if (t.status !== 'review' || !t.activeAttemptId) fail('CONFLICT');
    const a = entity('attempts', t.activeAttemptId, workspace.id);
    if (
      a.status !== 'submitted' ||
      a.requirementId !== t.currentRequirementId ||
      a.submission?.id !== input.submissionId ||
      a.submission!.requirementId !== t.currentRequirementId
    )
      fail('CONFLICT');
    if (!['accepted', 'returned'].includes(input.decision!)) fail();
    const review: Review = {
      id: id(),
      submissionId: a.submission!.id,
      requirementId: t.currentRequirementId!,
      decision: input.decision as Review['decision'],
      comment: text(input.comment ?? '', 16384, true),
      createdAt: iso,
      actor: ctx.actor
    };
    t.reviews.push(review);
    t.status = input.decision === 'accepted' ? 'accepted' : 'ready';
    if (t.status === 'ready') t.activeAttemptId = null;
    event(t, input.decision!, {
      reviewId: review.id,
      submissionId: review.submissionId
    });
    save('tasks', t);
    return { task: taskDTO(t), review };
  }
  agent();
  if (kind === 'claimTask') {
    if (t.status === 'running') {
      const old = entity('attempts', t.activeAttemptId, workspace.id);
      if (old.status !== 'running' || Date.parse(old.leaseExpiresAt!) > now) fail('CONFLICT');
      old.status = 'expired';
      old.leaseExpiresAt = null;
      old.finishedAt = iso;
      tx.replace('attempts', old);
    } else if (t.status !== 'ready') fail('CONFLICT');
    const generation =
      Math.max(
        0,
        ...tx
          .list('attempts')
          .filter(a => a.taskId === t.id)
          .map(a => a.generation)
      ) + 1;
    const a: AttemptRecord = {
      ...bound(),
      id: id(),
      taskId: t.id,
      workspaceId: workspace.id,
      requirementId: t.currentRequirementId!,
      generation,
      actor: ctx.actor,
      status: 'running',
      leaseExpiresAt: new Date(now + LIMITS.leaseMs).toISOString(),
      progress: null,
      submission: null,
      startedAt: iso,
      finishedAt: null
    };
    tx.insert('attempts', a);
    t.activeAttemptId = a.id;
    t.status = 'running';
    event(t, 'claimed', { attemptId: a.id, generation });
    save('tasks', t);
    return { task: taskDTO(t), attempt: safeAttempt(a) };
  }
  uuid(input.attemptId);
  revision(input.generation);
  const a = entity('attempts', input.attemptId, workspace.id);
  if (
    t.status !== 'running' ||
    t.activeAttemptId !== a.id ||
    a.taskId !== t.id ||
    a.status !== 'running' ||
    a.generation !== input.generation ||
    a.actor.kind !== ctx.actor.kind ||
    a.actor.id !== ctx.actor.id ||
    a.requirementId !== t.currentRequirementId ||
    !a.leaseExpiresAt ||
    Date.parse(a.leaseExpiresAt) <= now
  )
    fail('LEASE_EXPIRED');
  if (kind === 'renewTask') {
    a.leaseExpiresAt = new Date(now + LIMITS.leaseMs).toISOString();
    event(t, 'renewed', { attemptId: a.id });
  }
  if (kind === 'reportProgress') {
    a.progress = {
      message: text(input.message, LIMITS.progress),
      updatedAt: iso
    };
    event(t, 'progress', { attemptId: a.id });
  }
  if (kind === 'releaseTask') {
    if (input.message !== undefined) text(input.message, LIMITS.progress, true);
    a.status = 'released';
    a.leaseExpiresAt = null;
    a.finishedAt = iso;
    t.status = 'ready';
    t.activeAttemptId = null;
    event(t, 'released', { attemptId: a.id });
  }
  if (kind === 'submitTask') {
    if (!Array.isArray(input.artifacts) || input.artifacts.length > LIMITS.artifacts) fail();
    for (const ref of input.artifacts) versionRef(ref, workspace.id);
    a.submission = {
      id: id(),
      requirementId: t.currentRequirementId!,
      summary: text(input.summary, LIMITS.summary),
      artifacts: input.artifacts,
      createdAt: iso
    };
    a.status = 'submitted';
    a.leaseExpiresAt = null;
    a.finishedAt = iso;
    t.status = 'review';
    event(t, 'submitted', { attemptId: a.id, submissionId: a.submission.id });
  }
  tx.replace('attempts', a);
  save('tasks', t);
  return { task: taskDTO(t), attempt: safeAttempt(a) };
}
