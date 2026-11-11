import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createFileDataStore } from '../../../api/src/infrastructure/file-data-store.ts';
import { createAppContext } from '../../../api/src/app.factory.ts';
import { createServer } from '../../../api/src/server.ts';
import {
  extractionTaskGateway,
  quietTaskLogger
} from '../../../api/test/fixtures/knowledge-extraction-task.fixture.js';
import { createV4WebServer } from '../../../web/server/app.mjs';

const markdown =
  '# 合成提炼页面验收\n\n数据增强通过变换样本增加训练变化。\n\nMixup 对输入及标签进行线性插值。\n\n![合成不可读图片](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7)';
const listen = async server => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
};
const closeServer = server =>
  server?.listening
    ? new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
    : Promise.resolve();

/** 只存在于测试中的 Web 宿主。无开关路由、用户配置或桌面运行时装配。 */
export async function startExtractionWeb({ enabled = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-extraction-web-'));
  const file = path.join(root, 'data.json'),
    dataStore = createFileDataStore(file);
  const steps = [],
    held = new Map();
  let time = Date.now(),
    app,
    api,
    web;
  const mock = extractionTaskGateway(async (_request, response, callNumber) => {
    const step = steps.shift() ?? 'success';
    if (step === 'fail')
      throw Object.assign(new Error('仅测试的供应商原始错误，不应进入页面'), { code: 'AI_MOCK_FAILED' });
    if (step === 'hold') await new Promise(resolve => held.set(callNumber, resolve));
    if (step === 'empty') {
      const content = JSON.parse(response.choices[0].message.content);
      content.candidates = [];
      response.choices[0].message.content = JSON.stringify(content);
    }
    return response;
  });
  async function close() {
    await Promise.all([closeServer(web), closeServer(api)]);
    await app?.knowledgeExtractionTasks?.close();
    for (const release of held.values()) release();
    held.clear();
    await dataStore.close?.();
    fs.rmSync(root, { recursive: true, force: true });
  }
  try {
    app = createAppContext({
      dataStore,
      ownerId: 'demo',
      storageRootDir: root,
      uploadsDir: path.join(root, 'uploads'),
      ...(enabled
        ? { knowledgeExtractionMock: { gateway: mock.gateway, clock: () => new Date(time), logger: quietTaskLogger } }
        : {})
    });
    const space = await app.http.knowledge.createDefaultKnowledgeSpace();
    const note = await app.http.knowledge.createNote({
      title: '合成提炼页面验收',
      spaceId: space.id,
      rawMarkdown: markdown
    });
    const otherNote = await app.http.knowledge.createNote({
      title: '合成切换笔记',
      spaceId: space.id,
      rawMarkdown: markdown.replace('页面验收', '切换验证')
    });
    api = createServer({ appContext: app });
    const apiOrigin = await listen(api);
    const distRoot = fileURLToPath(new URL('../../../web/dist/', import.meta.url));
    web = createV4WebServer({ distRoot, getApiOrigin: () => apiOrigin });
    const origin = await listen(web);
    return {
      root,
      file,
      app,
      dataStore,
      space,
      note,
      otherNote,
      origin,
      apiOrigin,
      close,
      calls: mock.calls,
      next(step) {
        if (!['success', 'fail', 'hold', 'empty'].includes(step)) throw new Error('未知合成步骤');
        steps.push(step);
      },
      release(callNumber) {
        const release = held.get(callNumber);
        if (!release) throw new Error('没有等待中的合成响应');
        held.delete(callNumber);
        release();
      },
      advance(ms) {
        time += ms;
      },
      inspect() {
        return {
          jobs: dataStore.aiRepository.list('aiJob').map(({ jobId, status, phase }) => ({ jobId, status, phase })),
          candidates: dataStore.state.knowledgeItems.map(({ id, reviewStatus }) => ({ id, reviewStatus })),
          providerCalls: mock.calls.length
        };
      }
    };
  } catch (error) {
    await close();
    throw error;
  }
}
