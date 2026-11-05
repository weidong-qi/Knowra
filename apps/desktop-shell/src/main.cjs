const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  shell,
  utilityProcess,
  safeStorage,
  Notification
} = require('electron');
const path = require('node:path');
const { createReleaseUpdates } = require('./release-updates.cjs');
const { createAttachmentDownloads } = require('./attachment-downloads.cjs');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { createDraftStore } = require('./draft-store.cjs');
const { createModelSettings, safeModelSettingsMessage } = require('./model-settings.cjs');
const { createSystemNotifications } = require('./system-notifications.cjs');
const { handleAiCredentialRequest } = require('./ai-credential-handler.cjs');
const { createBackupRpc, createBackupTransfers } = require('./backup-transfers.cjs');

app.setName('知境·Knowra');
const smokeDirectory = process.env.KNOWRA_DESKTOP_SMOKE_DIR;
if (smokeDirectory) app.setPath('userData', path.join(smokeDirectory, 'shell'));
else app.setPath('userData', path.join(app.getPath('appData'), 'Knowra', 'shell'));
let window,
  child,
  origin,
  rendererReady = false,
  shuttingDown = false,
  finished = false;
let pendingClose;
let pdfHistoryActive = false;
const dataDirectory = smokeDirectory
  ? path.join(smokeDirectory, 'offline')
  : path.join(app.getPath('appData'), 'Knowra', 'offline');
