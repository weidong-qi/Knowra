import { test } from './fixtures/syntheticTest';
import fs from 'node:fs';
import path from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import { mockEditorWorkspace } from './fixtures/editorWorkspace';
import { mockAssistantWorkspace } from './fixtures/assistantWorkspace';

const viewports = [
  { width: 360, height: 800 }, { width: 390, height: 843 }, { width: 412, height: 915 },
  { width: 768, height: 1024 }, { width: 960, height: 700 }, { width: 1024, height: 768 }, { width: 1024, height: 1366 },
  { width: 1366, height: 1024 }, { width: 843, height: 390 }, { width: 1440, height: 900 }
];
// 每个交互截图附带最终执行源码和结果，不能以旧截图替代当前断言。
test.afterEach(async ({ page, browser, syntheticNetwork }, info) => {
  const screenshotNames = fs.existsSync(info.outputDir) ? fs.readdirSync(info.outputDir).filter(name => name.endsWith('.png')) : [];
  const manifest = { schema: 1, sourcePRHead: process.env.KNOWRA_EVIDENCE_PR_HEAD ?? null,
    builtCommit: process.env.KNOWRA_EVIDENCE_SHA ?? 'local-unverified',
    sourceTree: process.env.KNOWRA_EVIDENCE_SOURCE_TREE ?? null,
    baseCommit: process.env.KNOWRA_EVIDENCE_BASE ?? null, test: info.title, status: info.status,
    shortIndexGeometry: info.annotations.filter(item => item.type === 'short-index-geometry').map(item => JSON.parse(item.description!)),
    touchTargets: info.annotations.filter(item => item.type === 'touch-target').map(item => JSON.parse(item.description!)),
    viewport: page.viewportSize(), syntheticData: true, browserVersion: browser.version(), browserChannel: 'chrome', chromiumSandbox: true, chineseFont: process.env.KNOWRA_EVIDENCE_CJK_FONT ?? null, blockedRequests: syntheticNetwork, screenshots: screenshotNames,
    limitations: ['CSS 触摸视口模拟，不是真实 vivo/OriginOS、实体平板或系统输入法验收'] };
  const output = info.outputPath('scenario-manifest.json');
  fs.writeFileSync(output, JSON.stringify(manifest, null, 2));
  await info.attach('scenario-manifest', { path: output, contentType: 'application/json' });
});

