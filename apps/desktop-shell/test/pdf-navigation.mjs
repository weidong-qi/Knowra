import assert from 'node:assert/strict';

// API 导入后先刷新工作区，再做一次 hash 导航；不要紧接同文档 goto 发起 reload。
// 重启已经重新加载持久化工作区，不需要再次刷新。导航失败不重试或改回目标路由。
export async function navigateToPackagedPdf(
  page,
  noteId,
  { refreshWorkspace = false, diagnostic = () => {}, timeoutMs = 30000 } = {}
) {
  const expectedUrl = new URL(`/#/materials/notes/${noteId}`, page.url()).href;
  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(1, deadline - Date.now());
  const record = phase => diagnostic({ phase, url: page.url(), expectedUrl });
  record('before-navigation');
  if (refreshWorkspace) {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: remaining() });
    record('workspace-refreshed');
  }
  await page.goto(expectedUrl, { waitUntil: 'domcontentloaded', timeout: remaining() });
  record('goto-completed');
  await page.waitForURL(url => url.href === expectedUrl, { timeout: remaining() });
  assert.equal(page.url(), expectedUrl, 'PDF 导航必须停留在指定笔记，不能接受首页或其他笔记。');
  record('route-ready');
  return expectedUrl;
}

// 仅由隔离合成 PDF 用例使用。不记录请求头、响应体、cookie 或带查询参数的 URL。
export function capturePdfNavigation(page, label, events, { limit = 160 } = {}) {
  const started = Date.now();
  const safeUrl = value => {
    try {
      const url = new URL(value);
      if (url.pathname.startsWith('/local-session/')) url.pathname = '/local-session/[redacted]';
      return `${url.origin}${url.pathname}${url.hash}`;
    } catch {
      return String(value);
    }
  };
  const safeText = value =>
    String(value)
      .replace(/https?:\/\/[^\s)"']+/g, safeUrl)
      .slice(0, 1000);
  const record = event => {
    if (events.length >= limit) events.shift();
    events.push({ label, elapsedMs: Date.now() - started, ...event });
  };
  const listeners = {
    framenavigated: frame => {
      if (frame === page.mainFrame()) record({ type: 'main-frame-navigation', url: safeUrl(frame.url()) });
    },
    domcontentloaded: () => record({ type: 'domcontentloaded', url: safeUrl(page.url()) }),
    load: () => record({ type: 'load', url: safeUrl(page.url()) }),
    console: message => {
      if (['warning', 'error'].includes(message.type()))
        record({ type: `console-${message.type()}`, message: safeText(message.text()) });
    },
    pageerror: error => record({ type: 'page-error', message: safeText(error.message) }),
    requestfailed: request =>
      record({ type: 'request-failed', url: safeUrl(request.url()), error: request.failure()?.errorText })
  };
  for (const [event, listener] of Object.entries(listeners)) page.on(event, listener);
  return {
    checkpoint: event => record({ ...event, url: safeUrl(event.url), expectedUrl: safeUrl(event.expectedUrl) }),
    dispose: () => {
      for (const [event, listener] of Object.entries(listeners)) page.off(event, listener);
    }
  };
}
