import Ajv2020 from 'ajv/dist/2020.js';
import schema from './contracts/note-actions-v1.schema.json' with { type: 'json' };
import { calculateContentHash } from '../knowledge/domain/note-version.js';
import { hashRecord } from './record-contract.ts';
import { validateCoreOperationReceipt } from '../../infrastructure/core-operation-contract.ts';
import { createAppError } from '../../errors/app-error.js';

export const actionError = (code, message, status = 409) => {
  throw createAppError(code, message, status);
};
export const DRAFT_LEASE_MS = 120000;
export const emptyActionState = () => ({ version: 2, actions: [], drafts: [] });
export const actionIdentityKeys = [
  'ownerId',
  'actorId',
  'datasetId',
  'datasetEpoch',
  'spaceId',
  'requestId',
  'operationId'
];
const validatePlanSchema = new /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (
  /** @type {unknown} */ (Ajv2020)
)({ strict: false }).compile(schema);
const statuses = [
  'awaitingApproval',
  'authorized',
  'applying',
  'applied',
  'rejected',
  'cancelled',
  'expired',
  'conflicted',
  'failed'
];
export function validateActionState(value) {
  if (value?.version === 1 && Array.isArray(value.drafts)) {
    if (value.drafts.some(row => !row || 'leaseExpiresAt' in row)) invalid();
    value = {
      ...structuredClone(value),
      version: 2,
      drafts: value.drafts.map(row => ({ ...row, leaseExpiresAt: new Date(Date.now() + DRAFT_LEASE_MS).toISOString() }))
    };
  }
  if (
    !value ||
    value.version !== 2 ||
    !Array.isArray(value.actions) ||
    !Array.isArray(value.drafts) ||
    Object.keys(value).some(key => !['version', 'actions', 'drafts'].includes(key))
  )
    invalid();
  const ids = new Set(),
    requests = new Set();
  for (const row of value.actions) {
    if (
      !row ||
      !statuses.includes(row.status) ||
      actionIdentityKeys.some(key => typeof row[key] !== 'string' || !row[key]) ||
      typeof row.actionId !== 'string' ||
      !row.actionId ||
      !/^[a-f0-9]{64}$/.test(row.inputHash) ||
      !Number.isFinite(Date.parse(row.expiresAt)) ||
      !Number.isFinite(Date.parse(row.createdAt))
    )
      invalid();
    validateActionPlan(row.plan);
    if (actionIdentityKeys.some(key => row[key] !== row.plan[key])) invalid();
    const operation = JSON.stringify([row.ownerId, row.datasetId, row.operationId]);
    const request = JSON.stringify([row.ownerId, row.datasetId, row.spaceId, row.requestId]);
    if (ids.has(operation) || requests.has(request)) invalid();
    ids.add(operation);
    requests.add(request);
    if (
      !row.grant ||
      row.grant.requestHash !== row.inputHash ||
      row.grant.toolName !== row.plan.toolName ||
      actionIdentityKeys.some(key => row.grant[key] !== row[key]) ||
      hashRecord(row.grant.targetIds) !== hashRecord(row.plan.items.map(item => item.after.id)) ||
      row.grant.expiresAt !== row.expiresAt ||
      typeof row.grant.revoked !== 'boolean'
    )
      invalid();
    if (row.grant.originTurnId !== undefined) {
      if (
        row.grant.originTurnId !== row.requestId ||
        !Number.isSafeInteger(row.grant.originGeneration) ||
        row.grant.originGeneration < 1 ||
        !['notes_create', 'notes_append', 'notes_propose_patch', 'notes_propose_organize'].includes(row.plan.toolName)
      )
        invalid();
      if (row.grant.autonomousOrigin !== undefined && row.grant.autonomousOrigin !== true) invalid();
      if (
        row.grant.policyId === null
          ? row.grant.policyRevision !== null || row.plan.toolName !== 'notes_create'
          : typeof row.grant.policyId !== 'string' ||
            !row.grant.policyId ||
            !Number.isSafeInteger(row.grant.policyRevision) ||
            row.grant.policyRevision < 1
      )
        invalid();
    } else if (
      ['originGeneration', 'policyId', 'policyRevision', 'autonomousOrigin', 'sourceRefs', 'catalogDeps'].some(
        key => key in row.grant
      )
    )
      invalid();
    // 目录依赖：成果里可能含目录与笔记标题（空正文笔记、纯目录名也要覆盖），作为独立元数据贯穿采纳、续改与恢复。
    if (row.grant.catalogDeps !== undefined) {
      const deps = row.grant.catalogDeps;
      const ids = (list, limit) =>
        Array.isArray(list) &&
        list.length <= limit &&
        list.every(id => typeof id === 'string' && id && id.length <= 128);
      if (
        !row.grant.originTurnId ||
        !deps ||
        typeof deps !== 'object' ||
        Object.keys(deps).some(key => !['noteIds', 'folderIds'].includes(key)) ||
        !ids(deps.noteIds, 200) ||
        !ids(deps.folderIds, 100)
      )
        invalid();
    }
    if (
      row.grant.sourceRefs !== undefined &&
      (!row.grant.originTurnId ||
        !Array.isArray(row.grant.sourceRefs) ||
        row.grant.sourceRefs.length > 128 ||
        row.grant.sourceRefs.some(
          ref =>
            !ref ||
            typeof ref.noteId !== 'string' ||
            !ref.noteId ||
            typeof ref.noteVersionId !== 'string' ||
            !ref.noteVersionId ||
            !/^[a-f0-9]{64}$/.test(ref.contentHash) ||
            !/^[a-f0-9]{64}$/.test(ref.quoteHash) ||
            !Number.isSafeInteger(ref.start) ||
            !Number.isSafeInteger(ref.end) ||
            ref.start < 0 ||
            ref.end <= ref.start ||
            Object.keys(ref).some(
              key => !['noteId', 'noteVersionId', 'contentHash', 'start', 'end', 'quoteHash'].includes(key)
            )
        ))
    )
      invalid();
    if (
      row.approval &&
      (row.approval.planHash !== row.plan.planHash ||
        row.approval.actorId !== row.actorId ||
        !Number.isFinite(Date.parse(row.approval.expiresAt)))
    )
      invalid();
    if (row.receipt) {
      const receipt = validateCoreOperationReceipt(row.receipt);
      // validateActionPlan 已限定笔记工具；kind 不一致时先短路，下面只读取已匹配的笔记结果。
      if (
        actionIdentityKeys.some(key => row[key] !== receipt[key]) ||
        receipt.planHash !== row.plan.planHash ||
        receipt.kind !== row.plan.toolName ||
        hashRecord(
          /** @type {import('../../infrastructure/core-operation-types.ts').CoreNoteResult} */ (receipt.result).changes
            .map(change => change.noteId)
            .sort()
        ) !== hashRecord(row.plan.items.map(item => item.after.id).sort()) ||
        /** @type {import('../../infrastructure/core-operation-types.ts').CoreNoteResult} */ (
          receipt.result
        ).changes.some(
          change =>
            change.contentHash !==
            calculateContentHash(row.plan.items.find(item => item.after.id === change.noteId).after.rawMarkdown)
        )
      )
        invalid();
    }
    if (row.inboxEvents !== undefined) {
      if (
        !Array.isArray(row.inboxEvents) ||
        new Set(row.inboxEvents.map(event => event?.requestId)).size !== row.inboxEvents.length
      )
        invalid();
      let previousResult = null;
      for (const event of row.inboxEvents) {
        if (
          !event ||
          !['revise', 'repreview'].includes(event.kind) ||
          typeof event.requestId !== 'string' ||
          !event.requestId ||
          !/^[a-f0-9]{64}$/.test(event.inputHash) ||
          !/^[a-f0-9]{64}$/.test(event.resultPlanHash) ||
          !Number.isFinite(Date.parse(event.createdAt))
        )
          invalid();
        if (
          event.originTurnId !== undefined &&
          (event.kind !== 'revise' ||
            typeof event.originTurnId !== 'string' ||
            !event.originTurnId ||
            event.requestId !== event.originTurnId ||
            !Number.isSafeInteger(event.originGeneration) ||
            event.originGeneration < 1)
        )
          invalid();
        validateActionPlan(event.previousPlan);
        if (
          actionIdentityKeys.some(key => event.previousPlan[key] !== row[key]) ||
          event.previousPlan.toolName !== row.plan.toolName ||
          (previousResult && event.previousPlan.planHash !== previousResult) ||
          (event.kind === 'repreview' && event.previousPlan.planHash !== event.resultPlanHash) ||
          hashRecord(event.previousPlan.items.map(item => ({ before: item.before, baseline: item.baseline }))) !==
            hashRecord(row.plan.items.map(item => ({ before: item.before, baseline: item.baseline })))
        )
          invalid();
        previousResult = event.resultPlanHash;
      }
      if (previousResult && previousResult !== row.plan.planHash) invalid();
    }
    if (row.status === 'applied' && !row.receipt) invalid();
  }
  if (new Set(value.actions.map(row => row.actionId)).size !== value.actions.length) invalid();
  for (const row of value.drafts) {
    if (
      !row ||
      ['ownerId', 'datasetId', 'datasetEpoch', 'noteId', 'clientId'].some(
        key => typeof row[key] !== 'string' || !row[key]
      ) ||
      typeof row.dirty !== 'boolean' ||
      typeof row.leaseExpiresAt !== 'string' ||
      !Number.isFinite(Date.parse(row.leaseExpiresAt))
    )
      invalid();
  }
  return structuredClone(value);
}
export function validateActionPlan(plan) {
  if (!validatePlanSchema(plan)) invalid();
  const { planHash, ...content } = plan;
  if (hashRecord(content) !== planHash || new Set(plan.items.map(item => item.after.id)).size !== plan.items.length)
    invalid();
  if (plan.toolName !== 'notes_propose_organize' && plan.toolName !== 'notes_undo' && plan.items.length !== 1)
    invalid();
  for (const item of plan.items) {
    if (
      item.after.spaceId !== plan.spaceId ||
      item.baseline.targetNoteId !== item.after.id ||
      Buffer.byteLength(item.after.rawMarkdown) > 400000 ||
      !item.after.title.trim() ||
      (item.softDelete !== undefined && plan.toolName !== 'notes_undo')
    )
      invalid();
    if (
      plan.toolName === 'notes_create'
        ? item.before !== null || item.baseline.exists
        : !item.before || !item.baseline.exists
    )
      invalid();
    if (item.before) {
      if (
        item.before.id !== item.after.id ||
        item.before.spaceId !== plan.spaceId ||
        !Number.isFinite(Date.parse(item.baseline.expectedUpdatedAt)) ||
        calculateContentHash(item.before.rawMarkdown) !== item.baseline.contentHash ||
        hashRecord({
          title: item.before.title,
          folderId: item.before.folderId,
          tagIds: [...item.before.tagIds].sort(),
          spaceId: item.before.spaceId,
          ...(item.before.aiVisibility !== undefined ? { aiVisibility: item.before.aiVisibility } : {})
        }) !== item.baseline.metadataHash
      )
        invalid();
      if (plan.toolName === 'notes_propose_organize' && item.before.rawMarkdown !== item.after.rawMarkdown) invalid();
    }
    if (['notes_append', 'notes_propose_patch'].includes(plan.toolName)) {
      const { rawMarkdown: beforeBody, ...beforeMetadata } = item.before;
      const { rawMarkdown: afterBody, ...afterMetadata } = item.after;
      if (
        hashRecord(beforeMetadata) !== hashRecord(afterMetadata) ||
        !item.edits.length ||
        (plan.toolName === 'notes_append' &&
          (item.edits.length !== 1 || item.edits[0].start !== item.edits[0].end || item.edits[0].quote !== ''))
      )
        invalid();
      let previousEnd = -1;
      for (const edit of item.edits) {
        if (
          edit.start < previousEnd ||
          edit.end < edit.start ||
          edit.end > beforeBody.length ||
          (plan.toolName === 'notes_propose_patch' && edit.end === edit.start) ||
          beforeBody.slice(edit.start, edit.end) !== edit.quote ||
          !boundary(beforeBody, edit.start) ||
          !boundary(beforeBody, edit.end)
        )
          invalid();
        previousEnd = edit.end;
      }
      let body = beforeBody;
      for (const edit of [...item.edits].reverse())
        body = body.slice(0, edit.start) + edit.replacement + body.slice(edit.end);
      if (body !== afterBody || body === beforeBody) invalid();
    } else if (item.edits.length) invalid();
    for (const target of [item.before, item.after].filter(Boolean)) {
      if (target.aiVisibility !== undefined && target.aiVisibility !== 'normal') invalid();
      if (
        (target.folderId && !plan.references.some(ref => ref.kind === 'folder' && ref.id === target.folderId)) ||
        target.tagIds.some(id => !plan.references.some(ref => ref.kind === 'tag' && ref.id === id))
      )
        invalid();
    }
    if (item.softDelete && hashRecord(item.before) !== hashRecord(item.after)) invalid();
  }
  return structuredClone(plan);
}
function boundary(text, offset) {
  return (
    offset === 0 ||
    offset === text.length ||
    !(
      text.charCodeAt(offset - 1) >= 0xd800 &&
      text.charCodeAt(offset - 1) <= 0xdbff &&
      text.charCodeAt(offset) >= 0xdc00 &&
      text.charCodeAt(offset) <= 0xdfff
    )
  );
}
function invalid() {
  actionError('AI_ACTION_STORAGE_INVALID', '动作记录无效，已停止写入并保留原记录。', 503);
}

