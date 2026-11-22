const fs = require('node:fs');
const files = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

// 与 knowra-archive-v1 的非 ZIP64、不带尾部注释格式一致。
const LIMIT = 0xffff0000;
const ZIP_END_LENGTH = 22;

async function assertAvailable(file) {
  try {
    await files.lstat(file);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  throw new Error('所选位置已有文件，请换一个名称；原文件未改动。');
}

async function directoryIdentity(file) {
  const info = await files.lstat(file);
  if (!info.isDirectory()) throw new Error('所选目录已变化，未保存。');
  return `${info.dev}:${info.ino}`;
}

function createArchiveDownload({ getWindow, getOrigin, isClosing, getDatasetStatus, dataDirectory, dialog }) {
  let busy = false;
  function trusted(event) {
    const window = getWindow();
    if (
      !window ||
      window.isDestroyed() ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      new URL(window.webContents.getURL()).origin !== getOrigin()
    )
      throw new Error('无效的 ZIP 导出请求。');
    if (isClosing()) throw new Error('应用正在关闭，请重新打开后导出。');
    return window;
  }
  return async function download(event, datasetId) {
    const window = trusted(event);
    if (typeof datasetId !== 'string' || !/^[A-Za-z0-9-]{1,128}$/.test(datasetId))
      throw new Error('本机资料标识不可用，请重新打开应用。');
    if (busy) throw new Error('已有 ZIP 导出正在进行。');
    busy = true;
    let staged;
    try {
      const selection = await dialog.showSaveDialog(window, {
        title: '导出可移植资料 ZIP',
        defaultPath: 'Knowra-资料库.zip',
        filters: [{ name: 'ZIP 资料包', extensions: ['zip'] }]
      });
      if (selection.canceled || !selection.filePath) return null;
      trusted(event);
      const parent = await files.realpath(path.dirname(selection.filePath));
      const identity = await directoryIdentity(parent);
      const destination = path.join(parent, path.basename(selection.filePath));
      const managed = await files.realpath(dataDirectory);
      const relative = path.relative(managed, destination);
      if (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
        throw new Error('不能导出到 Knowra 本机资料目录。');
      await assertAvailable(destination);
      const url = new URL('/api/storage/archive', getOrigin());
      const signal = AbortSignal.timeout(10 * 60 * 1000);
      const response = await window.webContents.session.fetch(url.href, {
        method: 'GET',
        headers: { 'X-Knowra-Dataset': datasetId },
        credentials: 'include',
        redirect: 'error',
        signal
      });
      if (!response.ok || response.headers.get('content-type')?.split(';')[0] !== 'application/zip' || !response.body) {
        await response.body?.cancel();
        if (response.status === 409) throw new Error('资料库已变化或暂不能导出，请重新加载后重试。');
        throw new Error('无法生成可移植 ZIP。请检查本机资料和附件；较大的资料库请使用完整目录备份。');
      }
      if ((await directoryIdentity(parent)) !== identity) {
        await response.body.cancel();
        throw new Error('所选目录已变化，未保存。');
      }
      staged = path.join(parent, `.knowra-archive-${randomUUID()}.tmp`);
      let bytes = 0;
      let tail = Buffer.alloc(0);
      const validate = new Transform({
        transform(chunk, _encoding, done) {
          bytes += chunk.byteLength;
          if (bytes > LIMIT) return done(new Error('ZIP 超过大小限制，请使用完整目录备份。'));
          tail =
            chunk.byteLength >= ZIP_END_LENGTH
              ? Buffer.from(chunk.subarray(-ZIP_END_LENGTH))
              : Buffer.concat([tail, chunk]).subarray(-ZIP_END_LENGTH);
          done(null, chunk);
        },
        flush(done) {
          if (
            tail.length !== ZIP_END_LENGTH ||
            tail.readUInt32LE(0) !== 0x06054b50 ||
            tail.readUInt16LE(20) !== 0 ||
            tail.readUInt32LE(12) + tail.readUInt32LE(16) !== bytes - ZIP_END_LENGTH
          )
            return done(new Error('资料 ZIP 传输不完整，未保存。'));
          done();
        }
      });
      await pipeline(
        Readable.fromWeb(response.body),
        validate,
        fs.createWriteStream(staged, { flags: 'wx', mode: 0o600 }),
        { signal }
      );
      const file = await files.open(staged, 'r+');
      try {
        await file.sync();
      } finally {
        await file.close();
      }
      trusted(event);
      await getDatasetStatus(datasetId);
      trusted(event);
      if ((await directoryIdentity(parent)) !== identity) throw new Error('所选目录已变化，未保存。');
      try {
        // 同目录原子发布，若此时出现同名文件或链接，绝不覆盖。
        await files.link(staged, destination);
      } catch (error) {
        if (error.code === 'EEXIST') throw new Error('所选位置已有文件，请换一个名称；原文件未改动。', { cause: error });
        if (['ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'EXDEV'].includes(error.code))
          throw new Error('所选卷不支持安全保存，请先导出到本机其他位置再复制。', { cause: error });
        throw error;
      }
      return path.basename(destination);
    } finally {
      if (staged) {
        try {
          await files.rm(staged, { force: true });
        } finally {
          busy = false;
        }
      } else busy = false;
    }
  };
}

module.exports = { createArchiveDownload };
