import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import schema from './contracts/ai-v2.schema.json' with { type: 'json' };
import { hashRecord } from './record-contract.ts';

export const ACCESS_KINDS = Object.freeze({
  aiAccessPolicy: { collection: 'accessPolicies', id: 'policyId' },
  aiRunGrant: { collection: 'runGrants', id: 'grantId' },
  aiRequestManifest: { collection: 'requestManifests', id: 'manifestId' }
});

const ajv = new /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (/** @type {unknown} */ (Ajv2020))({
  strict: false,
  allErrors: true
});
/** @type {import('ajv-formats').FormatsPlugin} */ (/** @type {unknown} */ (addFormats))(ajv);
ajv.addSchema(schema);
/** @type {Record<string, (value: unknown) => boolean>} */
const validators = Object.fromEntries(
  Object.keys(ACCESS_KINDS).map(kind => [kind, ajv.compile({ $ref: `${schema.$id}#/$defs/${kind}` })])
);

export function accessError(code, message) {
  /** @type {Error & Partial<Pick<import('../../errors/app-error.ts').AppError, 'code'>>} */
  const error = new Error(message);
  error.code = code;
  throw error;
}

export function validateAccessRecord(kind, input) {
  const validate = validators[kind];
  if (!validate || !input || typeof input !== 'object' || !validate(input) || input.kind !== kind) {
    accessError('AI_RECORD_INVALID', `AI ${kind} v2 记录无效。`);
  }
  if (
    kind === 'aiAccessPolicy' &&
    (Date.parse(input.expiresAt) <= Date.parse(input.issuedAt) ||
      !input.read ||
      (input.egress && !input.recipients.length) ||
      (!input.egress && input.recipients.length))
  ) {
    accessError('AI_RECORD_INVALID', '持续授权的有效期或权限无效。');
  }
  if (kind === 'aiRunGrant' && Date.parse(input.expiresAt) <= Date.parse(input.issuedAt)) {
    accessError('AI_RECORD_INVALID', '运行授权有效期无效。');
  }
  if (kind === 'aiRequestManifest' && [...input.sources, ...input.historySources].some(ref => ref.end <= ref.start))
    accessError('AI_RECORD_INVALID', '发送清单来源范围无效。');
  return structuredClone(input);
}

export function validateAccessRelationships(state) {
  const policies = new Map(state.accessPolicies.map(row => [row.policyId, row]));
  const grants = new Map(state.runGrants.map(row => [row.grantId, row]));
  const boundary = (left, right) =>
    ['ownerId', 'datasetId', 'datasetEpoch', 'spaceId'].every(key => left[key] === right[key]);
  for (const grant of grants.values()) {
    const policy = policies.get(grant.policyId);
    if (
      !policy ||
      !boundary(grant, policy) ||
      grant.actorId !== policy.actorId ||
      grant.policyRevision > policy.revision
    )
      accessError('AI_REFERENCE_INVALID', 'v2 运行授权引用不完整。');
  }
  for (const manifest of state.requestManifests) {
    const grant = grants.get(manifest.grantId);
    const policy = policies.get(manifest.policyId);
    if (
      !grant ||
      !policy ||
      !boundary(manifest, grant) ||
      !boundary(manifest, policy) ||
      manifest.policyId !== grant.policyId ||
      manifest.policyRevision !== grant.policyRevision
    ) {
      accessError('AI_REFERENCE_INVALID', 'v2 请求清单引用不完整。');
    }
  }
}

