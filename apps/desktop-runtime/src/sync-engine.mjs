import { readSyncHistory, assertNotHistoryOperation } from './sync-history.mjs';
import { assertLegacyAnnotationChanges } from '../../api/src/modules/sync/batch-domain.ts';
import { createEmptyLocalState } from '../../api/src/infrastructure/local-data-schema.js';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import {
  assertSyncContract,
  assertSnapshotBinding,
  syncContract,
  syncContractQuery
} from '../../api/src/modules/sync/protocol-contract.ts';
import { KNOWLEDGE_SYNC_CAPABILITY, KNOWLEDGE_COLLECTIONS } from '../../api/src/modules/sync/entity-contract.ts';
import {
  applyEntityRemote,
  nextEntityUpload,
  acknowledgeEntityUpload,
  getEntitySyncState,
  resolveEntityConflict
} from './entity-sync-state.mjs';
import {
  applyRemote,
  nextUpload,
  acknowledge,
  getSyncState,
  resolveConflict,
  readMeta,
  writeMeta
} from './sync-state.mjs';
import { createSyncScheduler } from './sync-scheduler.mjs';
import { clearKnowledgeLifecycleUpload } from './knowledge-lifecycle-boundaries.mjs';
import { clearExamFocusReviewUpload } from './exam-focus-review-boundaries.mjs';
import { createSyncExecutionGate } from './sync-execution-gate.mjs';
import { createSyncTransport } from './sync-transport.mjs';
import { createAuthoritativePurge } from './authoritative-purge.mjs';
import { createSyncRecovery } from './sync-recovery.mjs';
import { readRecoverySession } from './sync-recovery-state.mjs';
import {
  assertStoreSyncNotPaused,
  persistUnconfirmedSending,
  beginUpload,
  clearUploadSafety,
  isPreparedUpload,
  pauseUncertainSync,
  readSyncSafetyPause,
  syncSafetyError,
  syncSenderDeviceId
} from './sync-safety.mjs';

