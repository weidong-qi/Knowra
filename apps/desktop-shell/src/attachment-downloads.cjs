const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const LIMIT = 6 * 1024 * 1024;

function createAttachmentDownloads({ getWindow, getOrigin, dataDirectory, dialog, shell }) {
  const saved = new Map();
  function trusted(event) {
    const window = getWindow();
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame)
      throw new Error('无效的附件请求。');
    return window;
  }
  return {
    async download(event, id) {
      const window = trusted(event);
      if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(id)) throw new Error('附件 ID 无效。');
      // 只使用当前 APP 会话和固定本地路径；不接受 URL、凭据或本机文件路径。
      const origin = getOrigin();
      const url = new URL(`/api/storage/attachments/${encodeURIComponent(id)}/content`, origin).href;
      const datasetId = await window.webContents.executeJavaScript('globalThis.knowraRuntime?.datasetId');
      if (typeof datasetId !== 'string' || !datasetId) throw new Error('本机资料标识不可用，请重新打开应用。');
      const response = await window.webContents.session.fetch(url, {
        headers: { 'X-Knowra-Dataset': datasetId },
        credentials: 'include',
        redirect: 'error',
        signal: AbortSignal.timeout(30000)
      });
      if (!response.ok) throw new Error('附件不可用，请先核验或恢复原文件。');
      const limit =
        response.headers.get('content-type')?.split(';')[0] === 'application/pdf' ? 50 * 1024 * 1024 : LIMIT;
      const declared = Number(response.headers.get('content-length'));
      if (declared > limit) {
        await response.body?.cancel();
        throw new Error('附件超过下载支持的大小。');
      }
      const disposition = response.headers.get('content-disposition') || '';
      let name = '附件.bin';
      try {
        name = decodeURIComponent(disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1] || '') || name;
      } catch {
        /* 使用安全默认名称。 */
      }
      name = path.basename(name.replace(/[\\/\r\n\0]/g, '_'));
      const choice = await dialog.showSaveDialog(window, { title: '保存附件', defaultPath: name });
      if (choice.canceled || !choice.filePath) {
        await response.body?.cancel();
        return null;
      }
      const destination = path.resolve(choice.filePath);
      const canonicalDestination = path.join(fs.realpathSync(path.dirname(destination)), path.basename(destination));
      const managedDirectory = fs.realpathSync(dataDirectory);
      const relative = path.relative(managedDirectory, canonicalDestination);
      if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)))
        throw new Error('不能覆盖 Knowra 本机资料目录。');
      if (
        fs.existsSync(destination) &&
        (!fs.lstatSync(destination).isFile() || fs.lstatSync(destination).isSymbolicLink())
      )
        throw new Error('所选位置不是普通文件。');
      const staged = `${destination}.knowra-${randomUUID()}.tmp`;
      try {
        const fd = fs.openSync(staged, 'wx', 0o600);
        try {
          const reader = response.body.getReader();
          let size = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > limit) {
              await reader.cancel();
              throw new Error('附件超过下载支持的大小。');
            }
            fs.writeSync(fd, value);
          }
          if (declared && size !== declared) throw new Error('附件传输不完整。');
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
        fs.renameSync(staged, destination);
      } finally {
        fs.rmSync(staged, { force: true });
      }
      const token = randomUUID();
      saved.set(token, destination);
      if (saved.size > 32) saved.delete(saved.keys().next().value);
      return token;
    },
    async open(event, token) {
      trusted(event);
      const file = saved.get(token);
      if (!file || !fs.existsSync(file) || !fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink())
        throw new Error('已保存文件不可用，请重新下载。');
      const error = await shell.openPath(file);
      if (error) throw new Error('无法打开已保存文件，请在 Finder 中打开。');
    }
  };
}
module.exports = { createAttachmentDownloads };
