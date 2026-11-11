import { assertAiReadableNote } from './note-privacy.ts';
import { createActionInboxMethods, createAssistantMessageSourceGuard } from './action-inbox.ts';
import { validateWriteIntent } from './note-write-intent.ts';
import { randomUUID } from 'node:crypto';
import { hashRecord } from './record-contract.ts';
import { calculateContentHash } from '../knowledge/domain/note-version.ts';
import { actionError, actionIdentityKeys, DRAFT_LEASE_MS } from './action-state.ts';
import { assertBaseline, baseline, buildActionPlan, finalizePlan, image, runAsync, runSync } from './action-plan.ts';
import { reuseCoreOperationReceipt } from '../../infrastructure/core-operation-contract.ts';

const id = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && value.trim() === value;
const rowFor = (state, actionId, ownerId) => {
  const row = state.actions.find(row => row.actionId === actionId && row.ownerId === ownerId);
  if (!row) actionError('AI_ACTION_NOT_FOUND', '动作不存在。', 404);
  return row;
};
const requestFor = row => ({
  ...Object.fromEntries(actionIdentityKeys.map(key => [key, row[key]])),
  kind: row.plan.toolName,
  planHash: row.plan.planHash
});
const lookupFor = row => ({ ownerId: row.ownerId, datasetId: row.datasetId, operationId: row.operationId });
const serial = value => JSON.parse(JSON.stringify(value));

