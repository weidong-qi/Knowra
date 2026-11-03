import { randomUUID } from 'node:crypto';
import { sameEntity } from '../../api/src/modules/sync/entity-contract.ts';
import { assertSyncContract, SYNC_ENTITY_SCHEMA_VERSION } from '../../api/src/modules/sync/protocol-contract.ts';
import { readMeta, writeMeta } from './sync-state.mjs';

const TYPES = Object.freeze({
  knowledgeItem: { collection: 'knowledgeItems', route: 'items', method: 'DELETE', action: 'permanent' },
  learningObjective: {
    collection: 'learningObjectives',
    route: 'learning-objectives',
    method: 'POST',
    action: 'purge'
  },
  examProfile: { collection: 'examProfiles', route: 'exam-profiles', method: 'POST', action: 'purge' },
  examFocus: { collection: 'examFocuses', route: 'exam-focuses', method: 'POST', action: 'purge' },
  question: { collection: 'questions', route: 'questions', method: 'POST', action: 'purge' }
});
const PENDING = 'authoritativePurgePending';
const fail = (code, message) => {
  throw Object.assign(new Error(message), { code, status: 409 });
};
const includesId = (value, ids) =>
  typeof value === 'string'
    ? ids.has(value)
    : value && typeof value === 'object'
      ? Object.values(value).some(child => includesId(child, ids))
      : false;
const configFor = type => TYPES[type] ?? fail('LOCAL_PURGE_SCOPE_UNSUPPORTED', '当前联网清理仅支持五类手工资产。');
const pathFor = (type, id) => `/api/knowledge/${configFor(type).route}/${encodeURIComponent(id)}`;

export function authoritativePurgeRoute(method, pathname) {
  const match = pathname.match(
    /^\/api\/knowledge\/(items|learning-objectives|exam-profiles|exam-focuses|questions)\/([^/]+)\/(purge-preview|permanent|purge)$/
  );
  if (!match) return null;
  const [type, config] = Object.entries(TYPES).find(([, value]) => value.route === match[1]);
  if (method === 'GET' && match[3] === 'purge-preview')
    return { type, id: decodeURIComponent(match[2]), action: 'preview' };
  if (method === config.method && match[3] === config.action)
    return { type, id: decodeURIComponent(match[2]), action: 'execute' };
  return null;
}

function exclusiveEntries(type, id, preview) {
  const entries = [{ collection: configFor(type).collection, id }],
    exclusive = preview.exclusiveRecords ?? {};
  const names = {
    knowledgeEvidenceIds: 'knowledgeEvidence',
    knowledgeArtifactProvenanceIds: 'knowledgeArtifactProvenance',
    questionObjectives: 'questionObjectives',
    questionSources: 'questionSources'
  };
  for (const [name, ids] of Object.entries(exclusive)) {
    if (!names[name] || !Array.isArray(ids) || ids.some(value => typeof value !== 'string' || !value))
      fail('LOCAL_PURGE_INVALID_RESPONSE', '云端清理范围无法核对，原件已保留。');
    entries.push(...ids.map(entityId => ({ collection: names[name], id: entityId })));
  }
  return entries;
}

