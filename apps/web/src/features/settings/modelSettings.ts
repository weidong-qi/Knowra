import { apiClient } from '@study-accelerator/web-core';

export interface ModelSettingsStatus {
  provider: 'deepseek';
  modelId: string;
  configured: boolean;
  supportedModelIds?: string[];
  modelSupported?: boolean;
  connected?: boolean;
  modelAvailable?: boolean;
  checkedAt?: string;
}

type Action = 'status' | 'save' | 'remove' | 'check';

async function request(action: Action, value?: { modelId: string; apiKey: string }): Promise<ModelSettingsStatus> {
  if (window.knowraDesktop?.modelSettings) return window.knowraDesktop.modelSettings(action, value);
  const url = `/api/ai/model-settings${action === 'check' ? '/check' : ''}`;
  const method = { status: 'GET', save: 'PUT', remove: 'DELETE', check: 'POST' }[action];
  const response = await apiClient.requestJson<{ data: ModelSettingsStatus }>(url, {
    method,
    headers: action === 'status' ? undefined : { 'X-Knowra-Model-Settings': '1' },
    body: value ? JSON.stringify(value) : undefined
  });
  return response.data;
}

export const modelSettings = {
  status: () => request('status'),
  save: (value: { modelId: string; apiKey: string }) => request('save', value),
  remove: () => request('remove'),
  check: () => request('check')
};

/** 与 API、桌面运行端和已复核价格档案由契约测试保持一致。 */
export const SUPPORTED_MODEL_IDS = ['deepseek-flash'] as const;

// 仅展示固定消息，绝不把供应商响应、底层路径或密钥片段带入页面。
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
const safeMessages = new Set<string>(Object.values(MODEL_SETTINGS_ERRORS));
export function modelSettingsError(failure: unknown): string {
  const message = failure instanceof Error
    ? failure.message.replace(/^Error invoking remote method 'model-settings': Error: /, '') : '';
  return safeMessages.has(message) ? message : '模型设置操作失败，请检查网络或当前运行端后重试。';
}
