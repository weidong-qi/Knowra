import { spawnSync } from 'node:child_process';
import { isDirectExecution } from './cli-entry.mjs';

// 整套迁移到独立 runner；保留原测试入口，并串行补跑合成编辑器恢复回归。
export const suites = Object.freeze({
  api: ['test:api'],
  web: ['test:content-anchor', 'test:shared', 'test:web-core', 'test:web:legacy', 'test:web', 'test:scripts'],
  desktop: ['test:desktop'],
  chromium: [
    'test:e2e -w @study-accelerator/desktop-runtime',
    'test:e2e -w @study-accelerator/web -- --config playwright.mobile-evidence.config.ts editor-draft-recovery.spec.ts',
    'test:e2e -w @study-accelerator/web -- --config playwright.mobile-evidence.config.ts editor-knowra-marks.spec.ts',
    'test:e2e -w @study-accelerator/web -- --config playwright.sync-recovery.config.ts',
    'test:e2e -w @study-accelerator/web -- --config playwright.mobile-evidence.config.ts v5-global-appearance.spec.ts',
    'test:e2e -w @study-accelerator/web -- --config playwright.knowledge-concepts.config.ts'
  ]
});

export function requireSuccessfulJobs(needs) {
  const expected = ['checks', 'suites', 'isolated-image'];
  if (
    !needs ||
    typeof needs !== 'object' ||
    Array.isArray(needs) ||
    Object.keys(needs).sort().join(',') !== expected.sort().join(',')
  ) {
    throw new Error('CI 前置作业不完整或发生未审核的变化。');
  }
  for (const name of expected) {
    if (needs[name]?.result !== 'success') throw new Error(`CI 前置作业未成功：${name} (${needs[name]?.result})`);
  }
}

export function runSuite(name, run = spawnSync) {
  if (!Object.hasOwn(suites, name)) throw new Error(`未知 CI 套件：${name}`);
  for (const command of suites[name]) {
    const result = run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', ...command.split(' ')], {
      stdio: 'inherit',
      env: process.env
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`CI 套件失败：${command} (${result.signal || result.status})`);
  }
}

if (isDirectExecution(import.meta.url)) {
  if (process.argv[2] === 'suite') runSuite(process.argv[3]);
  else if (process.argv[2] === 'gate') requireSuccessfulJobs(JSON.parse(process.env.NEEDS_JSON || 'null'));
  else throw new Error('用法：node scripts/ci.mjs suite <name> | gate');
}
