// 纯合成截图；使用同环境 Vite，保持 Chromium 自身沙箱。
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const sourceRoot = process.env.CAPTURE_SOURCE_ROOT ?? root;
execFileSync('git', ['diff', '--quiet', 'HEAD', '--', 'apps/web/src', 'apps/web/index.html'], {
  cwd: sourceRoot
});
const git = (...args) => execFileSync('git', args, { cwd: sourceRoot, encoding: 'utf8' }).trim();
const sourceCommit = git('rev-parse', 'HEAD');
const sourceTree = git('rev-parse', 'HEAD:apps/web/src');
const fixtureBundle = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-evidence-')), 'fixture.mjs');
await build({
  entryPoints: [root + '/apps/web/e2e/fixtures/editorWorkspace.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: fixtureBundle
});
const { mockEditorWorkspace } = await import(fixtureBundle);
const phase = process.argv[2];
if (!phase || !/^[a-z0-9-]+$/.test(phase)) throw new Error('请提供证据目录名称');
const output = `${root}/docs/审查/证据/手机平板V4/${phase}`;
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', chromiumSandbox: true });
const sizes = [
  [360, 800],
  [390, 843],
  [412, 915],
  [768, 1024],
  [1024, 768],
  [1024, 1366],
  [1366, 1024],
  [843, 390],
  [1440, 900]
];
const measurements = [];
for (const [width, height] of sizes) {
  const context = await browser.newContext({
    viewport: { width, height },
    hasTouch: width <= 1366,
    isMobile: width < 768
  });
  const page = await context.newPage();
  await mockEditorWorkspace(
    page,
    [],
    [],
    '# 手机与平板阅读\n\n合成资料：记录一份学习笔记，检查列表、工具栏、长文与保存。\n\n## 重点回顾\n\n' +
      Array.from(
        { length: 35 },
        (_, i) => `第 ${i + 1} 段：在不同尺寸中保持内容可读，面板独立滚动，核心操作可以触达。`
      ).join('\n\n')
  );
  // 所有请求均为合成资料；不启动 API，也不调用模型。
  await page.route('**/api/ai/assistant/status', r =>
    r.fulfill({
      json: {
        data: {
          provider: 'deepseek',
          modelId: 'deepseek-flash',
          configured: true,
          executionLocation: 'server',
          generationAvailable: true,
          budget: null
        }
      }
    })
  );
  await page.route('**/api/ai/access-policies**', r => r.fulfill({ json: { data: [] } }));
  const conversation = {
    conversationId: 'conversation-1',
    spaceId: 'space-1',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    readOnly: false,
    historicalDataset: false
  };
  const turn = {
    turnId: 'turn-1',
    conversationId: 'conversation-1',
    requestedPolicyId: null,
    status: 'succeeded',
    phase: 'finished',
    errorCode: null,
    toolCalls: [],
    modelAttempts: []
  };
  const messages = [
    {
      messageId: 'message-1',
      turnId: 'turn-1',
      sequence: 1,
      role: 'user',
      content: '帮我整理学习计划',
      sourceRefs: [],
      sourceFree: true,
      createdAt: conversation.createdAt
    },
    {
      messageId: 'message-2',
      turnId: 'turn-1',
      sequence: 2,
      role: 'assistant',
      content:
        '## 学习计划\n\n先阅读笔记，再整理重点。\n\n' +
        Array.from({ length: 14 }, (_, i) => `${i + 1}. 回顾合成例题，记录自己的理解。`).join('\n'),
      sourceRefs: [],
      citations: [],
      sourceFree: true,
      createdAt: conversation.createdAt
    }
  ];
  await page.route('**/api/ai/conversations**', r => {
    const p = new URL(r.request().url()).pathname;
    return r.fulfill({
      json: {
        data: p.endsWith('/messages')
          ? messages
          : p.includes('/turns/')
            ? turn
            : p.endsWith('/attachments')
              ? { attachments: [] }
              : [conversation]
      }
    });
  });
  const action = {
    actionId: 'action-1',
    requestId: 'synthetic-request',
    status: 'awaitingApproval',
    reviewRequired: true,
    errorCode: null,
    expiresAt: '2030-01-01T00:00:00Z',
    receipt: null,
    plan: {
      planHash: 'synthetic-hash',
      toolName: 'notes_create',
      items: [
        {
          before: null,
          after: {
            id: 'new-note',
            spaceId: 'space-1',
            title: '合成学习计划',
            rawMarkdown:
              '# 一周学习安排\n\n' +
              Array.from({ length: 25 }, (_, i) => `第 ${i + 1} 项：阅读、复习、整理笔记。`).join('\n\n'),
            folderId: null,
            tagIds: []
          }
        }
      ]
    }
  };
  await page.route('**/api/ai/inbox**', r => r.fulfill({ json: { data: [action] } }));
  await page.route('**/api/ai/actions**', r => r.fulfill({ json: { data: [] } }));
  for (const [name, url, ready] of [
    ['home', '/', () => page.getByRole('heading', { name: '笔记工作台' }).waitFor()],
    ['editor', '/#/materials/notes/note-1', () => page.locator('[data-editor-ready="true"]').waitFor()],
    [
      'assistant',
      '/#/assistant?conversationId=conversation-1',
      () => page.getByText('先阅读笔记，再整理重点。').waitFor()
    ]
  ]) {
    await page.goto(`${process.env.CAPTURE_BASE_URL ?? 'http://127.0.0.1:5175'}${url}`);
    await ready();
    await page.screenshot({ path: path.join(output, `${name}-${width}x${height}.png`) });
    measurements.push({
      name,
      width,
      height,
      ...(await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        documentHeight: document.documentElement.scrollHeight,
        windowY: window.scrollY,
        stageWidth: document.querySelector('#feature-stage').getBoundingClientRect().width,
        stageScrollTop: document.querySelector('#feature-stage').scrollTop,
        navRect: (() => {
          const n = document.querySelector('[aria-label="移动端模块导航"]');
          const r = n.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        })(),
        messagesHeight: document.querySelector('[aria-live="polite"]')?.clientHeight
      })))
    });
    if (name === 'assistant' && [390, 768, 1024, 843, 1440].includes(width)) {
      await page.getByRole('button', { name: 'AI 成果收件箱', exact: true }).click();
      await page.getByRole('button', { name: '审阅成果' }).waitFor();
      await page.screenshot({ path: path.join(output, `inbox-${width}x${height}.png`) });
    }
  }
  await context.close();
}
fs.writeFileSync(path.join(output, 'measurements.json'), JSON.stringify(measurements, null, 2) + '\n');
fs.writeFileSync(
  path.join(output, 'source.json'),
  JSON.stringify(
    {
      sourceRoot,
      commit: sourceCommit,
      sourceTree,
      fixtureCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      baseURL: process.env.CAPTURE_BASE_URL,
      browser: await browser.version(),
      capturedAt: new Date().toISOString(),
      sandbox: true
    },
    null,
    2
  ) + '\n'
);
await browser.close();