export function createAuthoritativePurge({ store, exclusive, synchronize, request, pull, connection }) {
  const confirmations = new Map();
  const meta = key => store.readSync(db => readMeta(db, key));
  function binding({ requireCursor = true } = {}) {
    if (
      !connection() ||
      !meta('serverUrl') ||
      meta('clientPaused') ||
      !meta('ownerId') ||
      !meta('epoch') ||
      meta('epoch') !== meta('serverEpoch') ||
      (requireCursor && !meta('cursor'))
    ) {
      fail('LOCAL_PURGE_CONNECTION_REQUIRED', '请先连接兼容的云端并完成同步，再预检永久清理。');
    }
    assertSyncContract({ entitySchemaVersion: SYNC_ENTITY_SCHEMA_VERSION, capabilities: meta('capabilities') });
    return {
      serverOrigin: meta('serverUrl'),
      ownerId: meta('ownerId'),
      datasetEpoch: meta('epoch'),
      datasetId: store.getStatus().datasetId
    };
  }
  function assertBinding(expected, options) {
    if (meta('serverEpoch') && expected.datasetEpoch !== meta('serverEpoch'))
      fail('LOCAL_PURGE_BINDING_CHANGED', '云端资料库世代已变化，原清理结果及本地修改已保留，请先核对资料库。');
    const current = binding(options);
    if (Object.entries(expected).some(([key, value]) => current[key] !== value))
      fail('LOCAL_PURGE_BINDING_CHANGED', '云端或资料库绑定已变化，请重新预检。');
  }
  function guard(type, id, entries = [{ collection: configFor(type).collection, id }]) {
    const ids = new Set(entries.map(entry => entry.id));
    store.readSync((db, state) => {
      const base = db.prepare('SELECT collection,id,payload FROM sync_base').all();
      const outbox = db
        .prepare("SELECT changes FROM sync_outbox WHERE state!='acknowledged'")
        .all()
        .flatMap(row => JSON.parse(row.changes));
      // 引用可能刚在当前值中移除；闭包同时纳入权威旧值和待确认事务 before/value。
      const relatedRecords = [
        ...Object.values(state).flat(),
        ...base.map(row => JSON.parse(row.payload)).filter(Boolean),
        ...outbox.flatMap(change => [change.before, change.value]).filter(Boolean)
      ];
      let expanded = true;
      while (expanded) {
        expanded = false;
        for (const record of relatedRecords)
          if (includesId(record, ids)) {
            for (const relatedId of [record.id, record.questionId])
              if (relatedId && !ids.has(relatedId)) {
                ids.add(relatedId);
                expanded = true;
              }
          }
      }
      const asset = state[configFor(type).collection].find(row => row.id === id);
      if (
        asset &&
        ((type === 'knowledgeItem' &&
          (asset.sourceMode !== 'manual' || state.knowledgeArtifactProvenance.some(row => row.artifactId === id))) ||
          (type === 'examFocus' && asset.sourceType !== 'manual') ||
          (type === 'question' && asset.sourceMode !== 'manual'))
      ) {
        fail('PURGE_MANUAL_SCOPE_REQUIRED', '当前联网清理仅支持手工资产，请保留生成资产及来源记录。');
      }
      const relevant = value => includesId(value, ids);
      const previous = new Map(base.map(row => [JSON.stringify([row.collection, row.id]), JSON.parse(row.payload)]));
      for (const [collection, rows] of Object.entries(state)) {
        const records = new Map(rows.map(row => [row.id, row]));
        for (const row of base.filter(entry => entry.collection === collection))
          if (!records.has(row.id)) records.set(row.id, null);
        for (const [entityId, value] of records) {
          const old = previous.get(JSON.stringify([collection, entityId])) ?? null;
          if ((ids.has(entityId) || relevant(value) || relevant(old)) && !sameEntity(collection, value, old))
            fail('LOCAL_PURGE_PENDING_CHANGES', '清理对象或关联资料仍有本地修改，请先同步或处理冲突。');
        }
      }
      const frozen = readMeta(db, 'entityUpload');
      if (frozen && (frozen.changes?.some(relevant) || frozen.dependencies?.some(relevant)))
        fail('LOCAL_PURGE_PENDING_CHANGES', '关联资料尚有未确认的同步请求，请先核对同步结果。');
      const conflict = readMeta(db, 'entityConflict');
      if (
        conflict &&
        (conflict.changedEpoch ||
          conflict.blocked?.some(key => {
            const [collection, entityId] = JSON.parse(key);
            return (
              ids.has(entityId) ||
              relevant(state[collection]?.find(row => row.id === entityId)) ||
              relevant(previous.get(key)) ||
              relevant(conflict.remote?.find(row => row.collection === collection && row.id === entityId))
            );
          }))
      )
        fail('LOCAL_PURGE_PENDING_CHANGES', '关联资料存在同步冲突，请先保留修改并解决冲突。');
      const notes = db
        .prepare('SELECT payload FROM sync_conflicts')
        .all()
        .map(row => JSON.parse(row.payload));
      if (notes.some(relevant)) fail('LOCAL_PURGE_PENDING_CHANGES', '关联来源笔记存在同步冲突，请先处理。');
      if (outbox.some(relevant)) fail('LOCAL_PURGE_PENDING_CHANGES', '关联资料的待同步事务尚未确认，请先完成同步。');
    });
  }
  function pending() {
    let record;
    try {
      record = meta(PENDING);
    } catch {
      fail('LOCAL_PURGE_PENDING_INVALID', '清理结果核对记录不完整，请保留本地资料并导出备份。');
    }
    if (record === null || record === undefined) return null;
    const collections = new Set([
      ...Object.values(TYPES).map(type => type.collection),
      'knowledgeEvidence',
      'knowledgeArtifactProvenance',
      'questionObjectives',
      'questionSources'
    ]);
    if (
      record.version !== 1 ||
      !TYPES[record.type] ||
      typeof record.id !== 'string' ||
      !record.binding ||
      !Array.isArray(record.entries) ||
      record.entries.some(entry => !collections.has(entry.collection) || typeof entry.id !== 'string' || !entry.id) ||
      !record.entries.some(entry => entry.collection === configFor(record.type).collection && entry.id === record.id) ||
      ['serverOrigin', 'ownerId', 'datasetEpoch'].some(
        key => typeof record.binding[key] !== 'string' || !record.binding[key]
      ) ||
      typeof record.expectedUpdatedAt !== 'string'
    ) {
      fail('LOCAL_PURGE_PENDING_INVALID', '清理结果核对记录不完整，请保留本地资料并导出备份。');
    }
    return record;
  }
  function verified(record) {
    // 只读快照可能保全脏分支而未能推进cursor；真实修订墓碑仍可确认云端事实。
    assertBinding(record.binding, { requireCursor: false });
    return record.entries.every(entry =>
      store.deletionFacts
        .list()
        .some(
          fact =>
            fact.collection === entry.collection &&
            fact.entityId === entry.id &&
            fact.source.kind === 'remote-delete' &&
            fact.source.epoch === record.binding.datasetEpoch &&
            fact.source.serverOrigin === record.binding.serverOrigin &&
            fact.source.ownerId === record.binding.ownerId &&
            Number.isSafeInteger(fact.source.revision) &&
            fact.source.revision > 0
        )
    );
  }
  function settle(record) {
    if (!verified(record)) return null;
    const localState = record.entries.some(entry => store.state[entry.collection].some(row => row.id === entry.id))
      ? 'recovery-required'
      : 'synchronized';
    const result = {
      status: 'subject-purged',
      asset: { type: record.type, id: record.id },
      localState,
      ...(localState === 'recovery-required' ? { message: '云端已清理，本地修改仍保留，请从同步恢复记录中处理。' } : {})
    };
    store.metadataTransaction(db => {
      writeMeta(db, PENDING, null);
      writeMeta(db, 'authoritativePurgeResult', result);
    });
    return result;
  }
  async function verifyConnection(expected, options) {
    const info = await request('/api/sync/status');
    assertSyncContract(info);
    if (info.ownerId !== expected.ownerId || info.datasetEpoch !== expected.datasetEpoch)
      fail('LOCAL_PURGE_BINDING_CHANGED', '云端资料库已变化，请重新同步并预检。');
    assertBinding(expected, options);
  }
  pending(); // 新启动必须明确验证私有记录，不能猜测丢失字段。
  return {
    status: () => ({ pending: pending(), result: meta('authoritativePurgeResult') }),
    async reconcile() {
      const record = pending();
      if (!record) return true;
      const bound = { ...record.binding, datasetId: store.getStatus().datasetId };
      assertBinding(bound, { requireCursor: false });
      await pull();
      assertBinding(bound, { requireCursor: false });
      return Boolean(settle(record));
    },
    preview(type, id) {
      return exclusive(async () => {
        const record = pending();
        configFor(type);
        const before = binding({ requireCursor: !record });
        if (record) {
          await verifyConnection(record.binding, { requireCursor: false });
          await pull();
          assertBinding(before, { requireCursor: false });
          settle(record);
        } else await synchronize();
        assertBinding(before);
        guard(type, id);
        await verifyConnection(before);
        guard(type, id);
        const preview = await request(`${pathFor(type, id)}/purge-preview`);
        assertBinding(before);
        guard(type, id);
        if (
          preview.asset?.type !== type ||
          preview.asset?.id !== id ||
          typeof preview.expectedUpdatedAt !== 'string' ||
          preview.expectedDatasetEpoch !== before.datasetEpoch
        )
          fail('LOCAL_PURGE_INVALID_RESPONSE', '云端预检缺少匹配的清理版本或世代，请升级云端并重新预检。');
        const entries = exclusiveEntries(type, id, preview);
        guard(type, id, entries);
        // 已完成一次真实权威读取且主体仍存在：解除未知旧结果，必须用新预检再次人工确认。
        if (record && pending() && record.type === type && record.id === id)
          store.metadataTransaction(db => writeMeta(db, PENDING, null));
        const confirmationToken = randomUUID();
        confirmations.set(confirmationToken, { type, id, binding: before, entries, preview });
        return { ...preview, confirmationToken };
      });
    },
    execute(type, id, input) {
      return exclusive(async () => {
        const confirmation = confirmations.get(input?.confirmationToken);
        if (
          !confirmation ||
          confirmation.type !== type ||
          confirmation.id !== id ||
          input.expectedUpdatedAt !== confirmation.preview.expectedUpdatedAt ||
          input.expectedDatasetEpoch !== confirmation.binding.datasetEpoch
        )
          fail('LOCAL_PURGE_PREVIEW_REQUIRED', '请重新联网预检并明确确认此对象的永久清理。');
        if (pending()) fail('LOCAL_PURGE_RESULT_PENDING', '上次清理结果待核对，请先重新预检。');
        await synchronize();
        assertBinding(confirmation.binding);
        guard(type, id, confirmation.entries);
        await verifyConnection(confirmation.binding);
        guard(type, id, confirmation.entries);
        const current = store.state[configFor(type).collection].find(row => row.id === id);
        if (!current || current.updatedAt !== input.expectedUpdatedAt)
          fail('LOCAL_PURGE_PREVIEW_STALE', '对象已变化，请重新预检后确认。');
        if (
          confirmation.preview.decision !== 'can-purge-no-history' ||
          confirmation.preview.coverage?.runningTasks !== 'verified'
        )
          fail('LOCAL_PURGE_BLOCKED', '请先处理云端预检指出的引用或任务记录。');
        // 待核对命令绑定云端身份；恢复备份会更新本机datasetId，但仍需核对同云端原结果。
        const { datasetId, ...remoteBinding } = confirmation.binding;
        const record = {
          version: 1,
          type,
          id,
          expectedUpdatedAt: input.expectedUpdatedAt,
          binding: remoteBinding,
          entries: confirmation.entries,
          startedAt: new Date().toISOString()
        };
        store.metadataTransaction(db => writeMeta(db, PENDING, record));
        confirmations.delete(input.confirmationToken);
        let result;
        try {
          result = await request(
            `${pathFor(type, id)}/${configFor(type).action}`,
            { expectedUpdatedAt: input.expectedUpdatedAt, expectedDatasetEpoch: input.expectedDatasetEpoch },
            configFor(type).method
          );
        } catch (failure) {
          // 明确的拒绝证明没有执行；网络丢响应或服务端异常仍须拉取核对。
          if (failure.status >= 400 && failure.status < 500)
            store.metadataTransaction(db => writeMeta(db, PENDING, null));
          throw failure;
        }
        if (!['subject-purged', 'already-purged'].includes(result?.status))
          fail('LOCAL_PURGE_RESULT_PENDING', '清理结果待核对，原件已保留；请联网重新预检。');
        await pull();
        const confirmed = settle(record);
        if (!confirmed) fail('LOCAL_PURGE_RESULT_PENDING', '尚未收到云端删除事实，不能确认清理成功；原件已保留。');
        return { ...result, ...confirmed, status: result.status };
      });
    }
  };
}