const drafts = createDraftStore(dataDirectory);
const modelSettings = createModelSettings({
  filePath: path.join(app.getPath('userData'), 'ai-provider.json'),
  safeStorage
});
const root = __dirname;
const logDirectory = path.join(app.getPath('userData'), 'logs');
function log(message) {
  try {
    fs.mkdirSync(logDirectory, { recursive: true });
    const file = path.join(logDirectory, 'desktop.log');
    if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024) fs.renameSync(file, `${file}.previous`);
    fs.appendFileSync(file, `${new Date().toISOString()} ${message}\n`);
  } catch {
    /* 日志磁盘失败不能阻止退出错误提示与草稿保护。 */
  }
}
function focus() {
  if (window && !window.isDestroyed()) {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }
}
function external(url) {
  try {
    if (['https:', 'http:', 'mailto:'].includes(new URL(url).protocol)) void shell.openExternal(url);
  } catch {
    /* 忽略非法链接。 */
  }
}
function prepareRenderer(mode = 'save') {
  if (!rendererReady || !window || window.isDestroyed()) return Promise.reject(new Error('页面尚未就绪，请稍后退出。'));
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => {
      pendingClose = null;
      reject(new Error('保存等待超时，窗口已保留，请稍后重试。'));
    }, 20000);
    pendingClose = {
      id,
      resolve: () => {
        clearTimeout(timer);
        pendingClose = null;
        resolve();
      },
      reject: message => {
        clearTimeout(timer);
        pendingClose = null;
        reject(new Error(message));
      }
    };
    window.webContents.send('prepare-close', id, mode);
  });
}
async function quitSafely(mode = 'save') {
  if (shuttingDown || finished) return;
  shuttingDown = true;
  try {
    await prepareRenderer(mode);
    if (child) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          child.removeListener('exit', onExit);
          reject(new Error('本地服务仍在结束请求，请稍后重试退出。'));
        }, 15000);
        const onExit = () => {
          clearTimeout(timer);
          resolve();
        };
        child.once('exit', onExit);
        child.postMessage('shutdown');
      });
    }
    finished = true;
    window?.destroy();
    app.quit();
  } catch (error) {
    shuttingDown = false;
    window?.webContents.send('cancel-close');
    log(`退出暂停：${error.message}`);
    focus();
    const answer = await dialog.showMessageBox(window, {
      type: 'warning',
      title: '尚未退出',
      message: '保存未完成',
      detail: `${error.message}\n可重试保存，或将未保存正文保留为本机恢复草稿后退出。`,
      buttons: ['返回应用', '重试保存', '保留恢复草稿并退出'],
      defaultId: 0,
      cancelId: 0
    });
    if (answer.response > 0) void quitSafely(answer.response === 2 ? 'recovery' : 'save');
  }
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', focus);
  app.on('activate', focus);
  app.on('before-quit', event => {
    if (!finished) {
      event.preventDefault();
      void quitSafely();
    }
  });
  const attachmentDownloads = createAttachmentDownloads({
    getWindow: () => window,
    getOrigin: () => origin,
    dataDirectory,
    dialog,
    shell
  });
  const backupRpc = createBackupRpc({ getChild: () => child });
  const backupTransfers = createBackupTransfers({
    getWindow: () => window,
    getOrigin: () => origin,
    isClosing: () => shuttingDown || finished,
    rpc: backupRpc,
    dialog
  });
  ipcMain.handle('backup-transfer', (event, input) => backupTransfers.transfer(event, input));
  ipcMain.handle('attachment-download', (event, id) => attachmentDownloads.download(event, id));
  ipcMain.handle('attachment-open-saved', (event, token) => attachmentDownloads.open(event, token));
  const trusted = event => event.sender === window?.webContents && event.senderFrame === window.webContents.mainFrame;
  ipcMain.on('pdf-history-focus', (event, active) => {
    if (trusted(event)) pdfHistoryActive = active === true;
  });
  ipcMain.on('read-recovery-drafts', event => {
    try {
      if (!trusted(event)) throw new Error('无效的草稿请求');
      event.returnValue = { drafts: drafts.read() };
    } catch (error) {
      event.returnValue = { error: error.message };
    }
  });
  ipcMain.handle('write-recovery-draft', (event, key, draft) => {
    if (!trusted(event)) throw new Error('无效的草稿请求');
    drafts.write(key, draft);
  });
  const systemNotifications = createSystemNotifications({ Notification });
  ipcMain.handle('system-notify', (event, input) => {
    if (!trusted(event)) throw new Error('无效的通知请求。');
    return systemNotifications.notify(input);
  });
  ipcMain.handle('model-settings', async (event, action, value) => {
    if (!trusted(event)) throw new Error('无效的模型设置请求。');
    try {
      if (action === 'status') return modelSettings.status();
      if (action === 'save') return modelSettings.save(value);
      if (action === 'remove') return modelSettings.remove();
      if (action === 'check') return await modelSettings.check();
    } catch (error) {
      // IPC 错误只返回经过控制的中文消息，不包含请求体或供应商响应。
      throw new Error(safeModelSettingsMessage(error));
    }
    throw new Error('未知的模型设置操作。');
  });
  ipcMain.on('renderer-ready', event => {
    if (event.sender === window?.webContents && event.senderFrame === window.webContents.mainFrame)
      rendererReady = true;
  });
  ipcMain.on('close-result', (event, result) => {
    if (
      event.sender !== window?.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      result?.id !== pendingClose?.id
    )
      return;
    if (result.ok === true) pendingClose.resolve();
    else pendingClose.reject(String(result.message || '保存未完成').slice(0, 500));
  });
  app
    .whenReady()
    .then(async () => {
      const buildInfo = JSON.parse(fs.readFileSync(path.join(root, 'build-info.json'), 'utf8'));
      app.setAboutPanelOptions({
        applicationName: '知境·Knowra',
        applicationVersion: buildInfo.version,
        version: `${buildInfo.commit || 'unknown'} · ${buildInfo.state}`,
        copyright: `构建时间（UTC）：${buildInfo.builtAt}\n标识来源：${buildInfo.source}`
      });
      const releaseUpdates = createReleaseUpdates({
        dialog,
        shell,
        getWindow: () => window,
        buildInfo,
        isClosing: () => shuttingDown || finished
      });
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: '知境·Knowra',
            submenu: [
              { role: 'about', label: '关于知境·Knowra' },
              {
                label: '检查更新…',
                click: () => {
                  void releaseUpdates.check();
                }
              },
              { type: 'separator' },
              {
                label: '打开本机资料目录',
                click: () => {
                  void shell.openPath(dataDirectory);
                }
              },
              { type: 'separator' },
              { role: 'hide', label: '隐藏知境·Knowra' },
              { role: 'hideOthers', label: '隐藏其他应用' },
              { role: 'unhide', label: '显示全部' },
              { type: 'separator' },
              {
                label: '退出知境·Knowra',
                accelerator: 'Command+Q',
                click: () => {
                  void quitSafely();
                }
              }
            ]
          },
          {
            label: '编辑',
            submenu: [
              { role: 'undo', label: '撤销' },
              { role: 'redo', label: '重做' },
              { type: 'separator' },
              { role: 'cut', label: '剪切' },
              { role: 'copy', label: '复制' },
              { role: 'paste', label: '粘贴' },
              { role: 'selectAll', label: '全选' }
            ]
          },
          {
            label: '窗口',
            submenu: [
              { role: 'minimize', label: '最小化' },
              { role: 'zoom', label: '缩放' },
              { role: 'togglefullscreen', label: '全屏' },
              { type: 'separator' },
              {
                label: '关闭并保存',
                accelerator: 'Command+W',
                click: () => {
                  void quitSafely();
                }
              }
            ]
          }
        ])
      );
      child = utilityProcess.fork(path.join(root, 'runtime.mjs'), [dataDirectory, path.join(root, 'web')], {
        serviceName: 'Knowra 本地资料服务',
        stdio: 'pipe'
      });
      child.on('message', message => {
        if (
          message?.type === 'shutdown-stage' &&
          ['mcp', 'http', 'sync', 'ai', 'store', 'released'].includes(message.stage)
        ) {
          log(`本地服务关闭阶段：${message.stage}`);
        }
        handleAiCredentialRequest(message, { modelSettings, postMessage: reply => child?.postMessage(reply) });
        backupRpc.onMessage(message);
      });
      // 不记录启动 URL 或同步凭据；原始服务输出仅在内存排空。
      child.stdout?.on('data', () => {});
      child.stderr?.on('data', () => {});
      child.on('exit', code => {
        backupRpc.close();
        child = null;
        if (!shuttingDown && !finished) {
          log(`本地服务退出：${code}`);
          dialog.showErrorBox(
            '本地服务已停止',
            '本机已保存的数据仍在资料目录中。页面已保留，请先复制或导出尚未保存的正文，再重新打开应用。'
          );
          if (!window) {
            finished = true;
            app.quit();
          }
        }
      });
      const ready = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('本地服务启动超时')), 30000);
        child.on('message', message => {
          if (message.type === 'diagnostic') log(JSON.stringify({ code: message.code, frames: message.frames }));
          if (message.type === 'ready') {
            clearTimeout(timer);
            resolve(message);
          }
          if (message.type === 'error') {
            clearTimeout(timer);
            reject(new Error(message.message));
          }
        });
      });
      origin = ready.origin;
      window = new BrowserWindow({
        width: 1380,
        height: 920,
        minWidth: 960,
        minHeight: 640,
        show: false,
        title: '知境·Knowra',
        titleBarStyle: 'hiddenInset',
        titleBarOverlay: true,
        backgroundColor: '#f8f7f3',
        webPreferences: {
          preload: path.join(root, 'preload.cjs'),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          spellcheck: false
        }
      });
      window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
      window.webContents.session.setPermissionCheckHandler(() => false);
      // 原生编辑菜单会截走 Cmd+Z；仅 PDF 非输入区域改由标注历史处理，文本框仍使用原生撤销。
      window.webContents.on('before-input-event', (event, input) => {
        if (!pdfHistoryActive || input.type !== 'keyDown' || input.alt || !(input.meta || input.control)) return;
        const key = input.key.toLowerCase();
        if (key !== 'z' && !(input.control && key === 'y')) return;
        event.preventDefault();
        window.webContents.send('pdf-history-command', input.shift || key === 'y');
      });
      window.webContents.setWindowOpenHandler(({ url }) => {
        external(url);
        return { action: 'deny' };
      });
      window.webContents.on('will-navigate', (event, url) => {
        if (new URL(url).origin !== origin) {
          event.preventDefault();
          external(url);
        }
      });
      window.webContents.on('will-attach-webview', event => event.preventDefault());
      window.webContents.on('render-process-gone', () => {
        rendererReady = false;
        log('页面进程异常退出');
        dialog.showErrorBox('页面已停止', '请重新打开应用；本机已保存内容仍保留。');
        finished = true;
        child?.kill();
        window.destroy();
        app.quit();
      });
      window.on('close', event => {
        if (!finished) {
          event.preventDefault();
          void quitSafely();
        }
      });
      await window.loadURL(ready.launchUrl);
      window.show();
      log(`启动完成，Electron ${process.versions.electron}，Node ${process.versions.node}`);
      if (smokeDirectory)
        fs.writeFileSync(
          path.join(smokeDirectory, 'ready.json'),
          JSON.stringify({ origin, node: process.versions.node, electron: process.versions.electron, buildInfo })
        );
    })
    .catch(error => {
      log(`启动失败：${error.message}`);
      dialog.showErrorBox('无法启动知境·Knowra', `${error.message}\n\n资料目录：${dataDirectory}`);
      finished = true;
      child?.kill();
      window?.destroy();
      app.quit();
    });
}