/** v2 私有记录与 v1 并存；适配器的 compareAndSwap 必须是原子操作。 */
export function createAiAccessStore(adapter) {
  async function assertBoundary(record) {
    const identity = await adapter.identity();
    if (record.datasetId !== identity.datasetId || record.datasetEpoch !== identity.datasetEpoch) {
      accessError('AI_DATASET_STALE', '资料集已切换，请重新授权。');
    }
  }
  async function assertParent(kind, record) {
    if (kind === 'aiAccessPolicy') return;
    const policy = await adapter.get('aiAccessPolicy', record.policyId);
    if (
      !policy ||
      policy.ownerId !== record.ownerId ||
      policy.datasetId !== record.datasetId ||
      policy.datasetEpoch !== record.datasetEpoch ||
      policy.spaceId !== record.spaceId ||
      policy.revision !== record.policyRevision ||
      policy.revokedAt ||
      (kind === 'aiRunGrant' && policy.actorId !== record.actorId)
    ) {
      accessError('AI_REFERENCE_INVALID', 'v2 授权策略引用不匹配。');
    }
    if (kind === 'aiRequestManifest') {
      const grant = await adapter.get('aiRunGrant', record.grantId);
      if (
        !grant ||
        grant.policyId !== policy.policyId ||
        grant.policyRevision !== record.policyRevision ||
        grant.ownerId !== record.ownerId ||
        grant.datasetId !== record.datasetId ||
        grant.datasetEpoch !== record.datasetEpoch ||
        grant.spaceId !== record.spaceId ||
        !policy.egress ||
        !policy.recipients.includes(record.recipient) ||
        hashRecord(record.excludedNoteIds) !== hashRecord(policy.excludedNoteIds)
      ) {
        accessError('AI_REFERENCE_INVALID', '逐请求清单的运行授权不匹配。');
      }
    }
  }
  return {
    peek(kind, id) {
      if (!ACCESS_KINDS[kind]) accessError('AI_RECORD_INVALID', '未知的 v2 AI 记录。');
      const row = adapter.get(kind, id);
      const validate = value => (value ? validateAccessRecord(kind, value) : null);
      return row?.then ? row.then(validate) : validate(row);
    },
    // 本机 MCP 最后一个 await 之后同步复核资料集边界；异步后端不伪装成原子快照。
    peekIdentity() {
      const identity = adapter.identity();
      if (identity?.then) throw new TypeError('同步授权快照不支持异步资料集存储。');
      return structuredClone(identity);
    },
    async identity() {
      return structuredClone(await adapter.identity());
    },
    async get(kind, id) {
      if (!ACCESS_KINDS[kind]) accessError('AI_RECORD_INVALID', '未知的 v2 AI 记录。');
      const row = await adapter.get(kind, id);
      return row ? validateAccessRecord(kind, row) : null;
    },
    async list(kind) {
      if (!ACCESS_KINDS[kind]) accessError('AI_RECORD_INVALID', '未知的 v2 AI 记录。');
      return (await adapter.list(kind)).map(row => validateAccessRecord(kind, row));
    },
    async insert(kind, input) {
      const record = validateAccessRecord(kind, input);
      await assertBoundary(record);
      await assertParent(kind, record);
      await adapter.insert(kind, record);
      return record;
    },
    async replacePolicy(input, expectedHash) {
      const record = validateAccessRecord('aiAccessPolicy', input);
      await assertBoundary(record);
      if (!/^[a-f0-9]{64}$/.test(expectedHash)) accessError('AI_RECORD_INVALID', '策略版本哈希无效。');
      await adapter.compareAndSwap(record, expectedHash);
      return record;
    }
  };
}

export function createJsonAiAccessStore({ getState, runTransaction, onChange }) {
  const idField = kind => ACCESS_KINDS[kind].id;
  const rows = kind => getState()[ACCESS_KINDS[kind].collection];
  return createAiAccessStore({
    identity: () => ({ datasetId: getState().datasetId, datasetEpoch: getState().datasetEpoch }),
    get: (kind, id) => rows(kind).find(row => row[idField(kind)] === id) ?? null,
    list: kind => rows(kind),
    insert: (kind, record) =>
      runTransaction(() => {
        if (rows(kind).some(row => row[idField(kind)] === record[idField(kind)])) {
          accessError('AI_RECORD_DUPLICATE', 'AI v2 记录 ID 已存在。');
        }
        rows(kind).push(record);
        onChange();
      }),
    compareAndSwap: (record, expectedHash) =>
      runTransaction(() => {
        const index = rows('aiAccessPolicy').findIndex(row => row.policyId === record.policyId);
        if (index < 0) accessError('AI_RECORD_NOT_FOUND', '授权策略不存在。');
        if (hashRecord(rows('aiAccessPolicy')[index]) !== expectedHash) {
          accessError('AI_RECORD_CONFLICT', '授权策略已变化。');
        }
        rows('aiAccessPolicy')[index] = record;
        onChange();
      })
  });
}
