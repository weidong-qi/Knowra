import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  testMatch: 'knowledge-concepts.spec.ts',
  workers: 1,
  retries: 0,
  use: {
    ...devices['Desktop Chrome'],
    channel: 'chrome',
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    launchOptions: { chromiumSandbox: true }
  }
});
