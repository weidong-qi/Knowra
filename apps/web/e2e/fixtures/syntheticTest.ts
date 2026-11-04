import { test as base, expect } from '@playwright/test';

/** 合成回归只允许本地页面静态资源；各测试的 page.route 模拟优先于此兜底。 */
export const test = base.extend<{ syntheticNetwork: string[] }>({
  syntheticNetwork: [async ({ context, baseURL }, use, info) => {
    const blocked: string[] = [];
    const origin = new URL(baseURL ?? 'http://127.0.0.1:5173').origin;
    await context.routeWebSocket('**/*', socket => { blocked.push(`WEBSOCKET ${socket.url()}`); socket.close(); });
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === origin && !url.pathname.startsWith('/api/') && request.method() === 'GET') return route.continue();
      blocked.push(`${request.method()} ${url.origin}${url.pathname}`);
      await route.abort('blockedbyclient');
    });
    await use(blocked);
    await info.attach('synthetic-network', { body: JSON.stringify({ blocked }, null, 2), contentType: 'application/json' });
    expect(blocked, '未建模请求被阻断，不允许联系 API 或模型服务').toEqual([]);
  }, { auto: true }]
});
