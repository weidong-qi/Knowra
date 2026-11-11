import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createServer } from '../src/server.ts';
import { createAiFeatureSettings } from '../src/modules/ai/feature-settings.ts';
import { createModelSettingsService } from '../src/modules/ai/model-settings.ts';
import { createPersistentAppContext } from '../src/app.factory.ts';

const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-ai-features-'));

export const aiFeatureSettingsTests = [
  {
    name: 'AI 功能开关 peek：同步读取最近值；从未读取时按关闭处理，写入成功后立即生效，写入失败不改变',
    async run() {
      const directory = temporary(),
        filePath = path.join(directory, 'ai-features.json');
      fs.writeFileSync(filePath, '{"knowledgeProposals":true}', { mode: 0o600 });
      const settings = createAiFeatureSettings({ filePath });
      assert.deepEqual(settings.peek(), { knowledgeProposals: false }, '尚未读取过：fail closed，即使文件里是开启');
      assert.deepEqual(await settings.get(), { knowledgeProposals: true });
      assert.deepEqual(settings.peek(), { knowledgeProposals: true });
      await settings.set({ knowledgeProposals: false });
      assert.deepEqual(settings.peek(), { knowledgeProposals: false }, '写入完成即生效，不需要再读文件');
      {
        const copy = settings.peek();
        copy.knowledgeProposals = true;
        assert.deepEqual(settings.peek(), { knowledgeProposals: false }, '返回的是副本');
      }
      await assert.rejects(settings.set({ knowledgeProposals: 'yes' }), { code: 'AI_FEATURES_INVALID' });
      assert.deepEqual(settings.peek(), { knowledgeProposals: false });
    }
  },
  {
    name: 'AI 功能开关 peek：较早开始、延迟返回的读取不能覆盖已完成写入后的缓存',
    async run() {
      const directory = temporary(),
        filePath = path.join(directory, 'ai-features.json');
      fs.writeFileSync(filePath, '{"knowledgeProposals":true}', { mode: 0o600 });
      const settings = createAiFeatureSettings({ filePath });
      const real = fsp.readFile;
      let delayed = false;
      fsp.readFile = async (...args) => {
        const data = await real(...args); // 先读到磁盘上的旧值（开启）
        if (!delayed) {
          delayed = true;
          await new Promise(resolve => setTimeout(resolve, 150));
        } // 再延迟返回
        return data;
      };
      try {
        const slowRead = settings.get();
        await new Promise(resolve => setTimeout(resolve, 30));
        delayed = true; // 写入内部的读取不再延迟
        await settings.set({ knowledgeProposals: false });
        assert.deepEqual(settings.peek(), { knowledgeProposals: false });
        assert.deepEqual(await slowRead, { knowledgeProposals: false }, '过时的读取以写入后的最新值为准');
        assert.deepEqual(settings.peek(), { knowledgeProposals: false }, '过时的读取没有把缓存改回开启');
        assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), { knowledgeProposals: false });
      } finally {
        fsp.readFile = real;
      }
    }
  },
  {
    name: 'AI 功能开关：默认关闭；读写持久化；文件损坏或字段错误一律按关闭处理',
    async run() {
      const directory = temporary(),
        filePath = path.join(directory, 'nested', 'ai-features.json');
      const settings = createAiFeatureSettings({ filePath });
      assert.deepEqual(await settings.get(), { knowledgeProposals: false });
      assert.deepEqual(await settings.set({ knowledgeProposals: true }), { knowledgeProposals: true });
      assert.deepEqual(await createAiFeatureSettings({ filePath }).get(), { knowledgeProposals: true });
      assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
      assert.deepEqual(fs.readdirSync(path.dirname(filePath)), ['ai-features.json'], '不留下临时文件');
      assert.deepEqual(await settings.set({ knowledgeProposals: false }), { knowledgeProposals: false });
      for (const damaged of [
        '{不是 JSON',
        '[]',
        'null',
        '{"knowledgeProposals":"true"}',
        '{"knowledgeProposals":1}',
        ''
      ]) {
        fs.writeFileSync(filePath, damaged, { mode: 0o600 });
        assert.deepEqual(await settings.get(), { knowledgeProposals: false }, damaged);
      }
      fs.writeFileSync(filePath, '{"knowledgeProposals":true,"other":true}', { mode: 0o600 });
      assert.deepEqual(await settings.get(), { knowledgeProposals: true }, '未知字段被忽略，不会影响已知开关');
      assert.throws(() => createAiFeatureSettings({ filePath: '' }), TypeError);
    }
  },
  {
    name: 'AI 功能开关：写入只接受布尔字段，拒绝未知字段、非布尔值与非对象；并发写入不损坏文件',
    async run() {
      const settings = createAiFeatureSettings({ filePath: path.join(temporary(), 'ai-features.json') });
      for (const bad of [
        {},
        { knowledgeProposals: 'true' },
        { knowledgeProposals: 1 },
        { knowledgeProposals: true, apiKey: 'x' },
        { other: true },
        null,
        [],
        'true',
        1
      ]) {
        await assert.rejects(settings.set(bad), { code: 'AI_FEATURES_INVALID' }, JSON.stringify(bad));
      }
      assert.deepEqual(await settings.get(), { knowledgeProposals: false }, '被拒绝的写入不改变状态');
      await Promise.all(
        Array.from({ length: 20 }, (_, index) => settings.set({ knowledgeProposals: index % 2 === 0 }))
      );
      assert.equal(typeof (await settings.get()).knowledgeProposals, 'boolean');
    }
  },
  {
    name: 'AI 功能开关：HTTP 读取与更新沿用 { data } / { error } 封装，更新需要请求头，不影响模型设置文件',
    async run() {
      const directory = temporary(),
        featuresFile = path.join(directory, 'ai-features.json'),
        modelFile = path.join(directory, 'provider.json');
      const features = createAiFeatureSettings({ filePath: featuresFile });
      const modelSettings = createModelSettingsService({
        filePath: modelFile,
        fetchImpl: async () => {
          throw new Error('不应联网');
        }
      });
      await modelSettings.save({ modelId: 'deepseek-flash', apiKey: 'test-secret-never-echo' });
      const modelBefore = fs.readFileSync(modelFile, 'utf8');
      const server = createServer({
        appContext: { http: { aiFeatures: features, modelSettings, knowledge: {}, storage: {} } },
        logger: { error() {} }
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const base = `http://127.0.0.1:${server.address().port}`;
      const call = (method, body, headers = {}) =>
        fetch(`${base}/api/ai/features`, {
          method,
          headers: { 'Content-Type': 'application/json', ...headers },
          body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
        });
      try {
        const initial = await call('GET');
        assert.equal(initial.status, 200);
        assert.equal(initial.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await initial.json(), { data: { knowledgeProposals: false } });
        const rejected = await call('PUT', { knowledgeProposals: true });
        assert.equal(rejected.status, 403);
        assert.equal((await rejected.json()).error.code, 'AI_FEATURES_REQUEST_REJECTED');
        assert.deepEqual(await (await call('GET')).json(), { data: { knowledgeProposals: false } });
        const enabled = await call('PUT', { knowledgeProposals: true }, { 'X-Knowra-AI-Features': '1' });
        assert.equal(enabled.status, 200);
        assert.deepEqual(await enabled.json(), { data: { knowledgeProposals: true } });
        assert.deepEqual(await (await call('GET')).json(), { data: { knowledgeProposals: true } });
        for (const bad of [{ knowledgeProposals: 'yes' }, { knowledgeProposals: true, modelId: 'x' }, {}]) {
          const response = await call('PUT', bad, { 'X-Knowra-AI-Features': '1' });
          assert.equal(response.status, 422, JSON.stringify(bad));
          assert.equal((await response.json()).error.code, 'AI_FEATURES_INVALID');
        }
        assert.equal(
          (await call('PUT', 'x'.repeat(1000), { 'X-Knowra-AI-Features': '1' })).status >= 400,
          true,
          '过大的请求被拒绝'
        );
        assert.deepEqual(
          await (await call('GET')).json(),
          { data: { knowledgeProposals: true } },
          '失败的写入不改变状态'
        );
        assert.equal(fs.readFileSync(modelFile, 'utf8'), modelBefore, '不读写带 API Key 的模型设置文件');
        assert.equal(fs.readFileSync(featuresFile, 'utf8').includes('test-secret'), false);
        assert.equal((await call('DELETE')).status >= 400, true);
      } finally {
        await new Promise(resolve => server.close(resolve));
      }
    }
  },
  {
    name: 'AI 功能开关：应用装配把开关存在存储根目录下，重启后保留，默认关闭',
    async run() {
      const root = temporary();
      const first = createPersistentAppContext({ storageRootDir: root, ownerId: 'features' });
      assert.deepEqual(await first.http.aiFeatures.get(), { knowledgeProposals: false });
      await first.http.aiFeatures.set({ knowledgeProposals: true });
      assert.equal(fs.existsSync(path.join(root, 'ai-features.json')), true);
      await first.ai?.agent?.close?.();
      const second = createPersistentAppContext({ storageRootDir: root, ownerId: 'features' });
      assert.deepEqual(await second.http.aiFeatures.get(), { knowledgeProposals: true });
      await second.ai?.agent?.close?.();
    }
  }
];
