import { assertAiReadableNote } from './note-privacy.js';
import { hashRecord } from './record-contract.ts';
import { actionError } from './action-state.js';
import { buildActionPlan, finalizePlan } from './action-plan.js';

const pending = ['awaitingApproval', 'authorized', 'conflicted', 'expired'];
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && value.trim() === value;
const requireInput = (input, keys) => {
  if (
    !input ||
    Object.keys(input).some(key => !keys.includes(key)) ||
    !validId(input.requestId) ||
    !/^[a-f0-9]{64}$/.test(input.planHash)
  )
    actionError('AI_REQUEST_INVALID', '成果修订或重新预览请求无效。', 422);
};
const eventFor = (row, input, kind) => {
  const event = row.inboxEvents?.find(event => event.requestId === input.requestId);
  if (event && (event.kind !== kind || event.inputHash !== hashRecord(input)))
    actionError('AI_IDEMPOTENCY_CONFLICT', '相同成果请求 ID 的输入已变化。');
  return event;
};
const ensurePending = (row, input) => {
  if (row.plan.planHash !== input.planHash) actionError('AI_ACTION_PLAN_CHANGED', '成果已修订，请查看当前差异。');
  if (!pending.includes(row.status)) actionError('AI_ACTION_CONFLICT', '成果当前不可修订或重新预览。');
};

/** 成果是待审动作的视图；未经采纳不会出现在笔记库或普通笔记检索中。 */
export function createActionInboxMethods({
  service,
  store,
  ownerId,
  now,
  run,
  rowFor,
  references,
  verifyDraft,
  verifyRevisionTurn
}) {
  async function update(actionId, input, kind, build, origin = null) {
    await service.get(actionId);
    return store.transaction(() =>
      run(
        (function* () {
          const state = yield store.read(),
            row = rowFor(state, actionId, ownerId);
          if (eventFor(row, input, kind)) return row;
          ensurePending(row, input);
          yield verifyDraft(row, state, yield store.identity());
          const nextPlan = build ? yield build(row) : row.plan;
          if (origin) yield verifyRevisionTurn(origin, row);
          return yield store.write((current, identity) => {
            const latest = rowFor(current, actionId, ownerId);
            if (eventFor(latest, input, kind)) return latest;
            ensurePending(latest, input);
            if (latest.datasetId !== identity.datasetId || latest.datasetEpoch !== identity.datasetEpoch)
              actionError('AI_DATASET_STALE', '资料集已变化。');
            const previousPlan = latest.plan;
            latest.plan = nextPlan;
            if (origin?.catalogDeps && (origin.catalogDeps.noteIds?.length || origin.catalogDeps.folderIds?.length)) {
              latest.grant.catalogDeps = {
                noteIds: [
                  ...new Set([...(latest.grant.catalogDeps?.noteIds ?? []), ...(origin.catalogDeps.noteIds ?? [])])
                ],
                folderIds: [
                  ...new Set([...(latest.grant.catalogDeps?.folderIds ?? []), ...(origin.catalogDeps.folderIds ?? [])])
                ]
              };
            }
            if (origin?.sourceRefs)
              latest.grant.sourceRefs = [
                ...new Map(
                  [...(latest.grant.sourceRefs ?? []), ...origin.sourceRefs].map(ref => [
                    hashRecord(ref),
                    structuredClone(ref)
                  ])
                ).values()
              ];
            latest.expiresAt = new Date(now().getTime() + 30 * 60000).toISOString();
            latest.grant.expiresAt = latest.expiresAt;
            latest.approval = null;
            latest.errorCode = null;
            latest.status = 'awaitingApproval';
            latest.inboxEvents ??= [];
            latest.inboxEvents.push({
              kind,
              requestId: input.requestId,
              inputHash: hashRecord(input),
              createdAt: now().toISOString(),
              previousPlan,
              resultPlanHash: latest.plan.planHash,
              ...(origin ? { originTurnId: origin.turnId, originGeneration: origin.leaseGeneration } : {})
            });
            return latest;
          });
        })()
      )
    );
  }
  const methods = {
    async listInbox(spaceId) {
      // service.list performs owner/space authorization, but intentionally caps execution-history rows.
      await service.list(spaceId);
      const identity = await store.identity();
      const rows = (await store.read()).actions.filter(
        row =>
          row.ownerId === ownerId &&
          row.spaceId === spaceId &&
          row.datasetId === identity.datasetId &&
          row.plan.toolName !== 'notes_undo'
      );
      return Promise.all(
        rows.map(async row => {
          const current = await service.get(row.actionId);
          return {
            ...current,
            datasetStale: current.datasetEpoch !== identity.datasetEpoch,
            reviewRequired: pending.includes(current.status),
            reauthorizationRequired:
              pending.includes(current.status) && Date.parse(current.expiresAt) <= now().getTime(),
            draftRetrieval: 'excluded',
            revision: (current.inboxEvents ?? []).filter(event => event.kind === 'revise').length + 1
          };
        })
      );
    },
    async repreview(actionId, input) {
      requireInput(input, ['planHash', 'requestId']);
      return update(actionId, input, 'repreview');
    },
    async reviseForAssistantTurn(actionId, input, origin) {
      return methods.revise(actionId, input, origin);
    },
    async revise(actionId, input, origin = null) {
      requireInput(input, ['planHash', 'requestId', 'arguments']);
      if (!input.arguments || typeof input.arguments !== 'object' || Array.isArray(input.arguments))
        actionError('AI_REQUEST_INVALID', '成果修订内容无效。', 422);
      return update(
        actionId,
        input,
        'revise',
        row =>
          run(
            (function* () {
              const notes = row.plan.items
                .filter(item => item.before)
                .map(item => ({ ...item.before, updatedAt: item.baseline.expectedUpdatedAt }));
              const args = structuredClone(input.arguments);
              if (row.plan.toolName === 'notes_propose_organize' && Array.isArray(args.changes)) {
                const order = new Map(row.plan.items.map((item, index) => [item.after.id, index]));
                args.changes.sort((left, right) => order.get(left.noteId) - order.get(right.noteId));
              }
              const targets =
                row.plan.toolName === 'notes_propose_organize'
                  ? args.changes?.map(change => change.noteId)
                  : [args.noteId];
              if (
                row.plan.toolName !== 'notes_create' &&
                hashRecord([...(targets ?? [])].sort()) !== hashRecord(row.plan.items.map(item => item.after.id).sort())
              )
                actionError('AI_SCOPE_FORBIDDEN', '修订不得更换成果目标。', 403);
              const changes = row.plan.toolName === 'notes_propose_organize' ? args.changes : [args];
              const refs = yield run(
                references(row.spaceId, {
                  folders: [...notes.map(note => note.folderId), ...changes.map(change => change.folderId)],
                  tags: [...notes.flatMap(note => note.tagIds), ...changes.flatMap(change => change.tagIds ?? [])]
                })
              );
              const built = buildActionPlan({
                toolName: row.plan.toolName,
                args,
                notes,
                references: refs,
                trusted: {
                  ...row,
                  identity: Object.fromEntries(
                    ['ownerId', 'actorId', 'datasetId', 'datasetEpoch', 'spaceId', 'requestId', 'operationId'].map(
                      key => [key, row[key]]
                    )
                  ),
                  targetNoteId: row.plan.items[0].after.id,
                  note: notes[0],
                  provenance: row.plan.provenance,
                  allowedFolderIds: refs.filter(ref => ref.kind === 'folder').map(ref => ref.id),
                  allowedTagIds: refs.filter(ref => ref.kind === 'tag').map(ref => ref.id)
                }
              });
              const { planHash: _hash, ...content } = structuredClone(built);
              for (const item of content.items) {
                const original = row.plan.items.find(original => original.after.id === item.after.id);
                item.before = structuredClone(original.before);
                item.baseline = structuredClone(original.baseline);
                if (original.after.aiVisibility === undefined) delete item.after.aiVisibility;
              }
              return finalizePlan(content);
            })()
          ),
        origin
      );
    }
  };
  return methods;
}

