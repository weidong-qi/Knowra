import { defineConfig, devices } from '@playwright/test';

// 与现有编辑器验收使用同一系统 Chrome，保留 Ubuntu runner 支持的浏览器沙箱。
export default defineConfig({
  testDir: './e2e',
  testMatch: 'sync-safety-recovery.spec.ts',
  workers: 1,
  retries: 0,
  use: {
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    launchOptions: { chromiumSandbox: true }
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }]
});
