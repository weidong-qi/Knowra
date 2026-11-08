import { randomUUID } from 'node:crypto';
import { hashRecord, scopeHash } from './record-contract.ts';
import type { AiRecordRepositoryPort, AiScopeSnapshot } from './record-types.ts';
import { createAppError } from '../../errors/app-error.ts';

const LEASE_MS = 5 * 60_000;

interface TranslationTaskOptions {
  repository: Pick<AiRecordRepositoryPort, 'identity' | 'get' | 'list' | 'insert' | 'replace'>;
  ownerId: string;
  now: () => Date;
}

/** 复用三种存储的 AI 任务记录；只保存调用元数据和摘要，不保存 PDF 原文或译文。 */
export function createTranslationTasks({ repository, ownerId, now }: TranslationTaskOptions) {
  async function begin(input: {
    attemptId: string;
    credentialRef: string;
    modelId: string;
    payloadHash: string;
    inputUpperBound: number;
  }) {
    const createdAt = now().toISOString();
    // 翻译没有知识库来源；使用独立命名空间的空范围，不授予任何工具或写入权限。
    const boundary = { ...(await repository.identity()), ownerId, spaceId: 'pdf-translation' };
    const scope: AiScopeSnapshot = {
      contractVersion: 1,
      kind: 'scopeSnapshot',
      scopeSnapshotId: randomUUID(),
      ...boundary,
      scopeKind: 'empty',
      allowedSources: [],
      allowedFolderIds: [],
      excludedSourceIds: [],
      scopeHash: '',
      createdAt
    };
    scope.scopeHash = scopeHash(scope);
    await repository.insert('scopeSnapshot', scope);
    const manifest = await repository.insert('contextManifest', {
      contractVersion: 1,
      kind: 'contextManifest',
      manifestId: randomUUID(),
      ...boundary,
      scopeSnapshotId: scope.scopeSnapshotId,
      scopeKind: 'empty',
      scopeHash: scope.scopeHash,
      recipient: 'deepseek',
      sources: [],
      excludedSourceIds: [],
      omissions: [],
      attachmentIds: [],
      estimatedInputTokens: input.inputUpperBound,
      payloadHash: input.payloadHash,
      createdAt
    });
    const grant = await repository.insert('aiGrant', {
      contractVersion: 1,
      kind: 'aiGrant',
      grantId: randomUUID(),
      actorId: ownerId,
      entrypoint: 'trustedApproval',
      ...boundary,
      scopeSnapshotId: scope.scopeSnapshotId,
      scopeHash: scope.scopeHash,
      allowedTools: [],
      actionKinds: [],
      maxTargets: 0,
      issuedAt: createdAt,
      expiresAt: new Date(now().getTime() + LEASE_MS).toISOString(),
      revokedAt: null
    });
    const jobId = `pdf-translation-${input.attemptId}`;
    await repository.insert('aiJob', {
      contractVersion: 1,
      kind: 'aiJob',
      jobId,
      requestId: input.attemptId,
      parentJobId: null,
      ...boundary,
      grantId: grant.grantId,
      jobKind: 'translation',
      idempotencyKey: input.attemptId,
      inputHash: input.payloadHash,
      manifestId: manifest.manifestId,
      manifestHash: hashRecord(manifest),
      credentialRef: input.credentialRef,
      provider: 'deepseek',
      modelId: input.modelId,
      promptVersion: 'pdf-translation-v1',
      resultSchemaVersion: 'pdf-translation-v1',
      status: 'running',
      phase: 'generating',
      acceptedAttemptId: null,
      outputHash: null,
      createdAt,
      updatedAt: createdAt
    });
    await repository.insert('aiJobAttempt', {
      contractVersion: 1,
      kind: 'aiJobAttempt',
      attemptId: input.attemptId,
      jobId,
      ordinal: 1,
      leaseGeneration: 1,
      leaseOwner: 'pdf-translation',
      leaseExpiresAt: grant.expiresAt,
      providerRequestId: null,
      deliveryUncertain: false,
      status: 'leased',
      startedAt: createdAt,
      finishedAt: null
    });
    return jobId;
  }

  async function assertLive(attemptId: string) {
    const attempt = await repository.get('aiJobAttempt', attemptId);
    if (!attempt) throw createAppError('AI_RECORD_NOT_FOUND', '翻译调用记录不存在。');
    const job = await repository.get('aiJob', attempt.jobId);
    if (
      job?.status !== 'running' ||
      !['leased', 'sent'].includes(attempt.status) ||
      Date.parse(attempt.leaseExpiresAt) <= now().getTime()
    )
      throw createAppError('AI_LATE_RESULT', '翻译任务已结束或租约失效，请重试。');
    return attempt;
  }

  async function sent(attemptId: string) {
    const attempt = await assertLive(attemptId);
    await repository.replace('aiJobAttempt', { ...attempt, status: 'sent' }, hashRecord(attempt));
  }

  async function endLease(attemptId: string) {
    const attempt = await repository.get('aiJobAttempt', attemptId);
    if (!attempt || Date.parse(attempt.leaseExpiresAt) <= now().getTime()) return;
    await repository.replace('aiJobAttempt', { ...attempt, leaseExpiresAt: now().toISOString() }, hashRecord(attempt));
  }

  async function finish(jobId: string, succeeded: boolean, uncertain: boolean) {
    const job = await repository.get('aiJob', jobId);
    if (!job || job.status !== 'running') return;
    const attempt = await repository.get('aiJobAttempt', job.requestId);
    if (attempt)
      await repository.replace(
        'aiJobAttempt',
        {
          ...attempt,
          status: succeeded ? 'validated' : 'rejected',
          deliveryUncertain: uncertain,
          finishedAt: now().toISOString()
        },
        hashRecord(attempt)
      );
    await repository.replace(
      'aiJob',
      {
        ...job,
        status: succeeded ? 'succeeded' : 'failed',
        phase: 'finished',
        updatedAt: new Date(Math.max(now().getTime(), Date.parse(job.updatedAt) + 1)).toISOString()
      },
      hashRecord(job)
    );
  }

  async function recover(
    active: Set<string>,
    settle: (attemptId: string, modelId: string) => Promise<void>,
    defer: (expiresAt: number) => void
  ) {
    const identity = await repository.identity();
    const jobs = await repository.list('aiJob', { jobKind: 'translation', status: 'running' });
    let changed = 0;
    for (const job of jobs) {
      if (
        job.datasetId !== identity.datasetId ||
        job.datasetEpoch !== identity.datasetEpoch ||
        active.has(job.requestId)
      )
        continue;
      const attempt = await repository.get('aiJobAttempt', job.requestId);
      // begin 先写 job 再写 attempt；准备中的任务同样要等待授权窗口，避免另一实例抢先收尾。
      const grant = attempt ? null : await repository.get('aiGrant', job.grantId);
      const expiresAt = Date.parse(attempt?.leaseExpiresAt ?? grant?.expiresAt ?? job.updatedAt);
      if (expiresAt > now().getTime()) {
        defer(expiresAt);
        continue;
      }
      // 先结算再结束任务；结算失败保留 running，下次恢复仍可重试。
      await settle(job.requestId, job.modelId);
      await finish(job.jobId, false, true);
      changed++;
    }
    return changed;
  }

  return { begin, assertLive, sent, endLease, finish, recover };
}