/** 把历史助手消息记录成成果是独立用户请求，原 turn 仅作为不可变来源证据。 */
export function createAssistantMessageSourceGuard({
  conversationStore,
  accessStore,
  repositories: repos,
  ownerId,
  now
}) {
  const boundary = (row, scope) =>
    row && row.ownerId === ownerId && ['datasetId', 'datasetEpoch', 'spaceId'].every(key => row[key] === scope[key]);
  const refsHash = refs => hashRecord([...new Set(refs.map(hashRecord))].sort());
  const denied = () => actionError('AI_ACTION_GRANT_REVOKED', '助手消息来源授权已失效或记录不完整，请重新生成。', 403);
  function* verify(source, scope) {
    if (
      source?.sourceKind !== 'assistantMessage' ||
      !/^[a-f0-9]{64}$/.test(source.contentHash) ||
      !validId(source.messageId) ||
      !validId(source.conversationId) ||
      !validId(source.turnId) ||
      !Number.isSafeInteger(source.originGeneration) ||
      source.originGeneration < 1 ||
      !Array.isArray(source.sourceRefs) ||
      typeof source.sourceFree !== 'boolean' ||
      source.sourceFree === Boolean(source.sourceRefs.length)
    )
      denied();
    const turn = yield conversationStore?.peekTurn(source.turnId);
    if (
      !boundary(turn, scope) ||
      turn.status !== 'succeeded' ||
      turn.conversationId !== source.conversationId ||
      turn.assistantMessageId !== source.messageId ||
      turn.leaseGeneration !== source.originGeneration ||
      (turn.requestedPolicyId ?? null) !== source.policyId
    )
      denied();
    let policy = null;
    if (source.policyId) {
      policy = yield accessStore?.peek('aiAccessPolicy', source.policyId);
      if (
        !boundary(policy, scope) ||
        policy.actorId !== ownerId ||
        policy.revokedAt ||
        policy.read !== true ||
        policy.revision !== source.policyRevision ||
        Date.parse(policy.expiresAt) <= now().getTime()
      )
        denied();
    } else if (source.policyRevision !== null || source.sourceRefs.length || source.provenanceManifestId) denied();
    let manifest = null;
    if (source.provenanceManifestId) {
      manifest = yield accessStore?.peek('aiRequestManifest', source.provenanceManifestId);
      const grant = manifest ? yield accessStore?.peek('aiRunGrant', manifest.grantId) : null;
      if (
        !boundary(manifest, scope) ||
        !boundary(grant, scope) ||
        grant.actorId !== ownerId ||
        grant.conversationId !== source.conversationId ||
        manifest.policyId !== source.policyId ||
        manifest.policyRevision !== source.policyRevision ||
        grant.policyId !== source.policyId ||
        grant.policyRevision !== source.policyRevision ||
        hashRecord(manifest) !== source.manifestHash ||
        refsHash([...manifest.sources, ...manifest.historySources]) !== refsHash(source.sourceRefs)
      )
        denied();
    } else if (source.manifestHash !== null || !source.sourceFree || source.sourceRefs.length) denied();
    // 回答里引用的目录标题（含继承自更早回答的）与正文来源同样要在当前授权下可读，才能记录为成果。
    const catalogIds = manifest
      ? [
          ...new Set([
            ...(manifest.catalog ?? []).flatMap(item => item.noteIds ?? []),
            ...(manifest.historyCatalog?.noteIds ?? [])
          ])
        ]
      : [];
    for (const ref of [...source.sourceRefs, ...catalogIds.map(noteId => ({ noteId }))]) {
      const note = yield repos.noteRepository.findById(ref.noteId);
      try {
        assertAiReadableNote(note);
      } catch (error) {
        if (error.code === 'AI_SCOPE_FORBIDDEN') actionError(error.code, error.message, 403);
        throw error;
      }
      if (
        !policy ||
        note.spaceId !== scope.spaceId ||
        policy.excludedNoteIds.includes(note.id) ||
        (policy.scope.kind === 'fixed' && !policy.scope.noteIds.includes(note.id))
      )
        denied();
      if (policy.scope.kind === 'folder') {
        let folderId = note.folderId,
          allowed = false;
        const seen = new Set();
        while (folderId && !seen.has(folderId)) {
          seen.add(folderId);
          const folder = yield repos.folderRepository.findById(folderId);
          if (!folder || folder.deletedAt || folder.spaceId !== scope.spaceId) break;
          if (folderId === policy.scope.folderId) {
            allowed = true;
            break;
          }
          folderId = folder.parentId;
        }
        if (!allowed) denied();
      }
    }
  }
  return {
    verify,
    async resolve(input, scope) {
      const conversation = await conversationStore?.getConversation(input.conversationId);
      const message =
        conversation &&
        (await conversationStore.listMessages(input.conversationId, 0, 100_000)).find(
          row => row.messageId === input.sourceMessageId
        );
      if (
        !boundary(conversation, scope) ||
        !boundary(message, scope) ||
        message.role !== 'assistant' ||
        message.conversationId !== input.conversationId ||
        typeof message.sourceFree !== 'boolean' ||
        !Array.isArray(message.sourceRefs) ||
        message.sourceFree === Boolean(message.sourceRefs.length)
      )
        actionError('AI_ACTION_SOURCE_INVALID', '对话来源不可用。', 422);
      const turn = await conversationStore.peekTurn(message.turnId);
      if (
        !boundary(turn, scope) ||
        turn.status !== 'succeeded' ||
        turn.conversationId !== input.conversationId ||
        turn.assistantMessageId !== message.messageId
      )
        denied();
      const manifest = message.provenanceManifestId
        ? await accessStore?.get('aiRequestManifest', message.provenanceManifestId)
        : null;
      const policy = turn.requestedPolicyId ? await accessStore?.get('aiAccessPolicy', turn.requestedPolicyId) : null;
      if (
        message.provenanceManifestId &&
        (!manifest || refsHash([...manifest.sources, ...manifest.historySources]) !== refsHash(message.sourceRefs))
      )
        denied();
      const source = {
        sourceKind: 'assistantMessage',
        conversationId: input.conversationId,
        messageId: message.messageId,
        turnId: message.turnId,
        originGeneration: turn.leaseGeneration,
        contentHash: hashRecord(message.content),
        sourceFree: message.sourceFree,
        sourceRefs: structuredClone(
          manifest
            ? [
                ...new Map(
                  [...manifest.sources, ...manifest.historySources].map(ref => [hashRecord(ref), ref])
                ).values()
              ]
            : message.sourceRefs
        ),
        provenanceManifestId: message.provenanceManifestId ?? null,
        manifestHash: manifest ? hashRecord(manifest) : null,
        policyId: turn.requestedPolicyId ?? null,
        policyRevision: policy?.revision ?? null
      };
      return source;
    }
  };
}