const markdown = '# 手机与平板阅读\n\n合成资料：编辑、保存、返回与长文滚动。\n\n## 重点回顾\n\n' +
  Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 段：保持内容可读，面板独立滚动，核心操作可以触达。`).join('\n\n');

async function expectShellContained(page: Page) {
  const bounds = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth - window.innerWidth,
    height: document.documentElement.scrollHeight - window.innerHeight,
    windowY: window.scrollY, stageY: document.querySelector('#feature-stage')!.scrollTop
  }));
  expect(bounds).toEqual({ width: 0, height: 0, windowY: 0, stageY: 0 });
}
/** 浮层有入场缩放动画；量尺寸前等它结束，避免把 94% 起始缩放当成真实尺寸。 */
async function settleAnimations(locator: Locator) {
  await locator.evaluate((element) => Promise.all(element.ownerDocument.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
}
async function expectTouchTarget(locator: Locator) {
  await settleAnimations(locator);
  const rect = (await locator.boundingBox())!;
  test.info().annotations.push({ type: 'touch-target', description: JSON.stringify({
    label: await locator.getAttribute('aria-label') ?? (await locator.textContent())?.trim(),
    rawWidth: rect.width, rawHeight: rect.height, precision: '0.001 CSS px'
  }) });
  // Chromium 的矩形相减可能返回 43.999984741；只消除千分之一像素内的浮点噪声。
  expect(Number(rect.width.toFixed(3))).toBeGreaterThanOrEqual(44);
  expect(Number(rect.height.toFixed(3))).toBeGreaterThanOrEqual(44);
}
async function expectInViewport(page: Page, locator: Locator) {
  await settleAnimations(locator);
  const rect = (await locator.boundingBox())!;
  const size = page.viewportSize()!;
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.y).toBeGreaterThanOrEqual(0);
  expect(rect.x + rect.width).toBeLessThanOrEqual(size.width + 1);
  expect(rect.y + rect.height).toBeLessThanOrEqual(size.height + 1);
}
async function attachScreenshot(page: Page, name: string) {
  const evidenceDir = process.env.V4_EVIDENCE_DIR;
  const state = { '编辑页初始态': 'editor', '文档检查器': 'inspector', 'AI 长回答': 'conversation',
    '对话附件预览': 'attachment', '成果预览独立滚动': 'artifact', '缩短视口模拟键盘': 'keyboard' }[name] ?? 'state';
  const viewport = page.viewportSize()!;
  if (evidenceDir) fs.mkdirSync(evidenceDir, { recursive: true });
  await test.info().attach(name, { body: await page.screenshot({
    path: evidenceDir ? path.join(evidenceDir, `${state}-${viewport.width}x${viewport.height}.png`) : test.info().outputPath(`${state}-${viewport.width}x${viewport.height}.png`)
  }), contentType: 'image/png' });
}

for (const viewport of viewports) {
  const touch = viewport.width !== 1440;
  const compact = viewport.width <= 1100 || touch;
  const activate = (locator: Locator) => touch ? locator.tap() : locator.click();
  test.describe(`${viewport.width}×${viewport.height} ${touch ? '触摸视口' : '桌面回归'}`, () => {
    test.use({ viewport, hasTouch: touch, isMobile: viewport.width < 768 });
    test('列表到编辑、检查器与长文保存返回', async ({ page }) => {
      const saved: string[] = [];
      await mockEditorWorkspace(page, saved, [], markdown);
      await page.goto('/#/materials');
      const index = page.getByRole('article', { name: '笔记索引', exact: true });
      await expect(index).toBeVisible();
      // 页头显示当前范围，索引模块身份保留在 article 的可访问名称上。
      const scopeTitle = index.locator('header').first().locator('strong');
      await expect(scopeTitle).toHaveText('全部笔记');
      await expect(scopeTitle).toBeVisible();
      await expectShellContained(page);
      const noteButton = index.locator('[data-entry-key="note:note-1"]')
        .getByRole('button', { name: '编辑器验收笔记', exact: true }).and(index.locator('[data-index-primary]'));
      await expect(noteButton).toBeEnabled();
      if (viewport.height <= 560) {
        const content = page.getByTestId('notes-index-scroll');
        expect((await content.boundingBox())!.height, '低高度下索引内容不能被工具栏和分页压没').toBeGreaterThanOrEqual(140);
        await noteButton.scrollIntoViewIfNeeded();
        await expect(noteButton).toBeInViewport({ ratio: 0.95 });
        expect(await noteButton.evaluate(element => {
          const rect = element.getBoundingClientRect();
          const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          return target === element || element.contains(target);
        }), '笔记触摸目标不能被分页或其他固定区域遮挡').toBe(true);
        test.info().annotations.push({ type: 'short-index-geometry', description: JSON.stringify({
          content: await content.boundingBox(), note: await noteButton.boundingBox(),
          footer: await page.getByRole('article', { name: '笔记索引', exact: true }).locator('footer').boundingBox()
        }) });
        const screenshot = test.info().outputPath(`short-index-${viewport.width}x${viewport.height}.png`);
        await page.screenshot({ path: screenshot });
        await test.info().attach('低高度索引可触达', { path: screenshot, contentType: 'image/png' });
      }
      await activate(noteButton);
      await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
      await expectShellContained(page);
      const mobileNav = page.getByRole('navigation', { name: '移动端模块导航' });
      if (viewport.width < 768) {
        const buttons = mobileNav.getByRole('button');
        const names = ['资料', '知识', '试题', '任务', '执行：待办、打卡与习惯追踪。',
          '我的：工作区与个人设置。', 'AI 助手', '设置', '打开全局搜索'];
        await expect(buttons).toHaveCount(names.length);
        for (const [index, name] of names.entries()) {
          await expect(buttons.nth(index)).toHaveAccessibleName(name);
          if (index === 4 || index === 5) await expect(buttons.nth(index)).toBeDisabled();
          else await expect(buttons.nth(index)).toBeEnabled();
        }
        const first = (await buttons.first().boundingBox())!;
        for (const button of await buttons.all()) {
          // 导航自身允许横滚：9 个 44px 触摸目标在 360/390px 不能同时完整显示。
          await button.scrollIntoViewIfNeeded();
          await expectInViewport(page, button); await expectTouchTarget(button);
          expect((await button.boundingBox())!.y).toBe(first.y);
        }
        await expectShellContained(page);
        const sidebarToggle = page.getByRole('button', { name: '切换侧栏', exact: true });
        await activate(sidebarToggle);
        const sidebar = page.getByRole('dialog', { name: '笔记导航', exact: true });
        await expect(sidebar).toBeVisible();
        const closeSidebar = sidebar.getByRole('button', { name: '关闭笔记导航', exact: true });
        await expectInViewport(page, closeSidebar); await expectTouchTarget(closeSidebar);
        await activate(closeSidebar);
        await expect(sidebar).toBeHidden();
        await expect(sidebarToggle).toBeFocused();
        await page.route('**/api/task-workspaces/capabilities', route => route.fulfill({ json: { data: {
          available: false, contractVersion: 1, datasetId: null, datasetEpoch: null,
          images: false, reasonCode: 'SYNTHETIC_UNAVAILABLE'
        } } }));
        const tasks = mobileNav.getByRole('button', { name: '任务', exact: true });
        await tasks.scrollIntoViewIfNeeded(); await activate(tasks);
        await expect(page).toHaveURL(/#\/task-workspaces$/);
        await expect(tasks).toHaveAttribute('aria-current', 'page');
        await expect(page.getByRole('heading', { name: '任务工作区', exact: true })).toBeVisible();
        await expect(page.getByRole('region', { name: '任务工作区', exact: true }).getByRole('status'))
          .toContainText('当前宿主尚未提供任务工作区能力');
        await expect(sidebar).toBeHidden(); await expectShellContained(page);
        const materials = mobileNav.getByRole('button', { name: '资料', exact: true });
        await materials.scrollIntoViewIfNeeded(); await activate(materials);
        await expect(page).toHaveURL(/#\/materials$/);
        await expect(materials).toHaveAttribute('aria-current', 'page');
        await expect(sidebar).toBeHidden();
        await activate(noteButton);
        await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
      }
      await attachScreenshot(page, '编辑页初始态');
      const toolbar = page.getByRole('toolbar', { name: '笔记格式工具栏', exact: true });
      for (const name of ['文件', '段落', '编辑', '格式', '视图']) {
        const button = toolbar.getByRole('button', { name, exact: true });
        if (compact) { await expectInViewport(page, button); await expectTouchTarget(button); }
        await activate(button);
        await expect(page.getByRole('menu', { name, exact: true })).toBeVisible();
        await page.keyboard.press('Escape');
      }
      const inspectorTrigger = page.getByRole('button', { name: compact ? '打开文档检查器' : '切换文档检查器', exact: true });
      await activate(inspectorTrigger);
      const inspector = page.getByRole('complementary', { name: '文档检查器', exact: true });
      await expect(inspector).toBeVisible();
      if (compact) {
        const modal = page.getByRole('dialog', { name: '文档检查器', exact: true });
        await expect(inspector.getByRole('button', { name: '关闭文档检查器' })).toBeFocused();
        for (let i = 0; i < 15; i++) {
          await page.keyboard.press('Tab');
          expect(await modal.evaluate(element => element.contains(document.activeElement))).toBe(true);
        }
        await page.keyboard.press('Escape'); await expect(modal).toBeHidden();
        await expect(inspectorTrigger).toBeFocused();
        await activate(inspectorTrigger); await page.mouse.click(2, 2);
        await expect(modal).toBeHidden(); await expect(inspectorTrigger).toBeFocused();
        await activate(inspectorTrigger);
      } else {
        await expect(page.getByRole('dialog', { name: '文档检查器', exact: true })).toHaveCount(0);
      }
      await expectInViewport(page, inspector.getByRole('button', { name: '关闭文档检查器' }));
      await activate(inspector.getByRole('tab', { name: '信息', exact: true }));
      await attachScreenshot(page, '文档检查器');
      await activate(inspector.getByRole('button', { name: '关闭文档检查器' }));
      await expect(inspector).toBeHidden();
      const editor = page.locator('.ProseMirror');
      await editor.locator('p').first().click({ clickCount: 3 });
      const bold = toolbar.getByRole('button', { name: '加粗', exact: true });
      if (viewport.height === 390) {
        // 短横屏的选区滚动会跨越吸顶临界点；按钮必须连续保持稳定，不能跳过 tap 的可操作性检查。
        const positions = await bold.evaluate(async element => {
          const samples: { x: number; y: number; width: number; height: number }[] = [];
          for (let frame = 0; frame < 12; frame += 1) {
            await new Promise(requestAnimationFrame);
            const { x, y, width, height } = element.getBoundingClientRect();
            samples.push({ x, y, width, height });
          }
          return samples;
        });
        expect(positions.slice(-6)).toEqual(Array(6).fill(positions.at(-1)));
      }
      await activate(bold);
      await expect(editor.locator('strong')).toContainText('合成资料');
      await expect.poll(() => saved.at(-1) ?? '').toContain('**');
      await activate(editor.locator('p').last());
      await page.keyboard.press('End'); await page.keyboard.insertText(' 合成保存验收');
      await expect.poll(() => saved.at(-1) ?? '').toContain('合成保存验收');
      await expect.poll(() => toolbar.getAttribute('data-pinned')).toBe('true');
      await expectShellContained(page);
      const stage = page.locator('[data-editor-scroll-root]');
      expect(await stage.evaluate(element => element.scrollTop)).toBeGreaterThan(100);
      const caretBottom = await editor.evaluate(() => {
        const selection = window.getSelection();
        const range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
        return range?.getBoundingClientRect().bottom ?? 0;
      });
      expect(caretBottom).toBeLessThanOrEqual((await stage.boundingBox())!.y + (await stage.boundingBox())!.height + 2);
      if (compact) {
        await activate(page.getByRole('button', { name: '笔记列表', exact: true }));
        await expect(page).toHaveURL(/#\/materials$/);
        await activate(noteButton);
      } else await page.reload();
      await expect(editor).toContainText('合成保存验收');
      await expectShellContained(page);
    });

    test('AI 对话、附件弹层、成果与返回焦点', async ({ page }) => {
      await mockEditorWorkspace(page, [], [], markdown);
      const mock = await mockAssistantWorkspace(page);
      await page.goto('/#/assistant?conversationId=conversation-1');
      await expect(page.getByText('先阅读笔记，再整理重点。')).toBeVisible();
      await expectShellContained(page);
      const input = page.getByRole('textbox', { name: '消息', exact: true });
      await expectInViewport(page, input);
      if (touch) {
        for (const name of ['发送消息', '更多操作']) {
          const button = page.getByRole('button', { name, exact: true });
          await expectTouchTarget(button); await expectInViewport(page, button);
        }
        const rows = page.getByRole('complementary', { name: '会话历史' }).locator('button[aria-current]');
        for (const row of await rows.all()) if (await row.isVisible()) await expectTouchTarget(row);
      }
      const messages = page.locator('[aria-live="polite"]').filter({ has: page.getByText('先阅读笔记，再整理重点。') });
      expect((await messages.boundingBox())!.height).toBeGreaterThanOrEqual(viewport.height < 500 ? 120 : 250);
      await attachScreenshot(page, 'AI 长回答');
      const attachmentTrigger = page.getByRole('button', { name: '附件（1）', exact: true });
      await activate(attachmentTrigger);
      const dialog = page.getByRole('dialog', { name: '对话附件管理' });
      await expect(dialog).toBeVisible(); await expectInViewport(page, dialog);
      await activate(dialog.getByRole('button', { name: '预览 合成资料.txt' }));
      const preview = dialog.getByRole('region', { name: '附件预览' });
      await expect(preview).toBeVisible(); await expect(preview).toBeFocused();
      await expectInViewport(page, dialog);
      expect(await dialog.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      expect(await dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
      await expectShellContained(page);
      await expectInViewport(page, dialog.getByRole('button', { name: '关闭附件', exact: true }));
      await attachScreenshot(page, '对话附件预览');
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden(); await expect(attachmentTrigger).toBeFocused();
      await activate(attachmentTrigger); await activate(dialog.getByRole('button', { name: '关闭附件', exact: true }));
      await expect(dialog).toBeHidden(); await expect(attachmentTrigger).toBeFocused();
      await activate(attachmentTrigger);
      await page.mouse.click(viewport.width - 2, 2);
      await expect(dialog).toBeHidden();
      await expectShellContained(page);
      const inboxTrigger = page.getByRole('button', { name: 'AI 成果收件箱', exact: true });
      await activate(inboxTrigger);
      const inbox = page.getByRole('complementary', { name: 'AI 成果收件箱', exact: true });
      await activate(inbox.getByRole('button', { name: '审阅成果' }));
      await expect(inbox.getByRole('region', { name: '成果预览' })).toBeVisible();
      await expectShellContained(page);
      const inboxScroll = page.locator('[data-ai-inbox-scroll]');
      await inboxScroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
      await expectInViewport(page, inbox.getByRole('button', { name: '确认采纳到笔记', exact: true }));
      await attachScreenshot(page, '成果预览独立滚动');
      await activate(inbox.getByRole('button', { name: '关闭成果', exact: true }));
      await expect(inbox).toBeHidden(); await expect(inboxTrigger).toBeFocused();
      await expectShellContained(page);
      await input.fill('合成追问'); await activate(page.getByRole('button', { name: '发送消息', exact: true }));
      await expect(page.getByText('合成回答：已记录追问。')).toBeVisible();
      expect(mock.submitted).toEqual([expect.objectContaining({ content: '合成追问', requestedPolicyId: null, execute: true })]);
      await page.reload(); await expect(page.getByText('合成回答：已记录追问。')).toBeVisible();
      if (viewport.width < 768) {
        await activate(page.getByRole('button', { name: '菜单', exact: true }));
        const recent = page.getByRole('dialog', { name: '最近对话' });
        await expect(recent).toBeVisible(); await expectInViewport(page, recent);
        for (const row of await recent.getByRole('button').all()) await expectTouchTarget(row);
        await page.keyboard.press('Escape'); await expect(recent).toBeHidden();
        await activate(page.getByRole('navigation', { name: '移动端模块导航' }).getByRole('button', { name: '资料', exact: true }));
        await expect(page).toHaveURL(/#\/materials$/);
      }
    });
  });
}

test('390px 键盘压缩视口保留消息输入、发送与导航', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 540 });
  await mockEditorWorkspace(page, [], [], markdown); await mockAssistantWorkspace(page);
  await page.goto('/#/assistant?conversationId=conversation-1');
  const input = page.getByRole('textbox', { name: '消息', exact: true });
  await input.fill('键盘视口模拟'); await expect(input).toBeFocused();
  await expectInViewport(page, input); await expectInViewport(page, page.getByRole('button', { name: '发送消息' }));
  await expectShellContained(page); await attachScreenshot(page, '缩短视口模拟键盘');
});

for (const target of ['消息输入区', '附件弹层']) {
  test(`390px ${target}粘贴图片仅保存一次`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 843 });
    await mockEditorWorkspace(page, [], [], markdown); const mock = await mockAssistantWorkspace(page);
    await page.goto('/#/assistant?conversationId=conversation-1');
    await expect(page.getByRole('button', { name: '附件（1）' })).toBeVisible();
    if (target === '附件弹层') await page.getByRole('button', { name: '附件（1）' }).click();
    const element = target === '附件弹层' ? page.getByRole('dialog', { name: '对话附件管理' }) : page.getByRole('textbox', { name: '消息', exact: true });
    await element.evaluate(node => {
      const clipboardData = new DataTransfer();
      clipboardData.items.add(new File(['synthetic image'], 'clipboard.png', { type: 'image/png' }));
      node.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
    });
    await expect(page.getByRole('button', { name: '预览 粘贴图片.png' })).toBeVisible();
    expect(mock.uploads).toEqual([expect.objectContaining({ fileName: '粘贴图片.png', mimeType: 'image/png' })]);
    expect(mock.submitted).toHaveLength(0);
  });
}

test('检查器跨断点保留标签草稿与嵌套 Select，Escape 逐层关闭并回焦', async ({ page }) => {
  await mockEditorWorkspace(page, [], [], markdown);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/#/materials/notes/note-1');
  await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  const opener = page.getByRole('button', { name: '切换文档检查器', exact: true });
  await opener.click();
  const inspector = page.getByRole('complementary', { name: '文档检查器', exact: true });
  await inspector.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByRole('dialog', { name: '编辑笔记标签', exact: true }).getByRole('button', { name: '新建标签', exact: true }).click();
  const draft = page.getByRole('textbox', { name: '标签名称', exact: true });
  await draft.fill('跨断点未保存草稿');
  const child = page.getByRole('dialog', { name: '新建标签', exact: true });
  for (const width of [390, 1280, 390]) {
    await page.setViewportSize({ width, height: 843 });
    await expect(child).toBeVisible(); await expect(draft).toHaveValue('跨断点未保存草稿');
    await page.keyboard.press('Tab');
    expect(await child.evaluate(element => element.contains(document.activeElement))).toBe(true);
    expect(await child.evaluate(element => element.closest('[inert]') === null)).toBe(true);
    expect(await page.locator('.ProseMirror').evaluate(element => element.closest('[inert], [aria-hidden="true"]') !== null)).toBe(true);
  }
  await page.keyboard.press('Escape'); await expect(child).toBeHidden();
  await expect(inspector.getByRole('button', { name: '编辑', exact: true })).toBeFocused();
  await expect(page.getByRole('dialog', { name: '文档检查器', exact: true })).toBeVisible();
  await inspector.getByRole('button', { name: '整理', exact: true }).click();
  const organize = page.getByRole('dialog', { name: '整理笔记', exact: true });
  await organize.getByRole('button', { name: /状态/ }).click();
  const listbox = page.getByRole('listbox');
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 843 });
    await expect(listbox).toBeVisible();
    await page.keyboard.press('ArrowDown');
    expect(await listbox.evaluate(element => element.closest('[inert]') === null)).toBe(true);
  }
  await page.keyboard.press('Escape'); await expect(listbox).toBeHidden(); await expect(organize).toBeVisible();
  await page.keyboard.press('Escape'); await expect(organize).toBeHidden();
  await expect(inspector.getByRole('button', { name: '整理', exact: true })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(inspector).toBeHidden();
  await expect(opener).toBeFocused();
  await expectShellContained(page);
});

test('检查器的重点 Popover 与 Menu 跨断点不被父层遮蔽', async ({ page }) => {
  await mockEditorWorkspace(page, [], [], markdown);
  const annotations = [{ id: 'a-1', spaceId: 'space-1', noteId: 'note-1', noteVersionId: null,
    kind: 'important', importance: 'normal', sourceMode: 'manual', scopeType: 'selection', quoteText: '合成资料',
    headingPath: ['手机与平板阅读'], fromPosition: 11, toPosition: 15, prefixText: '', suffixText: '',
    anchorFingerprint: 'a-1', noteContentHash: 'synthetic', idempotencyKey: 'a-1',
    status: 'active', lifecycleStatus: 'active', anchorStatus: 'resolved', revision: 1 }];
  await page.route('**/api/knowledge/annotations**', route => route.fulfill({ json: { data: annotations } }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/#/materials/notes/note-1');
  await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  const opener = page.getByRole('button', { name: '切换文档检查器', exact: true });
  await opener.click();
  const inspector = page.getByRole('complementary', { name: '文档检查器', exact: true });
  await inspector.getByRole('tab', { name: '标注', exact: true }).click();
  for (const name of ['排序重点', '重点 1 更多操作']) {
    await page.setViewportSize({ width: 1280, height: 900 });
    const trigger = inspector.getByRole('button', { name, exact: true });
    await trigger.click();
    const child = name === '排序重点' ? page.getByRole('dialog', { name, exact: true }) : page.getByRole('menu');
    for (const width of [390, 1280, 390]) {
      await page.setViewportSize({ width, height: 843 });
      await expect(child).toBeVisible();
      await page.keyboard.press(name === '排序重点' ? 'Tab' : 'ArrowDown');
      expect(await child.evaluate(element => element.contains(document.activeElement))).toBe(true);
      expect(await child.evaluate(element => element.closest('[inert]') === null)).toBe(true);
      expect(await page.locator('.ProseMirror').evaluate(element => element.closest('[inert], [aria-hidden="true"]') !== null)).toBe(true);
    }
    await page.keyboard.press('Escape'); await expect(child).toBeHidden(); await expect(trigger).toBeFocused();
    await expect(page.getByRole('dialog', { name: '文档检查器', exact: true })).toBeVisible();
  }
  await page.keyboard.press('Escape'); await expect(inspector).toBeHidden();
  await expect(opener).toBeFocused();
});