/** adapter 的 write 和业务提交使用同一核心事务锁，防止批准/撤销与提交交错。 */
export function createActionStore(adapter) {
  let initialized = false,
    initializing = null;
  const write = operation => {
    const result = adapter.write((input, identity) => {
      const state = validateActionState(input);
      const output = operation(state, identity);
      if (output?.then) throw new TypeError('动作状态变更必须同步。');
      const validated = validateActionState(state);
      return { state: validated, result: structuredClone(output) };
    });
    const done = value => {
      initialized = true;
      return value;
    };
    return result?.then ? result.then(done) : done(result);
  };
  function initialize() {
    if (initialized) return;
    if (initializing) return initializing;
    // 将 v1 无期限草稿锁的一次性宽限租约持久化；重复读取和重启不能无限续期。
    const result = write(() => null);
    if (result?.then)
      initializing = result.finally(() => {
        initializing = null;
      });
    return initializing;
  }
  return {
    transaction: adapter.transaction,
    identity: adapter.identity,
    read: () => {
      const ready = initialize();
      return ready?.then ? ready.then(adapter.read) : adapter.read();
    },
    write
  };
}
export function createJsonActionStore({ getState, runTransaction, onChange }) {
  return createActionStore({
    transaction: runTransaction,
    identity: () => ({ datasetId: getState().datasetId, datasetEpoch: getState().datasetEpoch }),
    read: () => validateActionState(getState().actionLedger),
    write: operation =>
      runTransaction(() => {
        const output = operation(getState().actionLedger, {
          datasetId: getState().datasetId,
          datasetEpoch: getState().datasetEpoch
        });
        getState().actionLedger = output.state;
        onChange();
        return output.result;
      })
  });
}
