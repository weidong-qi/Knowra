import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { resolveAssetPath, serveV4Asset } from '../../web/server/static-assets.mjs';
import { lockDataDirectory } from './data-directory.mjs';
import {
  createRuntimeBackup,
  listRuntimeBackups,
  backupPath,
  inspectRuntimeBackup,
  readBackupDrafts,
  validateBackupDrafts
} from './backup.mjs';
import { createRuntimeServices } from './runtime-services.mjs';
import {
  readActiveDirectory,
  prepareRestoredDirectory,
  finalizeRestoredDirectory,
  activateRestoredDirectory
} from './restore-directory.mjs';
import { readRestoreContext, RESTORE_READINESS_CONFLICTS } from './restore-readiness.mjs';
import { runtimeSessionScript } from './runtime-session-script.mjs';
import { permitsLocalRoute, sendRuntimeError } from './runtime-policy.mjs';
import { parseBody } from '../../api/src/http/request.ts';
import { exportRuntimeBackup, importRuntimeBackup } from './backup-transfers.mjs';
import { authoritativePurgeRoute } from './authoritative-purge.mjs';
import { startMcpRuntime } from './mcp/index.mjs';
import { createMcpTools } from './mcp/tools.mjs';
import { createMcpEntityOutput } from './mcp/entity-output.mjs';
import { handleMcpPairingRoute } from './mcp/pairing-routes.mjs';
import { createHttpShutdown } from './http-shutdown.mjs';

