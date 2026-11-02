import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createAppError } from '../../errors/app-error.js';

// 桌面壳独立打包；注册契约测试校验两端、UI 与已核价模型保持一致。
export const SUPPORTED_MODEL_IDS = Object.freeze(['deepseek-flash']);
export const DEFAULT_MODEL_ID = SUPPORTED_MODEL_IDS[0];
export const MODEL_SETTINGS_ERRORS = Object.freeze({
  MODEL_SETTINGS_INVALID: '模型设置格式无效。',
  MODEL_ID_INVALID: '模型 ID 格式无效。',
  MODEL_NOT_SUPPORTED: '当前仅支持 deepseek-flash，请选择受支持的模型后保存。',
  MODEL_KEY_INVALID: 'API Key 格式无效。',
  MODEL_NOT_CONFIGURED: '请先保存 API Key。',
  MODEL_KEY_REJECTED: 'DeepSeek 拒绝了 API Key。',
  MODEL_RATE_LIMITED: 'DeepSeek 请求过于频繁，请稍后重试。',
  MODEL_PROVIDER_UNAVAILABLE: '无法连接 DeepSeek，请检查网络后重试。',
  MODEL_PROVIDER_FAILED: 'DeepSeek 暂时无法完成连接检查。',
  MODEL_RESPONSE_INVALID: 'DeepSeek 返回的模型列表无效。',
  MODEL_NOT_AVAILABLE: '连接成功，但此账号的模型列表中没有该模型 ID。',
  MODEL_CHECK_STALE: '模型配置或连接检查已更新，请重新检查连接。',
  MODEL_CREDENTIAL_STALE: '模型凭据已变更，请重新开始任务。',
  MODEL_SETTINGS_UNAVAILABLE: '模型凭据不可读取，请检查凭据存储。',
  MODEL_SETTINGS_WRITE_FAILED: '模型设置操作失败，请检查凭据存储。',
  MODEL_KEYCHAIN_UNAVAILABLE: '系统钥匙串暂不可用，请解锁后重试。',
  MODEL_KEYCHAIN_DECRYPT_FAILED: '系统钥匙串无法读取该凭据，请重新保存 API Key。'
});
const API_BASE = 'https://api.deepseek.com';
const defaultFile = path.join(os.homedir(), '.config', 'knowra', 'ai-provider.json');
const modelError = (code, status = 400) => createAppError(code, MODEL_SETTINGS_ERRORS[code], status);
const supported = modelId => SUPPORTED_MODEL_IDS.includes(modelId);
const requireSupported = modelId => {
  if (!supported(modelId)) throw modelError('MODEL_NOT_SUPPORTED', 422);
};

export function validateModelSettings(input, { allowEmptyKey = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw modelError('MODEL_SETTINGS_INVALID');
  const modelId = typeof input.modelId === 'string' ? input.modelId.trim() : '';
  const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(modelId)) throw modelError('MODEL_ID_INVALID');
  requireSupported(modelId);
  if ((!allowEmptyKey && !apiKey) || apiKey.length > 512 || /[\r\n]/.test(apiKey))
    throw modelError('MODEL_KEY_INVALID');
  return { modelId, apiKey };
}

export async function checkDeepSeekModel({ apiKey, modelId, fetchImpl = fetch }) {
  requireSupported(modelId);
  let response;
  try {
    response = await fetchImpl(`${API_BASE}/models`, {
      method: 'GET',
      redirect: 'error',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000)
    });
  } catch {
    throw modelError('MODEL_PROVIDER_UNAVAILABLE', 502);
  }
  if (response?.status === 401 || response?.status === 403) throw modelError('MODEL_KEY_REJECTED', 422);
  if (response?.status === 429) throw modelError('MODEL_RATE_LIMITED', 429);
  if (!response?.ok) throw modelError('MODEL_PROVIDER_FAILED', 502);
  let body;
  try {
    body = await response.json();
  } catch {
    /* 不读取或回显供应商原始错误。 */
  }
  if (!Array.isArray(body?.data)) throw modelError('MODEL_RESPONSE_INVALID', 502);
  if (!body.data.some(item => item?.id === modelId)) throw modelError('MODEL_NOT_AVAILABLE', 422);
  return { connected: true, modelAvailable: true, checkedAt: new Date().toISOString() };
}

