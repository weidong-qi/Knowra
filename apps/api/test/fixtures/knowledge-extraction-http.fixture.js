import { createServer } from '../../src/server.ts';
import { setTimeout as delay } from 'node:timers/promises';

/** 真实回环 HTTP；宿主自行装配临时库/Mock，关闭时必须先停接入再等 worker。 */
export async function startExtractionHttpServer(app) {
  const server = createServer({ appContext: app, logger: { warn() {}, error() {} } });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { origin: `http://127.0.0.1:${server.address().port}`, server,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

/** 仅测试显式等待：只轮询能力，恢复失败立即报错；不重试业务请求或改变默认启动语义。 */
export async function waitForExtractionReady(origin, { timeoutMs = 10_000 } = {}) {
  const signal = AbortSignal.timeout(timeoutMs);
  let last = null, interval = 10;
  try {
    while (true) {
      const response = await fetch(`${origin}/api/ai/capabilities`, { signal });
      last = { status: response.status, body: await response.json() };
      const capability = last.body?.data?.knowledgeExtraction;
      if (last.status === 200 && capability?.available === true && capability.canReadJobs === true && capability.canStart === true) {
        return capability;
      }
      if (last.status !== 200 || capability?.reasonCode !== 'KNOWLEDGE_EXTRACTION_RECOVERING') {
        throw new Error('提炼测试宿主未就绪');
      }
      // 仅仍在恢复时退避后再查询，整个查询和退避共用截止时间。
      await delay(interval, undefined, { signal }); interval = Math.min(interval * 2, 100);
    }
  } catch (cause) {
    const code = signal.aborted ? 'EXTRACTION_HTTP_READY_TIMEOUT' : 'EXTRACTION_HTTP_NOT_READY';
    throw Object.assign(new Error(`${code}: ${JSON.stringify(last)}`, { cause }), { code });
  }
}

export async function callExtractionHttp(origin, route, body, { header = '1', headers = {}, method } = {}) {
  const response = await fetch(`${origin}/api/ai${route}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Knowra-AI-Job': header }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  return { status: response.status, data: await response.json(), cacheControl: response.headers.get('cache-control') };
}