export async function startLocalRuntime({
  dataDirectory,
  distRoot,
  port = 0,
  logger = console,
  syncOptions = {},
  credentialSource = null,
  aiRuntimeFactory,
  mcpTools = null,
  mcpLimits,
  mcpNow,
  mcpAdapter,
  onCloseStage = () => {}
} = {}) {
  if (!path.isAbsolute(dataDirectory ?? '')) throw new Error('本地数据目录必须是绝对路径。');
  if (!fs.existsSync(path.join(distRoot, 'index.html'))) throw new Error('缺少前端构建，请先运行 npm run build:web。');
  const release = lockDataDirectory(dataDirectory);
  let store;
  let server;
  let sync;
  let handleApi;
  let recoverAi;
  let closeAi;
  let getAi;
  let getAnnotations;
  let getAiFeatures;
  let getTaskService;
  let getTaskIdentity;
  let mcp = null;
  let closeHttp;
  const reportCloseStage = stage => {
    try {
      onCloseStage(stage);
    } catch {
      /* 诊断失败不得阻止排空与退出。 */
    }
  };
  try {
    let activeDirectory = readActiveDirectory(dataDirectory);
    ({
      store,
      sync,
      handleApi,
      recoverAi,
      closeAi,
      getAi,
      getAnnotations,
      getAiFeatures,
      getTaskService,
      getTaskIdentity
    } = createRuntimeServices({
      dataDirectory: activeDirectory,
      budgetDirectory: dataDirectory,
      backupRoot: dataDirectory,
      logger,
      syncOptions,
      credentialSource,
      aiRuntimeFactory
    }));
    // AI 恢复在后台进行，不能延迟本地笔记服务启动。
    void recoverAi;
    const secret = randomBytes(32).toString('hex');
    const cookieName = `knowra_local_${randomBytes(8).toString('hex')}`;
    let origin;
    let sessionClaimed = false;
    let restoring = false;
    let closed = false;
    let closing;
    const checkBackupTransfer = datasetId => {
      if (closed || restoring) throw new Error('正在恢复资料或关闭应用，请完成后重新选择备份。');
      if (datasetId !== store.getStatus().datasetId) throw new Error('资料库已变化，请重新加载后操作备份。');
    };
    const activeRequests = new Set();
    server = http.createServer(async (request, response) => {
      let finishRequest;
      const requestDone = new Promise(resolve => {
        finishRequest = resolve;
      });
      activeRequests.add(requestDone);
      try {
        if (
          request.headers.host !== new URL(origin).host ||
          (request.headers.origin && request.headers.origin !== origin) ||
          request.headers['sec-fetch-site'] === 'cross-site'
        ) {
          return sendRuntimeError(response, 403, 'LOCAL_ORIGIN_REJECTED', '本地服务拒绝外部来源。');
        }
        const url = new URL(request.url, origin);
        if (request.method === 'GET' && url.pathname === `/local-session/${secret}` && !sessionClaimed) {
          sessionClaimed = true;
          response.writeHead(303, {
            Location: '/',
            'Set-Cookie': `${cookieName}=${secret}; HttpOnly; SameSite=Strict; Path=/`,
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer'
          });
          response.end();
          return;
        }
        if (!(request.headers.cookie ?? '').split(';').some(part => part.trim() === `${cookieName}=${secret}`)) {
          return sendRuntimeError(response, 401, 'LOCAL_SESSION_REQUIRED', '请从本地运行入口打开应用。');
        }
        if (url.pathname.startsWith('/api/')) {
          if (closed || restoring)
            return sendRuntimeError(
              response,
              503,
              'LOCAL_RESTORE_BUSY',
              '正在恢复资料或关闭应用，请等待完成后重新加载。'
            );
          const dataset = request.headers['x-knowra-dataset'];
          const assistantRoute = /^\/api\/ai\/(?:assistant|conversations|access-policies|actions)(?:\/|$)/.test(
            url.pathname
          );
          const requiresDataset =
            assistantRoute || (activeDirectory !== dataDirectory && !['GET', 'HEAD'].includes(request.method));
          // 原生图片和下载请求无法附加 fetch header；只读资源可使用会话授权。
          if ((dataset || requiresDataset) && dataset !== store.getStatus().datasetId) {
            return sendRuntimeError(
              response,
              409,
              'LOCAL_DATASET_CHANGED',
              '资料库已恢复，请重新加载此窗口；当前草稿仍保留。'
            );
          }
        }
        if (request.method === 'GET' && url.pathname === '/api/local-runtime/backups') {
          response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          response.end(JSON.stringify({ data: { items: listRuntimeBackups(dataDirectory) } }));
          return;
        }
        const backupRoute = url.pathname.match(/^\/api\/local-runtime\/backups\/([^/]+)\/(inspect|restore|drafts)$/);
        if (backupRoute) {
          try {
            const directory = backupPath(dataDirectory, backupRoute[1]);
            let result;
            if (request.method === 'POST' && backupRoute[2] === 'inspect')
              result = inspectRuntimeBackup(directory, { restoreContext: readRestoreContext(store) });
            else if (request.method === 'GET' && backupRoute[2] === 'drafts') {
              inspectRuntimeBackup(directory);
              result = readBackupDrafts(directory);
            } else if (request.method === 'POST' && backupRoute[2] === 'restore') {
              restoring = true;
              try {
                const input = await parseBody(request);
                if (input.confirmBackupId !== backupRoute[1]) throw new Error('请先检查备份并明确确认恢复。');
                if (input.recoveryDrafts !== undefined) validateBackupDrafts(input.recoveryDrafts);
                await Promise.all([...activeRequests].filter(item => item !== requestDone));
                // 先在独立目录验证和准备，任何错误都不触碰当前资料。
                const restoredDirectory = prepareRestoredDirectory(dataDirectory, directory, {
                  restoreContext: readRestoreContext(store)
                });
                await sync.close();
                await closeAi();
                let replacement;
                try {
                  // 两个后台 owner 都已排空；此处重新读取，不沿用 prepare 时的快照。
                  finalizeRestoredDirectory(restoredDirectory, readRestoreContext(store));
                  const protectionDirectory = createRuntimeBackup(store, activeDirectory, {
                    backupRoot: dataDirectory,
                    purpose: 'before-restore',
                    recoveryDrafts: input.recoveryDrafts
                  });
                  replacement = createRuntimeServices({
                    dataDirectory: restoredDirectory,
                    budgetDirectory: dataDirectory,
                    backupRoot: dataDirectory,
                    logger,
                    syncOptions,
                    credentialSource,
                    aiRuntimeFactory
                  });
                  void replacement.recoverAi;
                  const record = {
                    restoredAt: new Date().toISOString(),
                    sourceBackupId: backupRoute[1],
                    protectionBackupId: path.basename(protectionDirectory),
                    previousDirectory: activeDirectory
                  };
                  activateRestoredDirectory(dataDirectory, restoredDirectory, record);
                  const previousStore = store;
                  ({
                    store,
                    sync,
                    handleApi,
                    recoverAi,
                    closeAi,
                    getAi,
                    getAnnotations,
                    getAiFeatures,
                    getTaskService,
                    getTaskIdentity
                  } = replacement);
                  activeDirectory = restoredDirectory;
                  try {
                    previousStore.close();
                  } catch (failure) {
                    logger.error?.('Previous local store close failed', failure);
                  }
                  result = {
                    ...record,
                    datasetId: store.getStatus().datasetId,
                    directory: restoredDirectory,
                    syncPaused: true
                  };
                } catch (failure) {
                  if (replacement) {
                    await replacement.closeAi();
                    await replacement.sync.close();
                    replacement.store.close();
                  }
                  // 原资料仍原封不动；重建同步服务以恢复暂停前的可用状态。
                  store.close();
                  ({
                    store,
                    sync,
                    handleApi,
                    recoverAi,
                    closeAi,
                    getAi,
                    getAnnotations,
                    getAiFeatures,
                    getTaskService,
                    getTaskIdentity
                  } = createRuntimeServices({
                    dataDirectory: activeDirectory,
                    budgetDirectory: dataDirectory,
                    backupRoot: dataDirectory,
                    logger,
                    syncOptions,
                    credentialSource,
                    aiRuntimeFactory
                  }));
                  void recoverAi;
                  throw failure;
                }
              } finally {
                restoring = false;
              }
            } else return sendRuntimeError(response, 404, 'ROUTE_NOT_FOUND', '路径不存在。');
            response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            response.end(JSON.stringify({ data: result }));
            return;
          } catch (failure) {
            const readiness = RESTORE_READINESS_CONFLICTS.has(failure.code);
            return sendRuntimeError(
              response,
              readiness ? 409 : 422,
              readiness ? failure.code : 'LOCAL_BACKUP_FAILED',
              failure.message ?? '备份操作失败，原资料已保留。'
            );
          }
        }
        if (request.method === 'GET' && url.pathname === '/api/local-runtime/status') {
          response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          response.end(JSON.stringify({ data: store.getStatus() }));
          return;
        }
        const purgeRoute = authoritativePurgeRoute(request.method, url.pathname);
        if (purgeRoute) {
          try {
            const result =
              purgeRoute.action === 'preview'
                ? await sync.purgePreview(purgeRoute.type, purgeRoute.id)
                : await sync.purge(purgeRoute.type, purgeRoute.id, await parseBody(request));
            response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            response.end(JSON.stringify({ data: result }));
            return;
          } catch (failure) {
            return sendRuntimeError(
              response,
              failure.status ?? 409,
              failure.code ?? 'LOCAL_PURGE_FAILED',
              failure.message ?? '清理未完成，原件已保留。'
            );
          }
        }
        if (url.pathname.startsWith('/api/local-runtime/mcp/')) {
          const handled = await handleMcpPairingRoute({ request, response, url, mcp, parseBody });
          if (handled) return;
        }
        if (url.pathname.startsWith('/api/local-runtime/sync')) {
          try {
            let result;
            if (request.method === 'GET' && url.pathname.endsWith('/sync')) result = sync.status();
            else if (request.method === 'GET' && url.pathname.endsWith('/recovery-preview'))
              result = sync.recoveryPreview(Object.fromEntries(url.searchParams));
            else if (request.method === 'GET' && url.pathname.endsWith('/recovery')) result = sync.recovery();
            else if (request.method === 'POST' && url.pathname.endsWith('/recover'))
              result = await sync.recover(await parseBody(request));
            else if (request.method === 'POST' && url.pathname.endsWith('/recover-resolve'))
              result = await sync.recoverResolve(await parseBody(request));
            else if (request.method === 'POST' && url.pathname.endsWith('/configure'))
              result = await sync.configure(await parseBody(request));
            else if (request.method === 'POST' && url.pathname.endsWith('/disconnect'))
              result = await sync.disconnect();
            else if (request.method === 'POST' && url.pathname.endsWith('/retry')) result = await sync.retry();
            else if (request.method === 'POST' && url.pathname.endsWith('/wake')) {
              const input = await parseBody(request);
              sync.wake(input.reason === 'online' ? 'online' : 'focus');
              result = sync.status();
            } else if (request.method === 'POST' && url.pathname.endsWith('/resolve'))
              result = await sync.resolve(await parseBody(request));
            else return sendRuntimeError(response, 404, 'ROUTE_NOT_FOUND', '路径不存在。');
            response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            response.end(JSON.stringify({ data: result }));
            return;
          } catch (failure) {
            return sendRuntimeError(
              response,
              422,
              failure.code ?? 'SYNC_ACTION_FAILED',
              failure.message ?? '同步操作失败。'
            );
          }
        }
        if (request.method === 'POST' && url.pathname === '/api/local-runtime/backup') {
          try {
            const input = await parseBody(request);
            const directory = createRuntimeBackup(store, activeDirectory, {
              backupRoot: dataDirectory,
              recoveryDrafts: input.recoveryDrafts
            });
            response.writeHead(201, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            response.end(JSON.stringify({ data: { id: path.basename(directory), directory } }));
            return;
          } catch (failure) {
            return sendRuntimeError(
              response,
              failure.statusCode ?? 422,
              failure.code ?? 'LOCAL_BACKUP_FAILED',
              failure.message ?? '创建备份失败。'
            );
          }
        }
        if (url.pathname.startsWith('/api/')) {
          if (!permitsLocalRoute(request.method, url.pathname)) {
            return sendRuntimeError(
              response,
              409,
              'LOCAL_FEATURE_UNAVAILABLE',
              '当前阶段尚未开放此操作，本地笔记已保留。'
            );
          }
          await handleApi(request, response);
          return;
        }
        if (['GET', 'HEAD'].includes(request.method)) {
          const asset = resolveAssetPath(url.pathname, distRoot);
          if (asset && path.basename(asset) === 'index.html') {
            const config = runtimeSessionScript(store.getStatus().datasetId, {
              legacyDraftsAllowed: activeDirectory === dataDirectory
            });
            const html = fs.readFileSync(asset, 'utf8').replace('<head>', `<head>${config}`);
            response.writeHead(200, {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'no-store',
              'X-Content-Type-Options': 'nosniff',
              'Referrer-Policy': 'no-referrer'
            });
            response.end(request.method === 'HEAD' ? undefined : html);
            return;
          }
          if (serveV4Asset({ request, response, pathname: url.pathname, distRoot })) return;
        }
        sendRuntimeError(response, 404, 'ROUTE_NOT_FOUND', '路径不存在。');
      } catch (error) {
        logger.error?.('Local runtime request failed', error);
        if (!response.headersSent)
          sendRuntimeError(response, 500, 'LOCAL_STORAGE_FAILED', '本地操作失败，请保留当前内容并重试或导出。');
        else response.end();
      } finally {
        activeRequests.delete(requestDone);
        finishRequest();
      }
    });
    closeHttp = createHttpShutdown(server, activeRequests);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
    origin = `http://127.0.0.1:${server.address().port}`;
    // 外部 AI 客户端入口只在本机 socket 上；装配失败不能影响本地笔记，只是该入口不可用。
    try {
      mcp = await startMcpRuntime({
        dataDirectory,
        logger,
        getTaskService: () => getTaskService?.(),
        getTaskIdentity: () => getTaskIdentity?.(),
        proposalsEnabled: async () => Boolean((await getAiFeatures?.()?.get())?.knowledgeProposals),
        proposalsNow: () => Boolean(getAiFeatures?.()?.peek().knowledgeProposals),
        tools: mcpTools ?? createMcpTools({ getAnnotations: () => getAnnotations?.(), getAi: () => getAi?.() }),
        limits: mcpLimits,
        now: mcpNow,
        // 适配器启动方式由装配方给出：开发时是 node 加源码路径，Mac 应用里是应用自带的可执行文件加打包后的脚本。
        adapter:
          mcpAdapter === undefined
            ? {
                command: process.execPath,
                args: [fileURLToPath(new URL('./mcp/adapter.mjs', import.meta.url))],
                env: {}
              }
            : mcpAdapter,
        getAccess: () => getAi?.()?.access ?? null,
        getEntityResult: createMcpEntityOutput({ getAi: () => getAi?.() }),
        flags: () => ({
          aiEnabled: Boolean(getAi?.()?.access) && process.env.KNOWRA_AI_ENABLED !== '0',
          allowExternal: process.env.KNOWRA_AI_EGRESS_ENABLED !== '0'
        })
      });
    } catch (failure) {
      logger.warn?.('MCP runtime unavailable', { code: failure?.code ?? 'MCP_START_FAILED' });
    }
    return {
      origin,
      launchUrl: `${origin}/local-session/${secret}`,
      get store() {
        return store;
      },
      // 仅程序装配的私有 IPC 调用；HTTP 不接收本机路径。
      backupTransfer({ action, datasetId, backupId, selection }) {
        checkBackupTransfer(datasetId);
        if (action === 'status') return { datasetId };
        let result;
        if (action === 'export') result = exportRuntimeBackup(dataDirectory, backupId, selection);
        else if (action === 'import') result = importRuntimeBackup(dataDirectory, selection);
        else throw new Error('未知的完整备份操作。');
        checkBackupTransfer(datasetId);
        return result;
      },
      close() {
        if (closing) return closing;
        closed = true;
        closing = (async () => {
          reportCloseStage('mcp');
          await mcp?.close();
          reportCloseStage('http');
          await closeHttp();
          reportCloseStage('sync');
          await sync.close();
          reportCloseStage('ai');
          await closeAi();
          reportCloseStage('store');
          store.close();
          release();
          reportCloseStage('released');
        })();
        return closing;
      }
    };
  } catch (error) {
    await mcp?.close().catch(() => {});
    if (closeHttp) await closeHttp();
    const results = await Promise.allSettled([sync?.close(), closeAi?.()]);
    const failed = results.find(result => result.status === 'rejected');
    // eslint-disable-next-line preserve-caught-error -- 原异常已保留在 AggregateError.errors，规则仅识别 cause。
    if (failed) throw new AggregateError([error, failed.reason], '本地服务启动和关闭失败。');
    store?.close();
    // 关闭失败时保留目录锁，避免尚存的 SQLite owner 与重试启动共用资料库。
    release();
    throw error;
  }
}