export function createModelSettingsService({ filePath = defaultFile, fetchImpl = fetch } = {}) {
  // 本服务的凭据操作按调用次序执行，避免旧读改写在删除或换钥后复活凭据。
  let operations = Promise.resolve();
  let revision = 0;
  let latestCheck = 0;
  /** @template T
   * @param {() => Promise<T>} operation
   * @returns {Promise<T>}
   */
  function queued(operation) {
    const result = operations.then(operation);
    operations = result.catch(() => undefined);
    return result;
  }

  async function read() {
    let handle;
    try {
      handle = await fs.open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (
        !stat.isFile() ||
        (stat.mode & 0o077) !== 0 ||
        (typeof process.getuid === 'function' && stat.uid !== process.getuid())
      ) {
        throw modelError('MODEL_SETTINGS_UNAVAILABLE', 500);
      }
      const value = JSON.parse(await handle.readFile('utf8'));
      if (
        !value ||
        typeof value.apiKey !== 'string' ||
        typeof value.modelId !== 'string' ||
        (value.credentialRef !== undefined && typeof value.credentialRef !== 'string')
      )
        throw modelError('MODEL_SETTINGS_UNAVAILABLE', 500);
      return value;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw modelError('MODEL_SETTINGS_UNAVAILABLE', 500);
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  function publicStatus(value) {
    const modelId = value?.modelId ?? DEFAULT_MODEL_ID;
    return {
      provider: 'deepseek',
      modelId,
      configured: Boolean(value),
      supportedModelIds: [...SUPPORTED_MODEL_IDS],
      modelSupported: supported(modelId)
    };
  }

  async function write(value) {
    const directory = path.dirname(filePath);
    const temp = path.join(directory, `.ai-provider-${randomUUID()}.tmp`);
    try {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      await fs.writeFile(temp, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
      await fs.rename(temp, filePath);
    } catch {
      throw modelError('MODEL_SETTINGS_WRITE_FAILED', 500);
    } finally {
      await fs.rm(temp, { force: true }).catch(() => undefined);
    }
  }

  async function referencedValue() {
    const value = await read();
    // 保留旧版不受支持的配置原样，让运行端如实展示模型不受支持。
    if (!value || value.credentialRef || !supported(value.modelId)) return value;
    const upgraded = { ...value, credentialRef: randomUUID() };
    await write(upgraded);
    return upgraded;
  }

  return {
    status() {
      return queued(async () => publicStatus(await read()));
    },
    save(input) {
      revision++;
      return queued(async () => {
        const previous = await read();
        const { modelId, apiKey } = validateModelSettings(input, { allowEmptyKey: Boolean(previous) });
        await write({
          modelId,
          apiKey: apiKey || previous.apiKey,
          credentialRef:
            !apiKey && previous?.modelId === modelId ? (previous.credentialRef ?? randomUUID()) : randomUUID()
        });
        return publicStatus({ modelId });
      });
    },
    remove() {
      revision++;
      return queued(async () => {
        try {
          await fs.rm(filePath, { force: true });
        } catch {
          throw modelError('MODEL_SETTINGS_WRITE_FAILED', 500);
        }
        return publicStatus(null);
      });
    },
    async check() {
      const checkId = ++latestCheck;
      const checkRevision = revision;
      const value = await queued(read);
      // 读取期间若已换钥、删除或发起新检查，不再发送旧凭据。
      if (checkId !== latestCheck || checkRevision !== revision) throw modelError('MODEL_CHECK_STALE', 409);
      if (!value) throw modelError('MODEL_NOT_CONFIGURED', 409);
      requireSupported(value.modelId);
      let result, failure;
      try {
        result = await checkDeepSeekModel({ ...value, fetchImpl });
      } catch (error) {
        failure = error;
      }
      return queued(async () => {
        if (checkId !== latestCheck || checkRevision !== revision) throw modelError('MODEL_CHECK_STALE', 409);
        const current = await read();
        if (
          checkId !== latestCheck ||
          checkRevision !== revision ||
          !current ||
          current.modelId !== value.modelId ||
          current.apiKey !== value.apiKey ||
          current.credentialRef !== value.credentialRef
        ) {
          throw modelError('MODEL_CHECK_STALE', 409);
        }
        if (failure) throw failure;
        return { ...publicStatus(value), ...result };
      });
    },
    credentialReference() {
      const requestedRevision = revision;
      return queued(async () => {
        const value = await referencedValue();
        if (requestedRevision !== revision) throw modelError('MODEL_CREDENTIAL_STALE', 409);
        return value ? { provider: 'deepseek', modelId: value.modelId, credentialRef: value.credentialRef } : null;
      });
    },
    resolveCredential(reference) {
      const requestedRevision = revision;
      return queued(async () => {
        const value = await referencedValue();
        if (requestedRevision !== revision) throw modelError('MODEL_CREDENTIAL_STALE', 409);
        if (value) requireSupported(value.modelId);
        if (!value || !reference || reference !== value.credentialRef) throw modelError('MODEL_CREDENTIAL_STALE', 409);
        return { apiKey: value.apiKey, modelId: value.modelId };
      });
    }
  };
}
