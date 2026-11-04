export interface BuildInfo {
  schemaVersion: number;
  version: string;
  commit: string | null;
  state: 'clean' | 'dirty' | 'unknown';
  source: 'git' | 'external' | 'unknown';
  builtAt: string;
}

declare const __KNOWRA_BUILD_INFO__: BuildInfo;

// 单元测试和非Vite宿主不虚构版本或提交。
export const buildInfo: BuildInfo = typeof __KNOWRA_BUILD_INFO__ === 'undefined'
  ? { schemaVersion: 1, version: '未知', commit: null, state: 'unknown', source: 'unknown', builtAt: '' }
  : __KNOWRA_BUILD_INFO__;
