import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createAppError } from '../../errors/app-error.js';

interface FeatureValues {
  knowledgeProposals: boolean;
}
interface FeatureSettingsOptions {
  filePath: string;
}
type RawFeatureValues = Partial<Record<keyof FeatureValues, unknown>>;

const DEFAULTS = Object.freeze({ knowledgeProposals: false });
const KEYS = Object.keys(DEFAULTS) as (keyof FeatureValues)[];

/**
 * AI 功能开关：服务端（或桌面运行端）全局一份，与知识空间无关，与带 API Key 的模型设置分开保存。
 * 默认全部关闭；文件缺失、损坏或字段类型不对一律按关闭处理（fail closed），不会因此开启任何功能。
 * 开关只决定模型“能不能”使用某项能力，不替代读取范围与外发授权。
 */
export function createAiFeatureSettings({ filePath }: FeatureSettingsOptions) {
  if (typeof filePath !== 'string' || !filePath) throw new TypeError('AI 功能开关需要存储路径。');
  let writing: Promise<FeatureValues | void> = Promise.resolve();
  // 同步可读的最近值：事务内复核等不能 await 的位置使用。读取与写入成功后更新；从未读取过时按关闭处理（fail closed）。
  let cached: FeatureValues | null = null;
  // 写入代数：较早开始的读取在写入完成之后才返回时，结果已过时，不得覆盖较新的缓存。
  let generation = 0;

  function normalize(value: unknown): FeatureValues {
    const result: FeatureValues = { ...DEFAULTS };
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const key of KEYS)
        if (typeof (value as RawFeatureValues)[key] === 'boolean')
          result[key] = (value as RawFeatureValues)[key] as boolean;
    }
    return result;
  }

  async function get() {
    const started = generation;
    let read;
    try {
      read = normalize(JSON.parse(await fs.readFile(filePath, 'utf8')));
    } catch {
      read = { ...DEFAULTS };
    }
    if (started === generation) cached = read;
    // 读取期间发生过写入：读到的值可能已过时，以写入后的最新缓存为准。
    return { ...(started === generation ? read : (cached ?? read)) };
  }

  async function set(input: unknown) {
    const unknown =
      input && typeof input === 'object' && !Array.isArray(input)
        ? Object.keys(input).filter(key => !KEYS.includes(key as keyof FeatureValues))
        : ['?'];
    if (
      unknown.length ||
      !KEYS.some(key => typeof (input as RawFeatureValues)[key] === 'boolean') ||
      KEYS.some(key => key in (input as RawFeatureValues) && typeof (input as RawFeatureValues)[key] !== 'boolean')
    ) {
      throw createAppError('AI_FEATURES_INVALID', 'AI 功能开关格式无效。', 422);
    }
    const run = writing.then(async () => {
      const next: FeatureValues = {
        ...(await get()),
        ...Object.fromEntries(
          KEYS.filter(key => key in (input as FeatureValues)).map(key => [key, (input as FeatureValues)[key]])
        )
      };
      await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
      const temp = path.join(path.dirname(filePath), `.ai-features-${randomUUID()}.tmp`);
      try {
        await fs.writeFile(temp, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
        await fs.rename(temp, filePath);
        cached = { ...next };
        generation += 1;
      } finally {
        await fs.rm(temp, { force: true });
      }
      return next;
    });
    writing = run.catch(() => undefined);
    return run;
  }

  return { get, set, peek: () => ({ ...(cached ?? DEFAULTS) }) };
}
