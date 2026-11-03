import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createServer } from '../src/server.js';
import { createModelSettingsService } from '../src/modules/ai/model-settings.ts';

export const modelSettingsTests = [
  {
    name: '模型设置：密钥仅写服务端受限文件，响应不回显；连接检查只读取模型列表',
    async run() {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-ai-settings-'));
      const filePath = path.join(directory, 'secrets', 'provider.json');
      const calls = [];
      const service = createModelSettingsService({
        filePath,
        fetchImpl: async (url, options) => {
          calls.push({ url, options });
          return { ok: true, status: 200, json: async () => ({ data: [{ id: 'deepseek-flash' }] }) };
        }
      });
      const server = createServer({
        appContext: { http: { modelSettings: service, knowledge: {}, storage: {} } },
        logger: { error() {} }
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const base = `http://127.0.0.1:${server.address().port}`;
      const request = (method, suffix = '', body, headers = {}) =>
        fetch(`${base}/api/ai/model-settings${suffix}`, {
          method,
          headers: { 'Content-Type': 'application/json', ...headers },
          body: body === undefined ? undefined : JSON.stringify(body)
        });
      try {
        assert.equal((await (await request('GET')).json()).data.configured, false);
        const input = { modelId: 'deepseek-flash', apiKey: 'test-secret-never-echo' };
        assert.equal((await request('PUT', '', input)).status, 403);
        const saved = await request('PUT', '', input, { 'X-Knowra-Model-Settings': '1' });
        assert.equal(saved.status, 200);
        assert.equal((await saved.text()).includes(input.apiKey), false);
        assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
        assert.equal((await (await request('GET')).text()).includes(input.apiKey), false);
        const firstReference = await service.credentialReference();
        assert.equal(firstReference.modelId, 'deepseek-flash');
        assert.equal((await service.resolveCredential(firstReference.credentialRef)).apiKey, input.apiKey);
        assert.equal((await (await request('GET')).text()).includes(firstReference.credentialRef), false);
        await service.save({ modelId: 'deepseek-flash', apiKey: '' });
        assert.equal((await service.credentialReference()).credentialRef, firstReference.credentialRef);
        await service.save({ modelId: 'deepseek-flash', apiKey: 'replacement-synthetic-secret' });
        assert.notEqual((await service.credentialReference()).credentialRef, firstReference.credentialRef);
        await assert.rejects(
          service.resolveCredential(firstReference.credentialRef),
          error => error.code === 'MODEL_CREDENTIAL_STALE'
        );
        const checked = await request('POST', '/check', undefined, { 'X-Knowra-Model-Settings': '1' });
        assert.equal((await checked.json()).data.modelAvailable, true);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, 'https://api.deepseek.com/models');
        assert.equal(calls[0].options.headers.Authorization, 'Bearer replacement-synthetic-secret');
        assert.equal(calls[0].options.redirect, 'error');
        assert.equal((await request('DELETE', '', undefined, { 'X-Knowra-Model-Settings': '1' })).status, 200);
        assert.equal(fs.existsSync(filePath), false);
      } finally {
        server.close();
        await once(server, 'close');
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  }
];

const successResponse = () => ({ ok: true, status: 200, json: async () => ({ data: [{ id: 'deepseek-flash' }] }) });
const deferred = () => {
  let resolve;
  const promise = new Promise(done => {
    resolve = done;
  });
  return { promise, resolve };
};
async function withSettings(
  run,
  fetchImpl = async () => {
    throw new Error('不应联网');
  }
) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-ai-settings-'));
  const filePath = path.join(directory, 'provider.json');
  const service = createModelSettingsService({ filePath, fetchImpl });
  try {
    await run({ service, filePath, directory });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

modelSettingsTests.push(
  {
    name: '模型设置：API、桌面、UI 与运行端已核价模型声明一致',
    async run() {
      const api = await import('../src/modules/ai/model-settings.ts');
      const desktop = (await import('../../desktop-shell/src/model-settings.cjs')).default;
      const { reviewedDeepSeekPriceProfile } = await import('../src/modules/ai/reviewed-price-profile.ts');
      assert.deepEqual(api.SUPPORTED_MODEL_IDS, ['deepseek-flash']);
      assert.deepEqual(desktop.SUPPORTED_MODEL_IDS, api.SUPPORTED_MODEL_IDS);
      assert.deepEqual(desktop.MODEL_SETTINGS_ERRORS, api.MODEL_SETTINGS_ERRORS);
      assert.equal(desktop.DEFAULT_MODEL_ID, api.DEFAULT_MODEL_ID);
      assert.equal(reviewedDeepSeekPriceProfile.modelId, api.DEFAULT_MODEL_ID);
      const uiSource = fs.readFileSync(
        new URL('../../web/src/features/settings/modelSettings.ts', import.meta.url),
        'utf8'
      );
      const declaration = uiSource.match(/export const SUPPORTED_MODEL_IDS\s*=\s*(?:Object\.freeze\()?\[([^\]]*)\]/);
      assert.ok(declaration, 'UI 应导出受支持模型声明');
      assert.deepEqual(
        [...declaration[1].matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1]),
        api.SUPPORTED_MODEL_IDS
      );
      const errors = uiSource.match(/export const MODEL_SETTINGS_ERRORS\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/);
      assert.ok(errors, 'UI 应导出固定模型错误消息');
      assert.deepEqual(
        Object.fromEntries([...errors[1].matchAll(/(MODEL_[A-Z_]+): '([^']*)'/g)].map(match => [match[1], match[2]])),
        api.MODEL_SETTINGS_ERRORS
      );
    }
  },
  {
    name: '模型设置：仅接受支持模型，旧配置只读且显式保存保留密钥',
    async run() {
      await withSettings(async ({ service, filePath }) => {
        for (const input of [null, [], 'bad']) {
          await assert.rejects(service.save(input), error => error.code === 'MODEL_SETTINGS_INVALID');
        }
        for (const modelId of ['deepseek-chat', 'deepseek-reasoner', 'made-up-model']) {
          await assert.rejects(
            service.save({ modelId, apiKey: 'synthetic-key' }),
            error => error.code === 'MODEL_NOT_SUPPORTED'
          );
        }
        await assert.rejects(
          service.save({ modelId: '../unsafe', apiKey: 'synthetic-key' }),
          error => error.code === 'MODEL_ID_INVALID'
        );
        for (const apiKey of ['', 'key\nheader', 'key\rheader', 'x'.repeat(513), 12]) {
          await assert.rejects(
            service.save({ modelId: 'deepseek-flash', apiKey }),
            error => error.code === 'MODEL_KEY_INVALID'
          );
        }
        assert.equal(fs.existsSync(filePath), false);
        const legacy = JSON.stringify({ modelId: 'deepseek-chat', apiKey: 'legacy-synthetic-secret' });
        fs.writeFileSync(filePath, legacy, { mode: 0o600 });
        const status = await service.status();
        assert.equal(status.modelId, 'deepseek-chat');
        assert.equal(status.configured, true);
        assert.equal(status.modelSupported, false);
        assert.deepEqual(status.supportedModelIds, ['deepseek-flash']);
        assert.equal((await service.credentialReference()).modelId, 'deepseek-chat');
        await assert.rejects(service.check(), error => error.code === 'MODEL_NOT_SUPPORTED');
        await assert.rejects(service.resolveCredential('old-ref'), error => error.code === 'MODEL_NOT_SUPPORTED');
        await assert.rejects(
          service.save({ modelId: 'deepseek-chat', apiKey: '' }),
          error => error.code === 'MODEL_NOT_SUPPORTED'
        );
        assert.equal(fs.readFileSync(filePath, 'utf8'), legacy, '只读与无效保存不得改写旧凭据');
        const saved = await service.save({ modelId: '\u3000deepseek-flash\u00a0', apiKey: '\u3000 ' });
        assert.equal(saved.modelSupported, true);
        const reference = await service.credentialReference();
        assert.equal((await service.resolveCredential(reference.credentialRef)).apiKey, 'legacy-synthetic-secret');
        assert.equal(JSON.stringify(saved).includes('legacy-synthetic-secret'), false);
        assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
      });
    }
  },
  {
    name: '模型设置：供应商失败只返回固定消息，检查不生成内容',
    async run() {
      const cases = [
        { response: { status: 401 }, code: 'MODEL_KEY_REJECTED' },
        { response: { status: 403 }, code: 'MODEL_KEY_REJECTED' },
        { response: { status: 429 }, code: 'MODEL_RATE_LIMITED' },
        { response: { status: 500 }, code: 'MODEL_PROVIDER_FAILED' },
        {
          response: {
            ok: true,
            status: 200,
            json: async () => {
              throw new Error('DeepSeek synthetic-secret');
            }
          },
          code: 'MODEL_RESPONSE_INVALID'
        },
        {
          response: { ok: true, status: 200, json: async () => ({ data: 'synthetic-secret' }) },
          code: 'MODEL_RESPONSE_INVALID'
        },
        {
          response: {
            ok: true,
            status: 200,
            json: async () => ({ data: [{ id: 'deepseek-chat', raw: 'synthetic-secret' }] })
          },
          code: 'MODEL_NOT_AVAILABLE'
        },
        { failure: new Error('DeepSeek synthetic-secret'), code: 'MODEL_PROVIDER_UNAVAILABLE' }
      ];
      const { MODEL_SETTINGS_ERRORS } = await import('../src/modules/ai/model-settings.ts');
      for (const scenario of cases) {
        let calls = 0;
        await withSettings(
          async ({ service }) => {
            await service.save({ modelId: 'deepseek-flash', apiKey: 'synthetic-secret' });
            await assert.rejects(service.check(), error => {
              assert.equal(error.code, scenario.code);
              assert.equal(error.message, MODEL_SETTINGS_ERRORS[scenario.code]);
              assert.equal(error.message.includes('synthetic-secret'), false);
              return true;
            });
            assert.equal(calls, 1);
          },
          async (url, request) => {
            calls++;
            assert.equal(url, 'https://api.deepseek.com/models');
            assert.equal(request.method, 'GET');
            assert.equal(request.redirect, 'error');
            assert.equal(request.body, undefined);
            if (scenario.failure) throw scenario.failure;
            return scenario.response;
          }
        );
      }
    }
  },
  {
    name: '模型设置：凭据删除或轮换后旧检查不能报告成功',
    async run() {
      for (const action of ['remove', 'save']) {
        const started = deferred(),
          response = deferred();
        await withSettings(
          async ({ service }) => {
            await service.save({ modelId: 'deepseek-flash', apiKey: 'old-synthetic-secret' });
            const checking = service.check();
            const assertion = assert.rejects(checking, error => error.code === 'MODEL_CHECK_STALE');
            await started.promise;
            if (action === 'remove') await service.remove();
            else await service.save({ modelId: 'deepseek-flash', apiKey: 'new-synthetic-secret' });
            response.resolve(successResponse());
            await assertion;
            assert.equal((await service.status()).configured, action !== 'remove');
          },
          async () => {
            started.resolve();
            return response.promise;
          }
        );
      }
    }
  },
  {
    name: '模型设置：读取期间换钥、删除或重查，不发送已失效凭据',
    async run() {
      for (const action of ['save', 'remove', 'check']) {
        let calls = 0;
        await withSettings(
          async ({ service }) => {
            await service.save({ modelId: 'deepseek-flash', apiKey: 'old-synthetic-secret' });
            const checking = service.check();
            const rejected = assert.rejects(checking, error => error.code === 'MODEL_CHECK_STALE');
            const newer =
              action === 'save'
                ? service.save({ modelId: 'deepseek-flash', apiKey: 'new-synthetic-secret' })
                : action === 'remove'
                  ? service.remove()
                  : service.check();
            await Promise.all([rejected, newer]);
            assert.equal(calls, action === 'check' ? 1 : 0);
          },
          async () => {
            calls++;
            return successResponse();
          }
        );
      }
    }
  },
  {
    name: '模型设置：重复检查以最新请求为准，旧成功或失败均失效',
    async run() {
      for (const staleResponse of [successResponse(), { status: 401 }]) {
        const started = deferred(),
          response = deferred();
        let calls = 0;
        await withSettings(
          async ({ service }) => {
            await service.save({ modelId: 'deepseek-flash', apiKey: 'synthetic-secret' });
            const first = service.check();
            const assertion = assert.rejects(first, error => error.code === 'MODEL_CHECK_STALE');
            await started.promise;
            assert.equal((await service.check()).modelAvailable, true);
            response.resolve(staleResponse);
            await assertion;
          },
          async () => {
            if (++calls === 1) {
              started.resolve();
              return response.promise;
            }
            return successResponse();
          }
        );
      }
    }
  },
  {
    name: '模型设置：连续换钥、引用升级与删除按次序执行，不复活凭据',
    async run() {
      await withSettings(async ({ service, filePath }) => {
        const saves = Array.from({ length: 8 }, (_, index) =>
          service.save({ modelId: 'deepseek-flash', apiKey: `synthetic-secret-${index}` })
        );
        await Promise.all(saves);
        const reference = await service.credentialReference();
        assert.equal((await service.resolveCredential(reference.credentialRef)).apiKey, 'synthetic-secret-7');
        const resolving = service.resolveCredential(reference.credentialRef);
        const replacing = service.save({ modelId: 'deepseek-flash', apiKey: 'replacement-synthetic-secret' });
        await assert.rejects(resolving, error => error.code === 'MODEL_CREDENTIAL_STALE');
        await replacing;
        fs.writeFileSync(filePath, JSON.stringify({ modelId: 'deepseek-flash', apiKey: 'legacy-synthetic-secret' }), {
          mode: 0o600
        });
        const upgrading = service.credentialReference();
        const removed = service.remove();
        await assert.rejects(upgrading, error => error.code === 'MODEL_CREDENTIAL_STALE');
        await removed;
        assert.equal(fs.existsSync(filePath), false);
        await Promise.all([service.save({ modelId: 'deepseek-flash', apiKey: 'synthetic-secret' }), service.remove()]);
        assert.equal(fs.existsSync(filePath), false);
        await service.save({ modelId: 'deepseek-flash', apiKey: 'new-synthetic-secret' });
        await assert.rejects(
          service.resolveCredential(reference.credentialRef),
          error => error.code === 'MODEL_CREDENTIAL_STALE'
        );
      });
    }
  },
  {
    name: '模型设置：损坏、不安全文件与磁盘失败不回显内容或路径',
    async run() {
      const { MODEL_SETTINGS_ERRORS } = await import('../src/modules/ai/model-settings.ts');
      await withSettings(async ({ service, filePath, directory }) => {
        fs.writeFileSync(filePath, '{"apiKey":"synthetic-secret" invalid', { mode: 0o600 });
        await assert.rejects(
          service.status(),
          error => error.message === MODEL_SETTINGS_ERRORS.MODEL_SETTINGS_UNAVAILABLE
        );
        fs.writeFileSync(filePath, JSON.stringify({ modelId: 'deepseek-flash', apiKey: 'synthetic-secret' }));
        fs.chmodSync(filePath, 0o644);
        await assert.rejects(service.status(), error => error.code === 'MODEL_SETTINGS_UNAVAILABLE');
        fs.chmodSync(filePath, 0o600);
        if (process.platform !== 'win32' && process.getuid?.() !== 0) {
          const before = fs.readFileSync(filePath, 'utf8');
          fs.chmodSync(directory, 0o500);
          try {
            await assert.rejects(
              service.save({ modelId: 'deepseek-flash', apiKey: 'replacement-synthetic-secret' }),
              error => error.message === MODEL_SETTINGS_ERRORS.MODEL_SETTINGS_WRITE_FAILED
            );
            await assert.rejects(
              service.remove(),
              error => error.message === MODEL_SETTINGS_ERRORS.MODEL_SETTINGS_WRITE_FAILED
            );
            assert.equal(fs.readFileSync(filePath, 'utf8'), before);
          } finally {
            fs.chmodSync(directory, 0o700);
          }
        }
        const link = path.join(directory, 'link.json');
        fs.symlinkSync(filePath, link);
        await assert.rejects(
          createModelSettingsService({ filePath: link }).status(),
          error => error.code === 'MODEL_SETTINGS_UNAVAILABLE'
        );
        const blocked = createModelSettingsService({
          filePath: path.join(filePath, 'synthetic-secret', 'provider.json')
        });
        await assert.rejects(blocked.save({ modelId: 'deepseek-flash', apiKey: 'synthetic-secret' }), error => {
          assert.equal(error.message, MODEL_SETTINGS_ERRORS.MODEL_SETTINGS_UNAVAILABLE);
          assert.equal(error.message.includes(directory), false);
          return true;
        });
      });
    }
  }
);