export function createSyncEngine(
  store,
  {
    fetcher = fetch,
    intervalMs = 15000,
    noteService,
    autoSync = true,
    entityTransfer = null,
    clock,
    createRecoveryBackup
  } = {}
) {
  persistUnconfirmedSending(store);
  const execution = createSyncExecutionGate();
  let authorization = '';
  let recoveryAuthorization = '';
  const full = Boolean(entityTransfer);
  let closed = false;
  let phase = 'not-configured';
  let error = null;
  let failures = 0;
  let retryAt = 0;
  let lastCheckedAt = null;
  let changed = false;
  let more = false;
  let missingAttachments = { revision: -1, entries: [] };
  let sequenceVerified = false;
  const meta = key => store.readSync(db => readMeta(db, key));
  function requireServer(info) {
    assertSyncContract(info);
    if (!full || info.protocolVersion !== 1 || info.scope !== 'notes') {
      const failure = new Error('请使用支持完整来源同步的新版应用；本地数据和待同步修改已保留。');
      failure.code = 'SYNC_CLIENT_UPGRADE_REQUIRED';
      throw failure;
    }
  }
  const contractedRoute = route => `${route}${route.includes('?') ? '&' : '?'}${syncContractQuery()}`;
  const { request, fetchSync } = createSyncTransport({
    fetcher,
    getServerUrl: () => meta('serverUrl'),
    getAuthorization: () => authorization
  });
  const recoveryTransport = createSyncTransport({
    fetcher,
    getServerUrl: () => meta('serverUrl'),
    getAuthorization: () => recoveryAuthorization
  });
  const safetyRecovery = createSyncRecovery({
    store,
    request: recoveryTransport.request,
    createBackup: createRecoveryBackup,
    noteService,
    entityTransfer
  });
  async function receive(entries, cursor, epoch, reset = false) {
    if (!full) {
      applyRemote(store, entries, cursor, epoch, { reset });
      return true;
    }
    const revision = store.getEntityCacheKey();
    if (missingAttachments.revision !== revision)
      missingAttachments = {
        revision,
        entries: store.readSync((db, state) =>
          state.attachments
            .filter(item => ['missing', 'corrupt', 'failed'].includes(item.status))
            .flatMap(item => {
              const row = db
                .prepare("SELECT * FROM sync_base WHERE collection = 'attachments' AND id = ?")
                .get(item.id);
              return row
                ? [
                    {
                      collection: 'attachments',
                      id: item.id,
                      revision: row.server_revision,
                      value: JSON.parse(row.payload)
                    }
                  ]
                : [];
            })
        )
      };
    for (const entry of [...entries, ...missingAttachments.entries])
      if (entry.collection === 'attachments' && entry.value?.status === 'ready') {
        try {
          entityTransfer.verify(entry.value);
        } catch {
          store.metadataTransaction(db => writeMeta(db, 'attachmentPending', entry.id));
          const fileRoute =
            entry.value.mimeType === 'application/pdf'
              ? `/api/storage/pdf-files/${encodeURIComponent(entry.id)}`
              : `/api/storage/attachments/${encodeURIComponent(entry.id)}/content`;
          const response = await fetchSync(`${meta('serverUrl')}${fileRoute}`, {
            headers: authorization ? { Authorization: authorization } : {},
            redirect: 'error',
            signal: AbortSignal.timeout(30000)
          });
          if (!response.ok) {
            const failure = new Error(`附件下载失败（${response.status}），已保留待传输任务。`);
            if ([401, 403].includes(response.status)) failure.code = 'AUTH_REQUIRED';
            throw failure;
          }
          if (entry.value.mimeType === 'application/pdf')
            await entityTransfer.putStream({ attachment: entry.value, stream: Readable.fromWeb(response.body) });
          else {
            const reader = response.body.getReader();
            const chunks = [];
            let total = 0;
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              total += value.byteLength;
              if (total > 6 * 1024 * 1024) {
                await reader.cancel();
                throw new Error('附件下载超过支持的体积，已停止传输。');
              }
              chunks.push(value);
            }
            const bytes = Buffer.concat(chunks, total);
            entityTransfer.put({ attachment: entry.value, contentBase64: bytes.toString('base64') });
          }
          store.syncTransaction((db, state) => {
            writeMeta(db, 'attachmentPending', null);
            const local = state.attachments.find(item => item.id === entry.id);
            if (local?.sha256 === entry.value.sha256 && ['missing', 'corrupt', 'failed'].includes(local.status)) {
              local.status = 'ready';
              local.verifiedAt = new Date().toISOString();
            }
          });
        }
      }
    return applyEntityRemote(store, entries, cursor, epoch, { reset });
  }
  async function bootstrap() {
    let download = meta('bootstrap');
    if (download) {
      try {
        assertSnapshotBinding(download, syncContract(), meta('ownerId'), meta('serverEpoch'));
      } catch {
        await request('snapshot-release', { snapshotId: download.snapshotId }).catch(() => undefined);
        store.metadataTransaction(db => {
          writeMeta(db, 'bootstrap', null);
          db.prepare("DELETE FROM metadata WHERE key LIKE 'sync:bootstrapPage:%'").run();
        });
        download = null;
      }
    }
    if (!download) {
      const start = await request('bootstrap', syncContract());
      assertSnapshotBinding(start, syncContract(), meta('ownerId'), meta('serverEpoch'));
      download = { ...start, entries: [], offset: 0, ...(full ? { pages: [] } : {}) };
      store.metadataTransaction(db => writeMeta(db, 'bootstrap', download));
    }
    while (download.offset !== null) {
      const page = await request(
        contractedRoute(`snapshot?snapshotId=${encodeURIComponent(download.snapshotId)}&offset=${download.offset}`)
      );
      assertSnapshotBinding(page, syncContract(), download.ownerId, download.datasetEpoch);
      if (
        page.snapshotId !== download.snapshotId ||
        page.cursor !== download.cursor ||
        page.count !== download.count ||
        !Array.isArray(page.entries) ||
        (page.entries.length === 0 && download.offset !== download.count) ||
        (page.nextOffset !== null &&
          (!Number.isSafeInteger(page.nextOffset) ||
            page.nextOffset <= download.offset ||
            page.nextOffset >= download.count ||
            page.nextOffset !== download.offset + page.entries.length)) ||
        (page.nextOffset === null && download.offset + page.entries.length !== download.count)
      ) {
        const failure = new Error('云端快照分页绑定或范围不一致，未应用任何数据。');
        failure.code = 'SYNC_SNAPSHOT_CONTRACT_MISMATCH';
        throw failure;
      }
      const offset = download.offset;
      if (download.pages) download.pages.push(offset);
      else download.entries.push(...page.entries);
      download.offset = page.nextOffset;
      store.metadataTransaction(db => {
        if (download.pages) writeMeta(db, `bootstrapPage:${offset}`, page.entries);
        writeMeta(db, 'bootstrap', download);
      });
    }
    if (download.pages)
      download.entries = store.readSync(db =>
        download.pages.flatMap(offset => readMeta(db, `bootstrapPage:${offset}`) ?? [])
      );
    if (
      download.entries.length !== download.count ||
      new Set(download.entries.map(entry => JSON.stringify([entry.collection, entry.id]))).size !== download.count
    )
      throw new Error('云端快照不完整或含重复实体，请重试。');
    const applied = await receive(download.entries, download.cursor, download.datasetEpoch, true);
    if (download.pages)
      store.metadataTransaction(db => db.prepare("DELETE FROM metadata WHERE key LIKE 'sync:bootstrapPage:%'").run());
    if (full) await request('snapshot-release', { snapshotId: download.snapshotId }).catch(() => undefined);
    return applied;
  }
  async function pull() {
    for (;;) {
      const page = await request(contractedRoute(`changes?cursor=${encodeURIComponent(meta('cursor'))}`));
      assertSyncContract(page);
      if (
        page.ownerId !== meta('ownerId') ||
        page.datasetEpoch !== meta('epoch') ||
        !Array.isArray(page.groups) ||
        page.groups.some(group => !Array.isArray(group.items))
      ) {
        const failure = new Error('同步分页不属于当前资料库基线。');
        failure.code = 'SYNC_INVALID_RESPONSE';
        throw failure;
      }
      if (
        !(await receive(
          page.groups.flatMap(group => group.items),
          page.cursor,
          page.datasetEpoch
        ))
      )
        return false;
      if (!page.hasMore) return true;
    }
  }
  async function sendOperation(operation) {
    assertNotHistoryOperation(operation);
    const blocked = store.metadataTransaction(db => beginUpload(db, operation));
    if (blocked) throw blocked;
    try {
      acknowledge(store, operation, await request('push', operation));
    } catch (failure) {
      const pause = store.metadataTransaction(db => pauseUncertainSync(db, operation, failure.code ?? 'upload-failed'));
      throw syncSafetyError(pause);
    }
  }
  // 设备序号仅在本机即将生成新操作时向云端校准；序号只由本设备推进，进程内核对一次即可。
  async function verifyDeviceSequence() {
    if (sequenceVerified || meta('entityUpload') || !getEntitySyncState(store).pendingEntities) return;
    const device = await request(`device?deviceId=${encodeURIComponent(syncSenderDeviceId(store))}`);
    store.metadataTransaction(db =>
      writeMeta(db, 'entitySequence', Math.max(meta('entitySequence') ?? 0, device.sequence))
    );
    sequenceVerified = true;
  }
  // 返回本轮是否实际提交过操作；未提交时云端游标不会因本机而前进。
  async function uploadEntities() {
    let sent = false;
    await verifyDeviceSequence();
    for (let count = 0; count < 20; count++) {
      const knowledgeSupported = meta('capabilities')?.includes(KNOWLEDGE_SYNC_CAPABILITY) ?? false;
      const operation = nextEntityUpload(store, { knowledgeSupported });
      if (!operation) return sent;
      assertNotHistoryOperation(operation);
      if (
        operation.changes.some(
          entry =>
            (entry.collection === 'contentAnnotations' && entry.value?.schemaVersion !== 3) ||
            entry.collection === 'annotationExclusions'
        )
      ) {
        store.readSync(db => {
          const baseline = createEmptyLocalState();
          for (const row of db
            .prepare("SELECT collection,payload FROM sync_base WHERE payload IS NOT NULL AND payload != 'null'")
            .iterate()) {
            if (Object.hasOwn(baseline, row.collection)) baseline[row.collection].push(JSON.parse(row.payload));
          }
          assertLegacyAnnotationChanges(baseline, operation.changes);
        });
      }
      if (!knowledgeSupported && operation.changes.some(entry => KNOWLEDGE_COLLECTIONS.includes(entry.collection))) {
        const failure = new Error('云端尚不支持知识同步，知识已保存在本机；请升级云端后重试。');
        failure.code = 'SYNC_KNOWLEDGE_UNSUPPORTED';
        throw failure;
      }
      for (const entry of operation.changes)
        if (entry.collection === 'attachments' && entry.value) {
          if (entry.value.mimeType === 'application/pdf') {
            const response = await fetchSync(
              `${meta('serverUrl')}/api/sync/blob-stream`,
              {
                method: 'POST',
                duplex: 'half',
                redirect: 'error',
                headers: {
                  ...(authorization ? { Authorization: authorization } : {}),
                  'Content-Type': 'application/pdf',
                  'X-Knowra-Blob': encodeURIComponent(
                    JSON.stringify({ ...syncContract(), deviceId: operation.deviceId, attachment: entry.value })
                  )
                },
                body: fs.createReadStream(entityTransfer.pathFor(entry.value)),
                signal: AbortSignal.timeout(180000)
              },
              true
            );
            const payload = await response.json();
            if (!response.ok || !payload.data)
              throw Object.assign(new Error(payload.error?.message ?? 'PDF 同步失败'), {
                code: [401, 403].includes(response.status) ? 'AUTH_REQUIRED' : payload.error?.code,
                status: response.status
              });
            continue;
          }
          const content = entityTransfer.read(entry.value);
          await request('blobs', {
            ...syncContract(),
            deviceId: operation.deviceId,
            attachment: entry.value,
            contentBase64: content.toString('base64')
          });
        }
      let result;
      const blocked = store.metadataTransaction(db => beginUpload(db, operation));
      if (blocked) throw blocked;
      try {
        result = await request('batch', operation);
      } catch (failure) {
        if (meta('safetyPause')) throw syncSafetyError(meta('safetyPause'));
        // 只处理本轮首次发送的明确拒绝；过期/复用 ID 不证明原请求从未执行。
        const uncertain = ['OPERATION_REUSED', 'SYNC_OPERATION_EXPIRED', 'DATASET_CHANGED'].includes(failure.code);
        if (
          !uncertain &&
          ['AUTH_REQUIRED', 'SYNC_CLIENT_UPGRADE_REQUIRED', 'SYNC_DEVICE_NOT_ENABLED', 'SYNC_PUSH_PAUSED'].includes(
            failure.code
          )
        ) {
          store.metadataTransaction(db => writeMeta(db, 'sendingUpload', null));
        } else if (
          !uncertain &&
          ['DEPENDENCY_MISSING', 'ENTITY_DELETED', 'SIBLING_NAME_CONFLICT'].includes(failure.code)
        ) {
          store.metadataTransaction(db => {
            writeMeta(db, 'entityUpload', null);
            clearUploadSafety(db);
            clearKnowledgeLifecycleUpload(db);
            clearExamFocusReviewUpload(db);
          });
        } else {
          const pause = store.metadataTransaction(db =>
            pauseUncertainSync(db, operation, failure.code ?? 'upload-failed')
          );
          throw syncSafetyError(pause);
        }
        throw failure;
      }
      acknowledgeEntityUpload(store, operation, result);
      sent = true;
      if (result.status === 'conflict') return sent;
    }
    more = true;
    return sent;
  }
  async function upload() {
    let sent = false;
    // 一轮有界，编辑中产生的后继修改下一轮继续。
    for (let count = 0; count < 100; count++) {
      if (!getSyncState(store).pendingNotes) return sent;
      const operation = nextUpload(store);
      if (!operation) return sent;
      await sendOperation(operation);
      sent = true;
    }
    more = true;
    return sent;
  }
  // 云端游标与本地一致且无待核对事项时，拉取只会得到空页；附件待补传输时仍需进入拉取重试下载。
  function canSkipPull(info) {
    if (
      !info.cursor ||
      info.cursor !== meta('cursor') ||
      info.datasetEpoch !== meta('epoch') ||
      meta('attachmentPending')
    )
      return false;
    if (getSyncState(store).conflicts.length || (full && getEntitySyncState(store).entityConflict)) return false;
    return !store.readSync((_db, state) =>
      state.attachments.some(item => ['missing', 'corrupt', 'failed'].includes(item.status))
    );
  }
  function checkPendingUpload() {
    const existing = meta('safetyPause');
    if (existing) throw syncSafetyError(existing);
    const uncertain = store.readSync(db => {
      const notes = db
        .prepare('SELECT request FROM sync_uploads')
        .all()
        .map(row => JSON.parse(row.request));
      const batch = readMeta(db, 'entityUpload');
      for (const operation of [...notes, ...(batch ? [batch] : [])]) assertNotHistoryOperation(operation);
      // v1 没有设备序号屏障；missing 既可能是回执已淘汰，也可能是请求尚在途中。
      if (notes.length) return { operation: notes[0], reason: 'legacy-v1-upload' };
      if (batch && !isPreparedUpload(db, batch)) return { operation: batch, reason: 'unconfirmed-or-legacy-upload' };
      return null;
    });
    if (uncertain) {
      const pause = store.metadataTransaction(db => pauseUncertainSync(db, uncertain.operation, uncertain.reason));
      throw syncSafetyError(pause);
    }
  }
  async function cycle() {
    changed = false;
    more = false;
    if (!meta('serverUrl') || closed) return;
    if (meta('clientPaused')) {
      phase = 'disconnected';
      return;
    }
    phase = 'syncing';
    error = null;
    const startKey = store.getSyncCacheKey();
    const hadPending = full ? getEntitySyncState(store).pendingEntities : getSyncState(store).pendingNotes;
    try {
      checkPendingUpload();
      const info = await request('status');
      requireServer(info);
      if (meta('ownerId') && info.ownerId !== meta('ownerId'))
        throw new Error('云端所属资料库已改变，请使用独立本地资料目录。');
      await safetyRecovery.verifyBarriers(info, request);
      store.metadataTransaction(db => {
        writeMeta(db, 'ownerId', info.ownerId);
        writeMeta(db, 'capabilities', info.capabilities ?? []);
        writeMeta(db, 'serverEpoch', info.datasetEpoch);
      });
      // 未知执行结果必须先读真实删除事实；不得先把旧主体上传或重发清理。
      if (!(await purge.reconcile())) {
        const failure = new Error('上次清理结果待核对，请联网重新预检并再次确认；原件已保留。');
        failure.code = 'LOCAL_PURGE_RESULT_PENDING';
        throw failure;
      }
      if (meta('epoch') && meta('epoch') !== info.datasetEpoch && !(await bootstrap())) {
        phase = 'conflict';
        return;
      }
      if (!meta('cursor') && !(await bootstrap()) && full) {
        phase = 'conflict';
        return;
      }
      const resumed = full && meta('entityUpload') ? await uploadEntities() : false;
      const upToDate = !resumed && canSkipPull(info);
      if (!upToDate && !(await pull())) {
        if (full) await uploadEntities();
        phase = 'conflict';
        return;
      }
      const sent = full ? await uploadEntities() : await upload();
      if (sent && !(await pull())) {
        if (full) await uploadEntities();
        phase = 'conflict';
        return;
      }
      const pending = full ? getEntitySyncState(store).pendingEntities : getSyncState(store).pendingNotes;
      changed = startKey !== store.getSyncCacheKey();
      lastCheckedAt = new Date().toISOString();
      if (
        !pending &&
        !meta('attachmentPending') &&
        !getSyncState(store).conflicts.length &&
        !(full && getEntitySyncState(store).entityConflict) &&
        (changed || hadPending || !meta('lastSyncedAt'))
      )
        store.metadataTransaction(db => writeMeta(db, 'lastSyncedAt', lastCheckedAt));
      if (
        full &&
        getEntitySyncState(store).pendingKnowledgeEntities &&
        !info.capabilities?.includes(KNOWLEDGE_SYNC_CAPABILITY)
      ) {
        error = {
          code: 'SYNC_KNOWLEDGE_UNSUPPORTED',
          message: '云端尚不支持知识同步，知识已保存在本机；请升级云端后重试。'
        };
      }
      failures = 0;
      retryAt = 0;
      phase =
        getSyncState(store).conflicts.length || (full && getEntitySyncState(store).entityConflict)
          ? 'conflict'
          : pending
            ? 'pending'
            : 'synced';
    } catch (failure) {
      let reportedFailure = failure;
      if (failure.code === 'SYNC_RECOVERY_BARRIER_LOST' && !meta('safetyPause')) {
        const pause = store.metadataTransaction(db =>
          pauseUncertainSync(db, readMeta(db, 'entityUpload'), failure.code)
        );
        reportedFailure = syncSafetyError(pause);
      }
      if (meta('sendingUpload') && !meta('safetyPause')) {
        const pause = store.metadataTransaction(db =>
          pauseUncertainSync(db, readMeta(db, 'entityUpload'), failure.code ?? 'acknowledgement-failed')
        );
        reportedFailure = syncSafetyError(pause);
      }
      error = { code: reportedFailure.code ?? 'NETWORK_ERROR', message: reportedFailure.message };
      if (reportedFailure.code === 'SYNC_OPERATION_EXPIRED') sequenceVerified = false;
      if (['CURSOR_EXPIRED', 'DATASET_CHANGED'].includes(reportedFailure.code)) {
        store.metadataTransaction(db => {
          writeMeta(db, 'cursor', null);
          writeMeta(db, 'bootstrap', null);
        });
      }
      phase = reportedFailure.code === 'AUTH_REQUIRED' ? 'auth-required' : 'paused';
      failures++;
      retryAt =
        (clock?.now() ?? Date.now()) +
        Math.max(Math.min(300000, 1000 * 2 ** Math.min(failures, 8)) + Math.random() * 1000, failure.retryAfterMs || 0);
    }
  }
  const exclusive = operation =>
    execution.run(() => {
      if (closed) {
        const failure = new Error('应用正在关闭，请重新打开后操作。');
        failure.code = 'LOCAL_RUNTIME_CLOSED';
        throw failure;
      }
      return operation();
    });
  async function pullPurgeFacts() {
    checkPendingUpload();
    // 核对命令只读恢复过期基线；快照内带修订号的墓碑才是事实，主体缺席不是。
    if (!meta('cursor')) return bootstrap();
    try {
      return await pull();
    } catch (failure) {
      if (failure.code !== 'CURSOR_EXPIRED') throw failure;
      store.metadataTransaction(db => {
        writeMeta(db, 'cursor', null);
        writeMeta(db, 'bootstrap', null);
      });
      return bootstrap();
    }
  }
  const purge = createAuthoritativePurge({
    store,
    exclusive,
    connection: () => full,
    synchronize: async () => {
      checkPendingUpload();
      await cycle();
      if (error) throw Object.assign(new Error(error.message), { code: error.code });
    },
    request: (route, body, method) => request(route, body, meta('serverUrl'), method),
    pull: pullPurgeFacts
  });
  const scheduler = createSyncScheduler({
    run: () => execution.run(cycle),
    autoSync,
    intervalMs,
    clock,
    policy: () => ({
      stopped:
        closed ||
        !meta('serverUrl') ||
        meta('clientPaused') ||
        meta('safetyPause') ||
        phase === 'auth-required' ||
        [
          'PROTOCOL_UNSUPPORTED',
          'SYNC_CLIENT_UPGRADE_REQUIRED',
          'SYNC_LEGACY_OPERATION_UNRESOLVED',
          'SYNC_HISTORY_READ_ONLY'
        ].includes(error?.code),
      retryAt,
      changed,
      more
    })
  });
  const sync = () => scheduler.sync();
  const unsubscribe = store.onLocalCommit(() => scheduler.wake('local'));
  scheduler.start();
  return {
    async budgetRequest(route, body) {
      const serverUrl = meta('serverUrl');
      if (!serverUrl || meta('clientPaused') || closed) {
        const failure = new Error('云端预算权威不可用，已阻止模型调用。');
        failure.code = 'AI_BUDGET_UNAVAILABLE';
        throw failure;
      }
      const response = await fetcher(`${serverUrl}/api/ai/budget/${route}`, {
        method: body === undefined ? 'GET' : 'POST',
        redirect: 'error',
        headers: {
          ...(authorization ? { Authorization: authorization } : {}),
          'X-Knowra-AI-Budget': '1',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15000)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.data) {
        const failure = new Error(data.error?.message ?? '云端预算权威不可用，已阻止模型调用。');
        failure.code = data.error?.code ?? 'AI_BUDGET_UNAVAILABLE';
        throw failure;
      }
      return data.data;
    },
    status: () => ({
      ...getSyncState(store),
      ...(full ? getEntitySyncState(store) : {}),
      lastCheckedAt,
      knowledgeSyncSupported: meta('capabilities')?.includes(KNOWLEDGE_SYNC_CAPABILITY) ?? null,
      attachmentPending: meta('attachmentPending'),
      deviceId: syncSenderDeviceId(store),
      localDeviceId: store.getStatus().deviceId,
      phase: meta('safetyPause') ? 'paused' : phase,
      error: meta('safetyPause') ?? error,
      safetyPaused: Boolean(meta('safetyPause')),
      recoverySession: safetyRecovery.summary(),
      authoritativePurge: purge.status()
    }),
    purgePreview: purge.preview,
    purge: purge.execute,
    async configure({ serverUrl, username = '', password = '' }) {
      return exclusive(async () => {
        assertStoreSyncNotPaused(store);
        const url = new URL(serverUrl);
        if (url.username || url.password || url.search || url.hash || url.pathname !== '/')
          throw new Error('请输入不含账号、路径或参数的云端服务地址。');
        if (
          url.protocol !== 'https:' &&
          !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
        )
          throw new Error('云端地址必须使用 HTTPS。');
        if (meta('serverUrl') && meta('serverUrl') !== url.origin)
          throw new Error('此本地资料库已绑定其他服务，请新建独立资料目录。');
        authorization = username ? `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` : '';
        let info;
        try {
          info = await request('status', undefined, url.origin);
          requireServer(info);
        } catch (failure) {
          if (meta('serverUrl')) {
            error = { code: failure.code ?? 'SYNC_ACTION_FAILED', message: failure.message };
            phase = failure.code === 'AUTH_REQUIRED' ? 'auth-required' : 'paused';
          }
          throw failure;
        }
        if (meta('ownerId') && info.ownerId !== meta('ownerId'))
          throw new Error('云端所属资料库已改变，请使用独立本地资料目录。');
        store.metadataTransaction(db => {
          writeMeta(db, 'serverUrl', url.origin);
          writeMeta(db, 'clientPaused', false);
        });
        await cycle();
        return this.status();
      });
    },
    async disconnect() {
      scheduler.pause();
      return exclusive(async () => {
        authorization = '';
        recoveryAuthorization = '';
        store.metadataTransaction(db => writeMeta(db, 'clientPaused', true));
        scheduler.pause();
        phase = 'disconnected';
        error = null;
        return this.status();
      });
    },
    sync,
    wake: reason => scheduler.wake(reason),
    recovery: () =>
      store.readSync((db, state) => [
        ...(full
          ? [
              {
                kind: 'pending-local-data',
                exportedAt: new Date().toISOString(),
                snapshot: structuredClone(state),
                conflict: readMeta(db, 'entityConflict'),
                upload: readMeta(db, 'entityUpload'),
                safetyPause: readSyncSafetyPause(db),
                recoverySession: readRecoverySession(db),
                base: db.prepare('SELECT * FROM sync_base').all(),
                localRevisions: db.prepare('SELECT * FROM local_revisions').all(),
                deletionFacts: db.prepare('SELECT * FROM deletion_facts').all(),
                syncMetadata: db.prepare("SELECT key,value FROM metadata WHERE key LIKE 'sync:%'").all(),
                legacyUploads: db
                  .prepare('SELECT request FROM sync_uploads')
                  .all()
                  .map(row => JSON.parse(row.request)),
                outbox: db.prepare('SELECT * FROM sync_outbox ORDER BY sequence').all()
              }
            ]
          : []),
        ...db
          .prepare('SELECT payload FROM sync_recovery ORDER BY rowid DESC')
          .all()
          .map(row => readSyncHistory(row.payload))
      ]),
    async recover(input = {}) {
      return exclusive(async () => {
        if (!full)
          throw Object.assign(new Error('完整来源同步尚未可用，不能恢复。'), { code: 'SYNC_RECOVERY_UNAVAILABLE' });
        if (
          (typeof input.username !== 'string' && input.username !== undefined) ||
          (typeof input.password !== 'string' && input.password !== undefined)
        )
          throw Object.assign(new Error('登录字段无效。'), { code: 'SYNC_RECOVERY_INVALID' });
        recoveryAuthorization = input.username
          ? `Basic ${Buffer.from(`${input.username}:${input.password ?? ''}`).toString('base64')}`
          : authorization;
        await safetyRecovery.prepare(input);
        return this.status();
      });
    },
    recoveryPreview: input => safetyRecovery.preview(input),
    async recoverResolve(input) {
      return exclusive(async () => {
        await safetyRecovery.resolve(input);
        authorization = recoveryAuthorization;
        sequenceVerified = false;
        await cycle();
        return this.status();
      });
    },
    async retry() {
      return exclusive(async () => {
        if (meta('safetyPause')) return this.status();
        checkPendingUpload();
        store.metadataTransaction(db => writeMeta(db, 'blocked', {}));
        await cycle();
        return this.status();
      });
    },
    async resolve(input) {
      return exclusive(async () => {
        checkPendingUpload();
        assertStoreSyncNotPaused(store);
        if (full && input.conflictId) resolveEntityConflict(store, input, noteService, entityTransfer);
        else resolveConflict(store, input, noteService);
        await cycle();
        return this.status();
      });
    },
    async close() {
      closed = true;
      authorization = '';
      recoveryAuthorization = '';
      unsubscribe();
      await scheduler.close();
      await execution.drain();
    }
  };
}
