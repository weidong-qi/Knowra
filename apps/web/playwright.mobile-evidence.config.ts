import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', testMatch: ['incremental-report-review.spec.ts', 'incremental-confirmation.spec.ts', 'mobile-evidence.spec.ts', 'responsive-mobile-tablet.spec.ts', 'v4-05-shell-home.spec.ts', 'v4-07-editor.spec.ts', 'editor-heading-typography.spec.ts', 'editor-list-markers.spec.ts', 'editor-heading-math-behavior.spec.ts', 'editor-table-boundary.spec.ts', 'editor-table-handles.spec.ts', 'editor-saved-actions.spec.ts', 'editor-draft-recovery.spec.ts', 'editor-knowra-marks.spec.ts', 'ai-assistant.spec.ts', 'v4-notes-entry-drag.spec.ts', 'v5-domain-evidence.spec.ts', 'v5-global-appearance.spec.ts', 'v5-component-shapes.spec.ts', 'v5-overlay-materials.spec.ts', 'v5-assistant-settings-evidence.spec.ts', 'v5-status-dialogs-evidence.spec.ts', 'v5-command-meta-evidence.spec.ts', 'knowledge-index-mutations.spec.ts', 'knowledge-source-comparison.spec.ts', 'training-question-detail.spec.ts'], outputDir: './test-results/mobile-evidence',
  fullyParallel: true, workers: 2, retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/mobile-evidence', open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:5173', browserName: 'chromium', channel: 'chrome', launchOptions: { chromiumSandbox: true }, serviceWorkers: 'block', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'npm run preview -- --host 127.0.0.1 --port 5173 --strictPort', url: 'http://127.0.0.1:5173', reuseExistingServer: false },
});
