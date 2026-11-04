import type { PriceProfile } from './boundary-types.ts';

// 2026-10-02 复核 deepseek-flash（DeepSeek-V4.1-Flash）的高峰、缓存未命中价格。
// 官方来源：https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
// 空闲时段与缓存命中仍按此较高档预留；expiresAt 为本地复核截止，非供应商价格保证。
// expiresAt 是建议复核日期：超过后不再停止付费调用，只在助手状态里提示“费用为估算”（priceNotice），应重新核价发布。
export const reviewedDeepSeekPriceProfile = Object.freeze({
  version: 'deepseek-flash-cny-2026-10-02',
  modelId: 'deepseek-flash',
  expiresAt: '2026-10-09T00:00:00.000Z',
  inputMicrounitsPerMillion: 2_000_000,
  outputMicrounitsPerMillion: 8_000_000
} satisfies PriceProfile);
