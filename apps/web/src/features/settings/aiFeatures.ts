import { apiClient } from '@study-accelerator/web-core';

export interface AiFeatures { knowledgeProposals: boolean }

/** 浏览器连服务端与桌面端本地运行共用同一个 HTTP 接口：开关保存在实际执行 AI 的那一端。 */
export const aiFeatures = {
  async get(): Promise<AiFeatures> {
    return (await apiClient.requestJson<{ data: AiFeatures }>('/api/ai/features')).data;
  },
  async set(value: Partial<AiFeatures>): Promise<AiFeatures> {
    return (await apiClient.requestJson<{ data: AiFeatures }>('/api/ai/features', {
      method: 'PUT', headers: { 'X-Knowra-AI-Features': '1' }, body: JSON.stringify(value)
    })).data;
  }
};
