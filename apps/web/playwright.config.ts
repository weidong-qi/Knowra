import { defineConfig, devices } from '@playwright/test';

const browserExecutable = process.env.V4_BROWSER_EXECUTABLE_PATH;
const browserChannel = process.env.V4_BROWSER_CHANNEL === 'chrome' ? 'chrome' as const : undefined;

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: process.env.V4_BASE_URL ?? 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    ...(browserExecutable ? { launchOptions: { executablePath: browserExecutable, chromiumSandbox: true } } : {})
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(browserChannel ? { channel: browserChannel } : {})
      }
    }
  ]
});
