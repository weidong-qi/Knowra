import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { capturePdfNavigation, navigateToPackagedPdf } from './pdf-navigation.mjs';

function syntheticPage() {
  const page = new EventEmitter();
  page.currentUrl = 'http://127.0.0.1:43210/';
  page.calls = [];
  page.url = () => page.currentUrl;
  page.mainFrame = () => page;
  page.reload = async options => page.calls.push(['reload', options]);
  page.goto = async (url, options) => {
    page.calls.push(['goto', options]);
    page.currentUrl = url;
    page.emit('framenavigated', page);
  };
  page.waitForURL = async (matches, options) => {
    page.calls.push(['waitForURL', options]);
    assert(matches(new URL(page.url())), '必须等待精确目标 URL');
    assert(!matches(new URL('http://127.0.0.1:43210/')));
    assert(!matches(new URL('http://127.0.0.1:43210/#/materials/notes/other')));
    assert(!matches(new URL('http://127.0.0.1:54321/#/materials/notes/target')));
  };
  return page;
}

test('API 导入刷新先于唯一一次 hash 导航，不再 goto 后立即 reload', async () => {
  const page = syntheticPage();
  const diagnostics = [];
  const url = await navigateToPackagedPdf(page, 'target', {
    refreshWorkspace: true,
    diagnostic: event => diagnostics.push(event)
  });
  assert.equal(url, 'http://127.0.0.1:43210/#/materials/notes/target');
  assert.deepEqual(
    page.calls.map(([name]) => name),
    ['reload', 'goto', 'waitForURL']
  );
  assert.deepEqual(
    diagnostics.map(({ phase }) => phase),
    ['before-navigation', 'workspace-refreshed', 'goto-completed', 'route-ready']
  );
});

test('重启后复用已加载的持久化工作区，导航一次且不 reload', async () => {
  const page = syntheticPage();
  await navigateToPackagedPdf(page, 'target');
  assert.deepEqual(
    page.calls.map(([name]) => name),
    ['goto', 'waitForURL']
  );
});

test('导航和可选刷新共享原 30 秒预算，不加超时', async t => {
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const page = syntheticPage();
  const reload = page.reload;
  page.reload = async options => {
    await reload(options);
    now += 7000;
  };
  const goto = page.goto;
  page.goto = async (...args) => {
    await goto(...args);
    now += 5000;
  };
  await navigateToPackagedPdf(page, 'target', { refreshWorkspace: true });
  assert.deepEqual(
    page.calls.map(([, { timeout }]) => timeout),
    [30000, 23000, 18000]
  );
});

for (const observed of ['http://127.0.0.1:43210/', 'http://127.0.0.1:43210/#/materials/notes/other']) {
  test(`目标路由丢失必须失败，不自动重新导航：${new URL(observed).hash || '首页'}`, async () => {
    const page = syntheticPage();
    const goto = page.goto;
    page.goto = async (...args) => {
      await goto(...args);
      page.currentUrl = observed;
    };
    await assert.rejects(navigateToPackagedPdf(page, 'target'), /必须等待精确目标 URL/);
    assert.deepEqual(
      page.calls.map(([name]) => name),
      ['goto', 'waitForURL']
    );
  });
}

test('等待路由后发生跳转也必须拒绝，保留导航异常不吞掉', async () => {
  const page = syntheticPage();
  page.waitForURL = async () => {
    page.currentUrl = 'http://127.0.0.1:43210/';
  };
  await assert.rejects(navigateToPackagedPdf(page, 'target'), /PDF 导航必须停留在指定笔记/);
  const failure = new Error('synthetic goto failure');
  page.goto = async () => {
    throw failure;
  };
  await assert.rejects(navigateToPackagedPdf(page, 'target'), error => error === failure);
});

test('导航诊断保留阶段及主框架/页面错误/失败请求，忽略子框架和普通日志', async () => {
  const page = syntheticPage();
  const events = [];
  const capture = capturePdfNavigation(page, 'after-restart', events);
  await navigateToPackagedPdf(page, 'target', { diagnostic: capture.checkpoint });
  page.emit('framenavigated', { url: () => 'http://127.0.0.1/child' });
  page.emit('domcontentloaded');
  page.emit('load');
  page.emit('console', { type: () => 'log', text: () => 'ignored' });
  page.emit('console', { type: () => 'error', text: () => 'synthetic renderer error' });
  page.emit('pageerror', new Error('synthetic page error'));
  page.emit('requestfailed', {
    url: () => 'http://127.0.0.1/api/synthetic',
    failure: () => ({ errorText: 'net::ERR_FAILED' })
  });
  assert(events.every(({ label }) => label === 'after-restart'));
  assert.deepEqual(
    events.map(event => event.phase || event.type),
    [
      'before-navigation',
      'main-frame-navigation',
      'goto-completed',
      'route-ready',
      'domcontentloaded',
      'load',
      'console-error',
      'page-error',
      'request-failed'
    ]
  );
  capture.dispose();
  assert.equal(page.eventNames().length, 0);
});

test('诊断有界且删除 URL 查询及启动凭据，不采集请求内容', () => {
  const page = syntheticPage();
  const events = [];
  const capture = capturePdfNavigation(page, 'initial-import', events, { limit: 2 });
  capture.checkpoint({ phase: 'discarded', url: page.url(), expectedUrl: page.url() });
  page.emit('requestfailed', {
    url: () => 'http://127.0.0.1/local-session/synthetic-secret?token=synthetic-query',
    failure: () => ({ errorText: 'net::ERR_FAILED' })
  });
  page.emit('console', {
    type: () => 'warning',
    text: () => 'request http://127.0.0.1/local-session/synthetic-secret?token=synthetic-query failed'
  });
  assert.equal(events.length, 2);
  const json = JSON.stringify(events);
  assert(!json.includes('discarded'));
  assert(!json.includes('synthetic-secret'));
  assert(!json.includes('synthetic-query'));
  assert(json.includes('/local-session/[redacted]'));
  capture.dispose();
});

test('诊断省略内嵌资源及文件 URL，所有 URL 和错误文本有长度上限', () => {
  const page = syntheticPage();
  const events = [];
  const capture = capturePdfNavigation(page, 'initial-import', events);
  for (const url of [
    'data:application/pdf;base64,synthetic-pdf-content',
    'blob:http://127.0.0.1/synthetic-blob',
    'file:///synthetic-private-path',
    'invalid-synthetic-content'
  ]) {
    page.emit('requestfailed', { url: () => url, failure: () => ({ errorText: 'net::ERR_FAILED' }) });
    page.emit('console', { type: () => 'error', text: () => `failed ${url}` });
  }
  page.emit('requestfailed', {
    url: () => `http://127.0.0.1/${'a'.repeat(5000)}`,
    failure: () => ({ errorText: 'b'.repeat(5000) })
  });
  const requests = events.filter(({ type }) => type === 'request-failed');
  assert.deepEqual(
    requests.slice(0, 4).map(({ url }) => url),
    ['data:[omitted]', 'blob:[omitted]', 'file:[omitted]', '[invalid-url]']
  );
  for (const { url, error } of requests) {
    assert(url.length <= 600);
    assert(error.length <= 1000);
  }
  const json = JSON.stringify(events);
  assert(!json.includes('synthetic-pdf-content'));
  assert(!json.includes('synthetic-blob'));
  assert(!json.includes('synthetic-private-path'));
  capture.dispose();
});
