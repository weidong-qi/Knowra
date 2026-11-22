import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import archive from '../src/archive-download.cjs';
import { SHELL_FILES } from '../scripts/shell-files.mjs';

// 合法的空 ZIP，原生层只验证 ZIP 完成并保留字节。具体 v1 清单由互操作测试覆盖。
const zip = Buffer.from('504b0506000000000000000000000000000000000000', 'hex');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-portable-zip-'));
  const managed = path.join(directory, 'offline');
  const destination = path.join(directory, 'output.zip');
  fs.mkdirSync(managed);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let selection = { filePath: destination };
  let reply = () => new Response(zip, { headers: { 'content-type': 'application/zip' } });
  let activeDataset = 'current-dataset';
  const statusChecks = [];
  let picks = 0;
  const calls = [];
  const origin = 'http://127.0.0.1:1245';
  const webContents = {
    getURL: () => origin,
    mainFrame: {},
    session: {
      async fetch(url, options) {
        calls.push({ url, options });
        return reply();
      }
    }
  };
  const window = { webContents, isDestroyed: () => false };
  const download = archive.createArchiveDownload({
    getWindow: () => window,
    getOrigin: () => origin,
    isClosing: () => false,
    async getDatasetStatus(datasetId) {
      statusChecks.push(datasetId);
      if (datasetId !== activeDataset) throw new Error('资料库已变化，请重新加载后操作备份。');
    },
    dataDirectory: managed,
    dialog: {
      async showSaveDialog(_window, options) {
        picks++;
        assert.deepEqual(options.filters[0].extensions, ['zip']);
        return selection;
      }
    }
  });
  const event = { sender: webContents, senderFrame: webContents.mainFrame };
  return {
    directory,
    managed,
    destination,
    origin,
    download,
    event,
    calls,
    statusChecks,
    picks: () => picks,
    select(value) {
      selection = value;
    },
    respond(value) {
      reply = value;
    },
    setDataset(value) {
      activeDataset = value;
    }
  };
}

test('Mac 打包包含原生 ZIP 下载；流式读取唯一当前资料 GET，字节未经修改', async t => {
  const f = fixture(t);
  assert(SHELL_FILES.includes('archive-download.cjs'));
  assert.equal(await f.download(f.event, 'current-dataset'), 'output.zip');
  assert.equal(f.calls.length, 1);
  const [{ url, options }] = f.calls;
  assert.equal(url, `${f.origin}/api/storage/archive`);
  assert.equal(options.method, 'GET');
  assert.equal(options.headers['X-Knowra-Dataset'], 'current-dataset');
  assert.equal(options.credentials, 'include');
  assert.equal(options.redirect, 'error');
  assert.deepEqual(f.statusChecks, ['current-dataset']);
  assert.deepEqual(fs.readFileSync(f.destination), zip);
  assert.deepEqual(fs.readdirSync(f.directory).sort(), ['offline', 'output.zip']);
});

test('拒绝非主 frame、任意 renderer 参数和经符号链接指向的本机资料路径；取消不发请求', async t => {
  const f = fixture(t);
  await assert.rejects(() => f.download({ ...f.event, senderFrame: {} }, 'current-dataset'), /无效/);
  await assert.rejects(() => f.download(f.event, { url: 'https://example.com', file: f.destination }), /资料标识/);
  assert.equal(f.picks(), 0);
  f.select({ canceled: true });
  assert.equal(await f.download(f.event, 'current-dataset'), null);
  const alias = path.join(f.directory, 'alias');
  fs.symlinkSync(f.managed, alias);
  f.select({ filePath: path.join(alias, 'bad.zip') });
  await assert.rejects(() => f.download(f.event, 'current-dataset'), /本机资料目录/);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(fs.readdirSync(f.managed), []);
});

test('旧资料、截断 ZIP、恢复切库及已有目标均不提交，不留下暂存文件', async t => {
  const f = fixture(t);
  fs.writeFileSync(f.destination, '已有副本');
  await assert.rejects(() => f.download(f.event, 'current-dataset'), /已有文件/);
  assert.equal(fs.readFileSync(f.destination, 'utf8'), '已有副本');
  assert.equal(f.calls.length, 0);
  fs.rmSync(f.destination);
  f.respond(() => new Response('{}', { status: 409, headers: { 'content-type': 'application/json' } }));
  await assert.rejects(() => f.download(f.event, 'old-dataset'), /重新加载/);
  f.respond(() => new Response(zip.subarray(0, -4), { headers: { 'content-type': 'application/zip' } }));
  await assert.rejects(() => f.download(f.event, 'current-dataset'), /传输不完整/);
  f.respond(() => {
    f.setDataset('restored-dataset');
    return new Response(zip, { headers: { 'content-type': 'application/zip' } });
  });
  await assert.rejects(() => f.download(f.event, 'current-dataset'), /资料库已变化/);
  assert.deepEqual(fs.readdirSync(f.directory), ['offline']);
  f.setDataset('current-dataset');
  f.respond(() => {
    fs.writeFileSync(f.destination, '外部新内容');
    return new Response(zip, { headers: { 'content-type': 'application/zip' } });
  });
  await assert.rejects(() => f.download(f.event, 'current-dataset'), /已有文件/);
  assert.equal(fs.readFileSync(f.destination, 'utf8'), '外部新内容');
  assert.deepEqual(fs.readdirSync(f.directory).sort(), ['offline', 'output.zip']);
});