export function createNoteActionService({
  store,
  core,
  knowledge,
  ownerId,
  conversationStore = null,
  accessStore = null,
  access = null,
  now = () => new Date(),
  asyncDomain = false
}) {
  const repos = knowledge.repositories;
  const run = asyncDomain ? runAsync : runSync;
  const messageSources = createAssistantMessageSourceGuard({
    conversationStore,
    accessStore,
    repositories: repos,
    ownerId,
    now
  });
  function* space(spaceId) {
    const record = yield repos.knowledgeSpaceRepository.findById(spaceId);
    if (!record || record.userId !== ownerId) actionError('AI_SCOPE_FORBIDDEN', '无权访问知识空间。', 403);
  }
  function checkCurrent(row, identity, allowExpired = false) {
    if (row.datasetId !== identity.datasetId || row.datasetEpoch !== identity.datasetEpoch)
      actionError('AI_DATASET_STALE', '资料集已切换或恢复，旧动作不可提交。');
    if (
      !row.grant ||
      row.grant.revoked ||
      row.grant.requestHash !== row.inputHash ||
      row.grant.toolName !== row.plan.toolName ||
      hashRecord(row.grant.targetIds) !== hashRecord(row.plan.items.map(item => item.after.id)) ||
      actionIdentityKeys.some(key => row.grant[key] !== row[key])
    )
      actionError('AI_ACTION_GRANT_REVOKED', '写入指令授权已失效。', 403);
    if (!allowExpired && Date.parse(row.expiresAt) <= now().getTime())
      actionError('AI_ACTION_EXPIRED', '写入指令已过期。');
  }
  function* references(spaceId, ids) {
    const result = [];
    for (const [kind, repo, refIds] of [
      ['folder', repos.folderRepository, ids.folders],
      ['tag', repos.tagRepository, ids.tags]
    ]) {
      for (const refId of new Set(refIds.filter(Boolean))) {
        const ref = yield repo.findById(refId);
        if (!ref || ref.spaceId !== spaceId || ref.deletedAt)
          actionError('AI_NOTE_REFERENCE_DENIED', '目录或标签不可用。', 422);
        result.push({ kind, id: refId, hash: hashRecord(serial(ref)) });
      }
    }
    return result;
  }
  function* verifyOrigin(row, identity, allowExpired = false) {
    checkCurrent(row, identity, allowExpired);
    if (row.plan.provenance?.messageId) yield* messageSources.verify(row.plan.provenance, row);
    if (row.grant.originTurnId) {
      if (!Array.isArray(row.grant.sourceRefs))
        actionError('AI_ACTION_GRANT_REVOKED', '旧模型成果缺少可靠来源记录，请重新生成。', 403);
      const turn = yield conversationStore?.peekTurn(row.grant.originTurnId);
      if (
        !turn ||
        (!row.grant.autonomousOrigin && (!turn.writeIntent || turn.writeIntent.toolName !== row.plan.toolName)) ||
        (!row.grant.autonomousOrigin &&
          turn.writeIntent?.noteId &&
          (row.plan.items.length !== 1 || turn.writeIntent.noteId !== row.plan.items[0].after.id)) ||
        turn.status !== 'succeeded' ||
        turn.leaseGeneration !== row.grant.originGeneration ||
        turn.ownerId !== ownerId ||
        turn.datasetId !== row.datasetId ||
        turn.datasetEpoch !== row.datasetEpoch ||
        turn.spaceId !== row.spaceId ||
        turn.turnId !== row.requestId ||
        (turn.requestedPolicyId ?? null) !== row.grant.policyId
      )
        actionError('AI_ACTION_GRANT_REVOKED', '模型计划的指令任务已失效。', 403);
    }
    for (const event of row.inboxEvents ?? []) {
      if (!event.originTurnId) continue;
      const turn = yield conversationStore?.peekTurn(event.originTurnId);
      const original = yield conversationStore?.peekTurn(row.grant.originTurnId);
      if (
        !turn ||
        !original ||
        turn.conversationId !== original.conversationId ||
        turn.status !== 'succeeded' ||
        turn.leaseGeneration !== event.originGeneration ||
        turn.ownerId !== ownerId ||
        turn.datasetId !== row.datasetId ||
        turn.datasetEpoch !== row.datasetEpoch ||
        turn.spaceId !== row.spaceId
      )
        actionError('AI_ACTION_GRANT_REVOKED', '成果修订任务未成功完成。', 403);
    }
    if (row.grant.policyId) {
      const policy = yield accessStore?.peek('aiAccessPolicy', row.grant.policyId);
      if (
        !policy ||
        policy.actorId !== ownerId ||
        policy.ownerId !== ownerId ||
        policy.datasetId !== row.datasetId ||
        policy.datasetEpoch !== row.datasetEpoch ||
        policy.spaceId !== row.spaceId ||
        policy.revokedAt ||
        policy.revision !== row.grant.policyRevision ||
        Date.parse(policy.expiresAt) <= now().getTime()
      )
        actionError('AI_ACTION_GRANT_REVOKED', '计划来源授权已撤销或变化。', 403);
    }
    for (const ref of row.grant.sourceRefs ?? []) assertAiReadableNote(yield repos.noteRepository.findById(ref.noteId));
    // 目录依赖（列出的笔记标题、目录名）：笔记仍可读、目录仍存在，成果才可采纳。
    for (const noteId of row.grant.catalogDeps?.noteIds ?? [])
      assertAiReadableNote(yield repos.noteRepository.findById(noteId));
    for (const folderId of row.grant.catalogDeps?.folderIds ?? []) {
      const folder = yield repos.folderRepository.findById(folderId);
      if (!folder || folder.deletedAt || folder.spaceId !== row.spaceId)
        actionError('AI_SCOPE_FORBIDDEN', '成果依赖的目录已不可用，请重新生成。', 403);
    }
    yield* space(row.spaceId);
  }
  function* verifyTargets(row, state) {
    for (const ref of row.plan.references) {
      const record = yield (ref.kind === 'folder' ? repos.folderRepository : repos.tagRepository).findById(ref.id);
      if (!record || record.spaceId !== row.spaceId || record.deletedAt || hashRecord(serial(record)) !== ref.hash) {
        actionError('AI_ACTION_CONFLICT', '目录或标签已变化，请重新预览。');
      }
    }
    for (const item of row.plan.items) {
      if (
        state.drafts.some(
          draft =>
            draft.ownerId === ownerId &&
            draft.datasetId === row.datasetId &&
            draft.datasetEpoch === row.datasetEpoch &&
            draft.noteId === item.after.id &&
            draft.dirty &&
            Date.parse(draft.leaseExpiresAt) > now().getTime()
        )
      ) {
        actionError('AI_ACTION_DRAFT_CONFLICT', '目标有未保存草稿，请先保存或比较草稿，再重新预览。');
      }
      assertBaseline(item, yield repos.noteRepository.findById(item.after.id));
    }
  }
  function* verify(row, state, identity) {
    yield* verifyOrigin(row, identity);
    if (
      row.status !== 'applying' ||
      !row.approval ||
      row.approval.planHash !== row.plan.planHash ||
      row.approval.actorId !== ownerId ||
      Date.parse(row.approval.expiresAt) <= now().getTime()
    ) {
      actionError('AI_ACTION_APPROVAL_REQUIRED', '需要对当前计划明确确认。', 403);
    }
    yield* verifyTargets(row, state);
  }
  function* commit(actionId) {
    const state = yield store.read(),
      row = rowFor(state, actionId, ownerId);
    yield* verify(row, state, yield store.identity());
    const changes = [];
    for (const item of row.plan.items) {
      const beforeVersion = item.before
        ? yield repos.noteVersionRepository.findByNoteIdAndContentHash(
            item.after.id,
            calculateContentHash(item.before.rawMarkdown)
          )
        : null;
      let saved;
      if (item.softDelete) saved = yield knowledge.noteService.deleteNote(item.after.id);
      else if (!item.before) saved = yield knowledge.noteService.createNote({ ...item.after, sourceType: 'ai' });
      else {
        const { id: noteId, spaceId: _space, ...updates } = item.after;
        // 元数据整理不重写正文，保留版本及标注维护路径。
        if (row.plan.toolName === 'notes_propose_organize') delete updates.rawMarkdown;
        saved = yield knowledge.noteService.updateNote(noteId, {
          ...updates,
          expectedUpdatedAt: item.baseline.expectedUpdatedAt
        });
      }
      const afterVersion = yield repos.noteVersionRepository.findByNoteIdAndContentHash(
        saved.id,
        calculateContentHash(saved.rawMarkdown)
      );
      if (!afterVersion) actionError('AI_ACTION_VERSION_MISSING', '提交版本缺失，事务已回滚。', 503);
      changes.push({
        noteId: saved.id,
        beforeVersionId: beforeVersion?.id ?? null,
        afterVersionId: afterVersion.id,
        contentHash: afterVersion.contentHash,
        metadataBefore: item.before
          ? { title: item.before.title, folderId: item.before.folderId, tagIds: item.before.tagIds }
          : null
      });
    }
    return { changes, saveState: 'localCommitted' };
  }
  async function reconcile(row) {
    const receipt = reuseCoreOperationReceipt(await core.get(lookupFor(row)), requestFor(row));
    if (!receipt) return row;
    // 私有账本失败不改变已提交事实；读回执仍可报告真实结果。
    try {
      return await store.write(state => {
        const current = rowFor(state, row.actionId, ownerId);
        current.status = 'applied';
        current.receipt = receipt;
        current.errorCode = null;
        return current;
      });
    } catch {
      return { ...row, status: 'applied', receipt, reconciliationPending: true };
    }
  }
  const mergeIds = (...parts) => ({
    noteIds: [...new Set(parts.flatMap(part => part?.noteIds ?? []))],
    folderIds: [...new Set(parts.flatMap(part => part?.folderIds ?? []))]
  });
  async function verifyRunSources(grantId, sourceRefs, targetIds = [], catalogDeps = null) {
    if (!Array.isArray(sourceRefs) || sourceRefs.length > 128)
      actionError('AI_REQUEST_INVALID', '成果来源列表无效。', 422);
    if (catalogDeps && (catalogDeps.noteIds?.length || catalogDeps.folderIds?.length)) {
      if (!access || !grantId) actionError('AI_SCOPE_FORBIDDEN', '成果依赖的目录资料需要本轮读取授权。', 403);
      await access.assertCatalogDeps({
        grantId,
        deps: { noteIds: catalogDeps.noteIds ?? [], folderIds: catalogDeps.folderIds ?? [] }
      });
    }
    for (const noteId of new Set([...targetIds, ...sourceRefs.map(ref => ref.noteId)])) {
      if (!access || !grantId) actionError('AI_SCOPE_FORBIDDEN', '成果来源需要本轮读取授权。', 403);
      const verified = await access.verifyRead({ grantId, noteId });
      for (const ref of sourceRefs.filter(ref => ref.noteId === noteId)) {
        if (ref.noteVersionId !== verified.version.id || ref.contentHash !== verified.contentHash)
          actionError('AI_SOURCE_STALE', '成果来源已变化，请重新读取。');
      }
    }
  }
  const service = {
    async resumeForTurn(actionId, turn, { sourceRefs = [], grantId = null, catalogDeps = null } = {}) {
      const row = await service.get(actionId);
      const targets = row.plan.items.filter(item => item.before).map(item => item.after.id);
      await verifyRunSources(
        grantId,
        [...(row.grant.sourceRefs ?? []), ...sourceRefs],
        targets,
        mergeIds(row.grant.catalogDeps, catalogDeps)
      );
      return store.transaction(() =>
        run(
          (function* () {
            const current = yield conversationStore?.peekTurn(turn.turnId);
            const identity = yield store.identity();
            const policy = row.grant.policyId ? yield accessStore?.peek('aiAccessPolicy', row.grant.policyId) : null;
            if (
              !current ||
              current.status !== 'running' ||
              current.leaseGeneration !== turn.leaseGeneration ||
              current.ownerId !== ownerId ||
              current.datasetId !== identity.datasetId ||
              current.datasetEpoch !== identity.datasetEpoch ||
              current.spaceId !== row.spaceId ||
              current.datasetId !== row.datasetId ||
              current.datasetEpoch !== row.datasetEpoch ||
              Date.parse(current.leaseExpiresAt) <= now().getTime() ||
              (current.requestedPolicyId ?? null) !== row.grant.policyId ||
              (row.grant.policyId &&
                (!policy ||
                  policy.revokedAt ||
                  policy.revision !== row.grant.policyRevision ||
                  Date.parse(policy.expiresAt) <= now().getTime()))
            )
              actionError('AI_ACTION_GRANT_REVOKED', '恢复任务的来源授权已失效。', 403);
            return yield store.write(state => {
              const latest = rowFor(state, actionId, ownerId);
              if (
                !Array.isArray(latest.grant.sourceRefs) ||
                latest.grant.revoked ||
                !['awaitingApproval', 'authorized'].includes(latest.status)
              )
                actionError('AI_ACTION_GRANT_REVOKED', '成果当前不可恢复绑定。', 403);
              const event = latest.inboxEvents?.find(event => event.originTurnId === turn.turnId);
              if (latest.grant.originTurnId === turn.turnId) latest.grant.originGeneration = turn.leaseGeneration;
              else if (event) event.originGeneration = turn.leaseGeneration;
              else actionError('AI_SCOPE_FORBIDDEN', '恢复任务与成果来源不匹配。', 403);
              return latest;
            });
          })()
        )
      );
    },
    async planForAssistantTurn(turn, call, { sourceRefs = [], grantId = null, catalogDeps = null } = {}) {
      const identity = await store.identity();
      if (
        turn.datasetId !== identity.datasetId ||
        turn.datasetEpoch !== identity.datasetEpoch ||
        turn.ownerId !== ownerId
      )
        actionError('AI_DATASET_STALE', '旧资料集的模型结果不可生成计划。');
      const current = await conversationStore?.peekTurn(turn.turnId);
      if (
        !current ||
        current.status !== 'running' ||
        current.leaseGeneration !== turn.leaseGeneration ||
        current.ownerId !== ownerId ||
        current.datasetId !== turn.datasetId ||
        current.datasetEpoch !== turn.datasetEpoch ||
        current.spaceId !== turn.spaceId ||
        (current.requestedPolicyId ?? null) !== (turn.requestedPolicyId ?? null) ||
        Date.parse(current.leaseExpiresAt) <= now().getTime()
      )
        actionError('AI_ACTION_GRANT_REVOKED', '模型任务已失效。', 403);
      const policy = turn.requestedPolicyId ? await accessStore?.get('aiAccessPolicy', turn.requestedPolicyId) : null;
      if (
        (policy && (policy.revokedAt || Date.parse(policy.expiresAt) <= now().getTime())) ||
        (turn.requestedPolicyId && !policy)
      )
        actionError('AI_ACTION_GRANT_REVOKED', '模型来源授权已失效。', 403);
      const targetIds =
        call.name === 'notes_create'
          ? []
          : call.name === 'notes_propose_organize'
            ? (call.arguments?.changes ?? []).map(row => row.noteId)
            : [call.arguments?.noteId];
      await verifyRunSources(grantId, sourceRefs, targetIds, catalogDeps);
      if (call.arguments?.actionId) {
        const { actionId, ...args } = call.arguments;
        const prior = await service.get(actionId);
        await verifyRunSources(
          grantId,
          [...(prior.grant.sourceRefs ?? []), ...sourceRefs],
          targetIds,
          mergeIds(prior.grant.catalogDeps, catalogDeps)
        );
        const originalTurn = prior.grant.originTurnId
          ? await conversationStore?.peekTurn(prior.grant.originTurnId)
          : null;
        if (
          !originalTurn ||
          originalTurn.conversationId !== current.conversationId ||
          prior.spaceId !== turn.spaceId ||
          prior.plan.toolName !== call.name
        )
          actionError('AI_SCOPE_FORBIDDEN', '成果修订范围不匹配。', 403);
        // 重试使用该 turn 已落盘的原始预览 hash；最新 planHash 已是修订结果，不能重建成另一个输入。
        const priorEvent = prior.inboxEvents?.find(event => event.requestId === turn.turnId);
        if (priorEvent && (priorEvent.kind !== 'revise' || priorEvent.originTurnId !== turn.turnId))
          actionError('AI_IDEMPOTENCY_CONFLICT', '修订请求已被其他成果操作使用。');
        const action = await service.reviseForAssistantTurn(
          actionId,
          {
            planHash: priorEvent?.previousPlan.planHash ?? prior.plan.planHash,
            requestId: turn.turnId,
            arguments: args
          },
          { ...turn, sourceRefs, catalogDeps }
        );
        return service.resumeForTurn(action.actionId, turn, { sourceRefs, grantId, catalogDeps });
      }
      const row = await service.plan(
        { spaceId: turn.spaceId, requestId: turn.turnId, toolName: call.name, arguments: call.arguments },
        { ...turn, writePolicy: policy, autonomousOrigin: true, sourceRefs, catalogDeps }
      );
      return store.transaction(() =>
        run(
          (function* () {
            const latest = yield conversationStore.peekTurn(turn.turnId);
            const valid =
              latest &&
              latest.status === 'running' &&
              latest.leaseGeneration === turn.leaseGeneration &&
              latest.ownerId === ownerId &&
              latest.datasetId === row.datasetId &&
              latest.datasetEpoch === row.datasetEpoch &&
              latest.spaceId === row.spaceId &&
              Date.parse(latest.leaseExpiresAt) > now().getTime();
            return yield store.write(state => {
              const action = rowFor(state, row.actionId, ownerId);
              if (valid) {
                if (
                  !Array.isArray(action.grant.sourceRefs) ||
                  action.grant.revoked ||
                  !['awaitingApproval', 'authorized'].includes(action.status) ||
                  action.grant.originTurnId !== turn.turnId
                )
                  actionError('AI_ACTION_GRANT_REVOKED', '成果当前不可恢复绑定。', 403);
                action.grant.originGeneration = turn.leaseGeneration;
              }
              if (!valid) {
                action.status = 'cancelled';
                action.grant.revoked = true;
              }
              return action;
            });
          })()
        )
      );
    },
    async planForTurn(turn, intent, call, { sourceRefs = [], grantId = null, catalogDeps = null } = {}) {
      validateWriteIntent(intent);
      if (!turn.writeIntent || hashRecord(turn.writeIntent) !== hashRecord(intent))
        actionError('AI_SCOPE_FORBIDDEN', '写入意图与原指令不一致。', 403);
      const identity = await store.identity();
      if (
        turn.datasetId !== identity.datasetId ||
        turn.datasetEpoch !== identity.datasetEpoch ||
        turn.ownerId !== ownerId
      )
        actionError('AI_DATASET_STALE', '旧资料集的模型结果不可生成计划。');
      if (
        call.name !== intent.toolName ||
        (intent.noteId &&
          (call.name === 'notes_propose_organize'
            ? call.arguments?.changes?.length !== 1 || call.arguments.changes[0]?.noteId !== intent.noteId
            : call.arguments?.noteId !== intent.noteId))
      )
        actionError('AI_SCOPE_FORBIDDEN', '模型只能为明确指令的固定目标提出计划。', 403);
      const policy = turn.requestedPolicyId ? await accessStore?.get('aiAccessPolicy', turn.requestedPolicyId) : null;
      if (turn.requestedPolicyId && (!policy || policy.revokedAt || Date.parse(policy.expiresAt) <= now().getTime()))
        actionError('AI_ACTION_GRANT_REVOKED', '模型来源授权已失效。', 403);
      const targetIds =
        call.name === 'notes_create'
          ? []
          : call.name === 'notes_propose_organize'
            ? (call.arguments?.changes ?? []).map(row => row.noteId)
            : [call.arguments?.noteId];
      // 兼容明确固定目标的旧入口；工作线程提供 run grant 时连目标一起复核。
      await verifyRunSources(grantId, sourceRefs, grantId ? targetIds : [], catalogDeps);
      const row = await service.plan(
        { spaceId: turn.spaceId, requestId: turn.turnId, toolName: call.name, arguments: call.arguments },
        { ...turn, writePolicy: policy, sourceRefs, catalogDeps }
      );
      return store.transaction(() =>
        run(
          (function* () {
            const current = yield conversationStore.peekTurn(turn.turnId);
            const valid =
              current &&
              current.status === 'running' &&
              current.leaseGeneration === turn.leaseGeneration &&
              current.ownerId === ownerId &&
              current.datasetId === row.datasetId &&
              current.datasetEpoch === row.datasetEpoch &&
              current.spaceId === row.spaceId &&
              current.turnId === row.requestId &&
              (current.requestedPolicyId ?? null) === row.grant.policyId &&
              Date.parse(current.leaseExpiresAt) > now().getTime();
            return yield store.write(state => {
              const action = rowFor(state, row.actionId, ownerId);
              if (
                valid &&
                (!Array.isArray(action.grant.sourceRefs) ||
                  action.grant.revoked ||
                  !['awaitingApproval', 'authorized'].includes(action.status))
              )
                actionError('AI_ACTION_GRANT_REVOKED', '成果当前不可恢复绑定。', 403);
              action.grant.originTurnId = turn.turnId;
              action.grant.originGeneration = turn.leaseGeneration;
              if (!valid) {
                action.status = 'cancelled';
                action.grant.revoked = true;
              }
              return action;
            });
          })()
        )
      );
    },
    async list(spaceId) {
      await run(space(spaceId));
      return Promise.all(
        (await store.read()).actions
          .filter(row => row.ownerId === ownerId && row.spaceId === spaceId)
          .slice(-100)
          .map(reconcile)
      );
    },
    async get(actionId) {
      return reconcile(rowFor(await store.read(), actionId, ownerId));
    },
    async plan(input, origin = null) {
      if (
        !input ||
        Object.keys(input).some(
          key => !['spaceId', 'requestId', 'toolName', 'arguments', 'sourceMessageId', 'conversationId'].includes(key)
        ) ||
        !id(input.spaceId) ||
        !id(input.requestId) ||
        !input.arguments ||
        !['notes_create', 'notes_append', 'notes_propose_patch', 'notes_propose_organize'].includes(input.toolName)
      ) {
        actionError('AI_REQUEST_INVALID', '写入指令无效。', 422);
      }
      if (
        input.toolName === 'notes_propose_organize' &&
        (!Array.isArray(input.arguments.changes) ||
          !input.arguments.changes.length ||
          input.arguments.changes.length > 20 ||
          input.arguments.changes.some(row => !row || !id(row.noteId)))
      )
        actionError('AI_NOTE_TOOL_INVALID', '整理指令目标无效。', 422);
      await run(space(input.spaceId));
      const identity = await store.identity(),
        inputHash = hashRecord(input);
      const existing = (await store.read()).actions.find(
        row =>
          row.ownerId === ownerId &&
          row.datasetId === identity.datasetId &&
          row.spaceId === input.spaceId &&
          row.requestId === input.requestId
      );
      if (existing) {
        if (existing.inputHash !== inputHash) actionError('AI_IDEMPOTENCY_CONFLICT', '相同指令 ID 的输入已变化。');
        if (existing.plan.provenance?.messageId && existing.status !== 'applied') {
          checkCurrent(existing, identity, true);
          await run(messageSources.verify(existing.plan.provenance, existing));
        }
        return reconcile(existing);
      }
      let provenance = null;
      if (input.sourceMessageId || input.conversationId) {
        if (!id(input.sourceMessageId) || !id(input.conversationId))
          actionError('AI_ACTION_SOURCE_INVALID', '对话来源不可用。', 422);
        provenance = await messageSources.resolve(input, { ...identity, spaceId: input.spaceId });
        await run(messageSources.verify(provenance, { ...identity, spaceId: input.spaceId }));
      }
      const targetNoteId = input.toolName === 'notes_create' ? `note-${randomUUID()}` : input.arguments.noteId;
      const notes =
        input.toolName === 'notes_propose_organize'
          ? await Promise.all(
              (input.arguments.changes ?? []).map(change => repos.noteRepository.findById(change.noteId))
            )
          : input.toolName === 'notes_create'
            ? []
            : [await repos.noteRepository.findById(targetNoteId)];
      if (notes.some(note => !note || note.deleted || note.spaceId !== input.spaceId))
        actionError('AI_NOTE_TARGET_INVALID', '写入目标无效。', 422);
      notes.forEach(assertAiReadableNote);
      const identityFields = {
        ...identity,
        actorId: ownerId,
        ownerId,
        spaceId: input.spaceId,
        requestId: input.requestId,
        operationId: randomUUID()
      };
      const args = input.arguments;
      const changes = input.toolName === 'notes_propose_organize' ? args.changes : [args];
      const refs = await run(
        references(input.spaceId, {
          folders: [...notes.map(note => note?.folderId), ...changes.map(change => change.folderId)],
          tags: [...notes.flatMap(note => note?.tagIds ?? []), ...changes.flatMap(change => change.tagIds ?? [])]
        })
      );
      const plan = buildActionPlan({
        toolName: input.toolName,
        args,
        notes,
        references: refs,
        trusted: {
          ...identityFields,
          identity: identityFields,
          targetNoteId,
          note: notes[0],
          provenance,
          allowedFolderIds: refs.filter(ref => ref.kind === 'folder').map(ref => ref.id),
          allowedTagIds: refs.filter(ref => ref.kind === 'tag').map(ref => ref.id)
        }
      });
      return store.transaction(() =>
        run(
          (function* () {
            if (provenance) yield* messageSources.verify(provenance, { ...identity, spaceId: input.spaceId });
            return yield store.write((state, current) => {
              if (hashRecord(current) !== hashRecord(identity)) actionError('AI_DATASET_STALE', '资料集已变化。');
              const prior = state.actions.find(
                row =>
                  row.ownerId === ownerId &&
                  row.datasetId === identity.datasetId &&
                  row.spaceId === input.spaceId &&
                  row.requestId === input.requestId
              );
              if (prior) {
                if (prior.inputHash !== inputHash) actionError('AI_IDEMPOTENCY_CONFLICT', '相同指令输入冲突。');
                return prior;
              }
              const row = {
                ...identityFields,
                actionId: randomUUID(),
                inputHash,
                plan,
                status: 'awaitingApproval',
                approval: null,
                receipt: null,
                errorCode: null,
                createdAt: now().toISOString(),
                expiresAt: new Date(now().getTime() + 30 * 60000).toISOString()
              };
              row.grant = {
                ...identityFields,
                requestHash: inputHash,
                toolName: plan.toolName,
                targetIds: plan.items.map(item => item.after.id),
                expiresAt: row.expiresAt,
                revoked: false,
                ...(origin
                  ? {
                      ...(origin.autonomousOrigin ? { autonomousOrigin: true } : {}),
                      sourceRefs: structuredClone(origin.sourceRefs ?? []),
                      ...(origin.catalogDeps &&
                      (origin.catalogDeps.noteIds?.length || origin.catalogDeps.folderIds?.length)
                        ? {
                            catalogDeps: {
                              noteIds: [...(origin.catalogDeps.noteIds ?? [])],
                              folderIds: [...(origin.catalogDeps.folderIds ?? [])]
                            }
                          }
                        : {}),
                      originTurnId: origin.turnId,
                      originGeneration: origin.leaseGeneration,
                      policyId: origin.writePolicy?.policyId ?? null,
                      policyRevision: origin.writePolicy?.revision ?? null
                    }
                  : {})
              };
              state.actions.push(row);
              return row;
            });
          })()
        )
      );
    },
    async approve(actionId, input) {
      if (!input || Object.keys(input).some(key => key !== 'planHash'))
        actionError('AI_REQUEST_INVALID', '批准请求无效。', 422);
      return store.write((state, identity) => {
        const row = rowFor(state, actionId, ownerId);
        checkCurrent(row, identity);
        if (row.plan.planHash !== input.planHash) actionError('AI_ACTION_PLAN_CHANGED', '批准与当前计划不匹配。');
        if (!['awaitingApproval', 'authorized'].includes(row.status))
          actionError('AI_ACTION_CONFLICT', '动作当前不可批准。');
        row.approval = { actorId: ownerId, planHash: row.plan.planHash, expiresAt: row.expiresAt };
        row.status = 'authorized';
        return row;
      });
    },
    async apply(actionId) {
      let row = await service.get(actionId);
      if (row.status === 'applied') return row;
      row = await store.write((state, identity) => {
        const current = rowFor(state, actionId, ownerId);
        checkCurrent(current, identity);
        if (!['authorized', 'applying'].includes(current.status))
          actionError('AI_ACTION_APPROVAL_REQUIRED', '请先确认当前差异。', 403);
        current.status = 'applying';
        return current;
      });
      try {
        const receipt = await core.commit(requestFor(row), () => run(commit(actionId)));
        try {
          return await store.write(state => {
            const current = rowFor(state, actionId, ownerId);
            current.status = 'applied';
            current.receipt = receipt;
            current.errorCode = null;
            return current;
          });
        } catch {
          return { ...row, status: 'applied', receipt, reconciliationPending: true };
        }
      } catch (error) {
        const recovered = await reconcile(row);
        if (recovered.status === 'applied') return recovered;
        // applying 保留可对账重试；确定的 CAS/授权拒绝才进入终态。
        if (/CONFLICT|STALE|EXPIRED|APPROVAL|GRANT_REVOKED|SCOPE_FORBIDDEN/.test(error.code ?? ''))
          await store.write(state => {
            const current = rowFor(state, actionId, ownerId);
            if (current.status === 'applying') {
              current.status = 'conflicted';
              current.errorCode = error.code;
            }
            return current;
          });
        throw error;
      }
    },
    async cancel(actionId, reject = false) {
      const row = await service.get(actionId);
      if (row.status === 'applied') return { ...row, cancellation: 'alreadyCommitted' };
      return store.transaction(() =>
        run(
          (function* () {
            const current = rowFor(yield store.read(), actionId, ownerId);
            const receipt = reuseCoreOperationReceipt(yield core.get(lookupFor(current)), requestFor(current));
            return yield store.write(state => {
              const latest = rowFor(state, actionId, ownerId);
              if (receipt) {
                latest.status = 'applied';
                latest.receipt = receipt;
                return { ...latest, cancellation: 'alreadyCommitted' };
              }
              latest.status = reject ? 'rejected' : 'cancelled';
              latest.approval = null;
              latest.grant.revoked = true;
              return latest;
            });
          })()
        )
      );
    },
    async draft(input) {
      if (
        !input ||
        Object.keys(input).some(key => !['noteId', 'clientId', 'dirty'].includes(key)) ||
        !id(input.noteId) ||
        !id(input.clientId) ||
        typeof input.dirty !== 'boolean'
      )
        actionError('AI_REQUEST_INVALID', '草稿状态无效。', 422);
      const note = await repos.noteRepository.findById(input.noteId);
      if (!note) actionError('AI_NOTE_TARGET_INVALID', '目标不存在。', 404);
      await run(space(note.spaceId));
      return store.write((state, identity) => {
        state.drafts = state.drafts.filter(
          row =>
            !(
              row.ownerId === ownerId &&
              row.datasetId === identity.datasetId &&
              row.datasetEpoch === identity.datasetEpoch &&
              row.noteId === input.noteId &&
              row.clientId === input.clientId
            )
        );
        const leaseExpiresAt = new Date(now().getTime() + DRAFT_LEASE_MS).toISOString();
        if (input.dirty) state.drafts.push({ ...identity, ownerId, ...input, leaseExpiresAt });
        return { ...input, ...identity, leaseExpiresAt };
      });
    },
    async undoPreview(actionId, input) {
      if (!input || !id(input.requestId) || Object.keys(input).some(key => key !== 'requestId'))
        actionError('AI_REQUEST_INVALID', '撤销指令无效。', 422);
      const original = await service.get(actionId);
      if (original.status !== 'applied' || original.plan.toolName === 'notes_undo')
        actionError('AI_ACTION_CONFLICT', '该动作没有可撤销结果。');
      const identity = await store.identity();
      const existing = (await store.read()).actions.find(
        row =>
          row.ownerId === ownerId &&
          row.datasetId === identity.datasetId &&
          row.spaceId === original.spaceId &&
          row.requestId === input.requestId
      );
      if (existing) {
        if (existing.inputHash !== hashRecord({ undo: actionId, requestId: input.requestId }))
          actionError('AI_IDEMPOTENCY_CONFLICT', '撤销指令冲突。');
        return reconcile(existing);
      }
      checkCurrent({ ...original, expiresAt: new Date(now().getTime() + 60000).toISOString() }, identity);
      const items = [];
      for (const item of original.plan.items) {
        const note = await repos.noteRepository.findById(item.after.id);
        if (note) assertAiReadableNote(note);
        const currentImage = note ? image(note) : null;
        if (currentImage && item.after.aiVisibility === undefined) delete currentImage.aiVisibility;
        if (!note || note.deleted || hashRecord(currentImage) !== hashRecord(item.after))
          actionError('AI_ACTION_CONFLICT', '已有后续修改，不能撤销覆盖。');
        items.push({
          before: image(note),
          after: item.before ?? image(note),
          baseline: baseline(note),
          edits: [],
          softDelete: !item.before
        });
      }
      const refs = await run(
        references(original.spaceId, {
          folders: items.flatMap(item => [item.before.folderId, item.after.folderId]),
          tags: items.flatMap(item => [...item.before.tagIds, ...item.after.tagIds])
        })
      );
      const fields = {
        ...identity,
        ownerId,
        actorId: ownerId,
        spaceId: original.spaceId,
        requestId: input.requestId,
        operationId: randomUUID()
      };
      const plan = finalizePlan({
        schemaVersion: 1,
        toolVersion: 1,
        toolName: 'notes_undo',
        ...fields,
        items,
        references: refs,
        provenance: { originalActionId: original.actionId },
        approvalMode: 'previewRequired'
      });
      return store.write((state, current) => {
        if (hashRecord(identity) !== hashRecord(current)) actionError('AI_DATASET_STALE', '资料集已变化。');
        const existing = state.actions.find(
          row =>
            row.ownerId === ownerId &&
            row.datasetId === identity.datasetId &&
            row.spaceId === fields.spaceId &&
            row.requestId === input.requestId
        );
        const inputHash = hashRecord({ undo: actionId, requestId: input.requestId });
        if (existing) {
          if (existing.inputHash !== inputHash) actionError('AI_IDEMPOTENCY_CONFLICT', '撤销指令冲突。');
          return existing;
        }
        const row = {
          ...fields,
          actionId: randomUUID(),
          inputHash,
          plan,
          status: 'awaitingApproval',
          approval: null,
          receipt: null,
          errorCode: null,
          createdAt: now().toISOString(),
          expiresAt: new Date(now().getTime() + 30 * 60000).toISOString()
        };
        row.grant = {
          ...fields,
          requestHash: inputHash,
          toolName: plan.toolName,
          targetIds: plan.items.map(item => item.after.id),
          expiresAt: row.expiresAt,
          revoked: false
        };
        state.actions.push(row);
        return row;
      });
    }
  };
  /** @typedef {Parameters<typeof createActionInboxMethods>[0] & {checkCurrent: typeof checkCurrent}} ActionInboxInvocation */
  Object.assign(
    service,
    createActionInboxMethods(
      /** @type {ActionInboxInvocation} */ ({
        service,
        store,
        ownerId,
        now,
        run,
        rowFor,
        checkCurrent,
        references,
        verifyRevisionTurn: (turn, row) =>
          run(
            (function* () {
              const current = yield conversationStore?.peekTurn(turn.turnId);
              const original = yield conversationStore?.peekTurn(row.grant.originTurnId);
              if (
                !current ||
                !original ||
                current.status !== 'running' ||
                current.leaseGeneration !== turn.leaseGeneration ||
                current.conversationId !== original.conversationId ||
                current.ownerId !== ownerId ||
                current.datasetId !== row.datasetId ||
                current.datasetEpoch !== row.datasetEpoch ||
                current.spaceId !== row.spaceId ||
                Date.parse(current.leaseExpiresAt) <= now().getTime()
              )
                actionError('AI_ACTION_GRANT_REVOKED', '成果修订任务已失效。', 403);
            })()
          ),
        verifyDraft: (row, state, identity) =>
          run(
            (function* () {
              yield* verifyOrigin(row, identity, true);
              yield* verifyTargets(row, state);
            })()
          )
      })
    )
  );
  return /** @type {typeof service & ReturnType<typeof createActionInboxMethods>} */ (service);
}
