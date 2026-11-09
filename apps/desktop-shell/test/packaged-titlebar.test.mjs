import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createExitDiagnostics, prepareExitDiagnostics } from './exit-diagnostics.mjs';
import { test } from 'node:test';
import { _electron as electron, expect } from '@playwright/test';
import { executablePath } from './packaged-app-path.mjs';
import { closeTestApplication, launchTestApplication } from './app-lifecycle.mjs';

// 诊断额外调用各自有界；总测试预算预留采集时间，正常退出仍严格等待45秒。
test('Mac V5 顶栏跨模块保留笔记标签与原生窗口拖动区域', { timeout: 75000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-titlebar-'));
  let app = await launchTestApplication(electron, {
    executablePath,
    env: { ...process.env, KNOWRA_DESKTOP_SMOKE_DIR: directory },
    timeout: 20000
  });
  let diagnostics;
  t.after(async () => {
    try {
      await closeTestApplication(app);
    } finally {
      try {
        diagnostics?.afterCleanup();
      } catch {
        console.error('[Mac 诊断] 清理后诊断不可用；保留原测试结果。');
      }
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const notes = await page.evaluate(async () => {
    const space = (
      await (
        await fetch('/api/knowledge/spaces/default', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}'
        })
      ).json()
    ).data;
    const created = [];
    for (const title of [
      '标题栏验收笔记',
      '第二篇笔记',
      ...Array.from({ length: 5 }, (_, index) => `溢出标签 ${index + 3}`)
    ]) {
      created.push(
        (
          await (
            await fetch('/api/knowledge/notes', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ spaceId: space.id, title, rawMarkdown: '正文' })
            })
          ).json()
        ).data
      );
    }
    return created;
  });
  assert.equal(notes.length, 7);
  await page.reload();
  // 首页只展示少量最近笔记；经左栏「资料」打开笔记列表以定位精确夹具，保留真实UI导航。
  await page.getByRole('navigation', { name: '工作域导航' }).getByRole('button', { name: '资料', exact: true }).click();
  await page
    .getByRole('article', { name: '笔记索引', exact: true })
    .locator(`[data-entry-key="note:${notes[0].id}"]`)
    .locator('button[data-index-primary]')
    .click();

  const titlebar = page.getByLabel('Mac 窗口标题栏');
  const tabs = titlebar.getByRole('tablist', { name: '打开的笔记' });
  const assertNativeTitlebar = async () => {
    await expect(titlebar).toBeVisible();
    // 紧凑顶栏的设计高度为 42px；同时检查真实控件边界，避免仅改高度掩盖裁切。
    assert.equal(Math.round((await titlebar.boundingBox()).height), 42);
    assert(
      await titlebar.evaluate(element => parseFloat(getComputedStyle(element).paddingLeft) >= 92),
      '顶栏为原生窗口按钮保留至少 92px 空间'
    );
    assert.equal(
      await titlebar.evaluate(element => getComputedStyle(element).getPropertyValue('-webkit-app-region')),
      'drag'
    );
    assert.equal(
      await titlebar
        .locator('[aria-label="工作区操作"]')
        .evaluate(element => getComputedStyle(element).getPropertyValue('-webkit-app-region')),
      'no-drag'
    );
    const controls = await titlebar.evaluate(element => {
      const bar = element.getBoundingClientRect();
      return [...element.querySelectorAll('[aria-label="浏览历史"] button, [aria-label="工作区操作"] button')].map(
        button => {
          const bounds = button.getBoundingClientRect();
          const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
          return {
            label: button.getAttribute('aria-label'),
            withinTitlebar:
              bounds.width > 0 &&
              bounds.height > 0 &&
              bounds.top >= bar.top &&
              bounds.bottom <= bar.bottom &&
              bounds.left >= bar.left + 92 &&
              bounds.right <= bar.right,
            receivesPointer: button.disabled || button === hit || button.contains(hit)
          };
        }
      );
    });
    assert(controls.length > 0, '顶栏保留历史导航和工作区操作');
    for (const control of controls) {
      assert(control.withinTitlebar, `${control.label} 完整位于紧凑顶栏内，且不侵入原生窗口按钮区`);
      assert(control.receivesPointer, `${control.label} 中心命中可点击控件`);
    }
  };
  await expect(tabs.getByRole('tab', { name: '标题栏验收笔记' })).toBeVisible();
  await expect(page.getByLabel('笔记编辑页面骨架')).toHaveAttribute('data-window-tabs', 'true');
  await assertNativeTitlebar();
  const skipLink = page.getByRole('link', { name: '跳到主内容' });
  assert(await skipLink.evaluate(element => element.getBoundingClientRect().bottom <= 0));
  await skipLink.focus();
  const titlebarBounds = await titlebar.boundingBox();
  assert((await skipLink.boundingBox()).y >= titlebarBounds.y + titlebarBounds.height);
  await skipLink.press('Enter');
  await expect(page.locator('#feature-stage')).toBeFocused();
  await expect.poll(() => skipLink.evaluate(element => element.getBoundingClientRect().bottom)).toBeLessThanOrEqual(0);
  assert((await tabs.boundingBox()).x >= 92);
  assert.equal(
    await tabs
      .getByRole('tab', { name: '标题栏验收笔记' })
      .evaluate(element => getComputedStyle(element).getPropertyValue('-webkit-app-region')),
    'no-drag'
  );
  await expect(tabs.getByRole('button', { name: '查看全部标签页', exact: true })).toHaveCount(0);
  await expect(tabs.getByRole('button', { name: '新建笔记' })).toBeVisible();
  await expect(page.locator('.ProseMirror')).toContainText('正文');

  await page.getByRole('button', { name: '知境工作区' }).click();
  // 首页只展示少量最近笔记；经左栏「资料」打开笔记列表以定位精确夹具，保留真实UI导航。
  await page.getByRole('navigation', { name: '工作域导航' }).getByRole('button', { name: '资料', exact: true }).click();
  await page
    .getByRole('article', { name: '笔记索引', exact: true })
    .locator(`[data-entry-key="note:${notes[1].id}"]`)
    .locator('button[data-index-primary]')
    .click();
  await expect(tabs.getByRole('tab', { name: '第二篇笔记' })).toBeVisible();
  await tabs.getByRole('tab', { name: '标题栏验收笔记' }).click();
  await expect(tabs.getByRole('tab', { name: '标题栏验收笔记' })).toHaveAttribute('aria-selected', 'true');
  const secondIndex = await tabs
    .getByRole('tab')
    .evaluateAll(elements => elements.findIndex(element => element.getAttribute('aria-label') === '第二篇笔记'));
  await tabs.getByRole('tab', { name: '第二篇笔记' }).click({ button: 'right' });
  await expect(page.getByRole('menu', { name: '第二篇笔记' })).toBeVisible();
  await page.getByRole('menuitem', { name: secondIndex > 0 ? '向左移动标签' : '向右移动标签' }).click();
  await expect(tabs.getByRole('tab').nth(secondIndex > 0 ? secondIndex - 1 : secondIndex + 1)).toHaveAttribute(
    'aria-label',
    '第二篇笔记'
  );
  const draggedName = await tabs.getByRole('tab').first().getAttribute('aria-label');
  await tabs.locator('[draggable="true"]').first().dragTo(tabs.locator('[draggable="true"]').last());
  await expect(tabs.getByRole('tab').last()).toHaveAttribute('aria-label', draggedName);

  for (const item of notes.slice(2)) {
    await page.evaluate(id => {
      location.hash = `/materials/notes/${id}`;
    }, item.id);
    await expect(tabs.getByRole('tab', { name: item.title })).toBeVisible();
  }

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 700));
  await expect.poll(async () => (await titlebar.boundingBox()).width).toBe(960);
  await expect(tabs.getByRole('tab')).toHaveCount(7);
  // “全部标签页”只在真实溢出时显示；等待960px布局与ResizeObserver完成。
  await expect
    .poll(() => tabs.evaluate(element => element.firstElementChild.scrollWidth - element.firstElementChild.clientWidth))
    .toBeGreaterThan(1);
  const allTabs = tabs.getByRole('button', { name: '查看全部标签页', exact: true });
  await expect(allTabs).toBeVisible();
  await allTabs.click();
  const allTabsMenu = page.getByRole('menu', { name: '查看全部标签页', exact: true });
  await expect(allTabsMenu).toBeVisible();
  const orderedTitles = await tabs
    .getByRole('tab')
    .evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')));
  const orderedLabels = orderedTitles.map((title, index) => `${String(index + 1).padStart(2, '0')} · ${title}`);
  // 可见标签名称与隐藏的读屏状态说明分别验收。
  await expect(allTabsMenu.getByRole('menuitem')).toHaveText(orderedLabels, { useInnerText: true });
  const currentTitle = await tabs.getByRole('tab', { selected: true }).getAttribute('aria-label');
  const currentItem = allTabsMenu.getByRole('menuitem', {
    name: orderedLabels[orderedTitles.indexOf(currentTitle)],
    exact: true
  });
  await expect(currentItem).toHaveAttribute('data-active', 'true');
  await expect(currentItem).toHaveAccessibleDescription('当前已启用');
  await page.keyboard.press('Escape');
  await expect(allTabsMenu).toBeHidden();
  await expect(allTabs).toBeFocused();
  await page.getByRole('button', { name: '切换检查器' }).click();
  const inspector = page.getByRole('complementary', { name: '文档检查器' });
  await expect(inspector).toBeVisible();
  await expect(page.getByRole('dialog', { name: '文档检查器', exact: true })).toHaveCount(0);
  t.diagnostic(
    `原生窄窗检查器：${JSON.stringify(await page.evaluate(() => ({ width: innerWidth, height: innerHeight, coarsePointer: matchMedia('(any-pointer: coarse)').matches })))}`
  );
  assert((await inspector.boundingBox()).y >= (await titlebar.boundingBox()).height);
  const editorRegion = await page.locator('[data-editor-scroll-root]').boundingBox();
  assert(
    editorRegion.x + editorRegion.width <= (await inspector.boundingBox()).x + 1,
    '960px 原生编辑区与检查器保持并排'
  );
  await page.getByRole('button', { name: '切换专注模式' }).click();
  await expect(tabs).toBeVisible();
  await expect(page.getByRole('navigation', { name: '工作域导航' })).toHaveCount(0);
  await page.getByRole('button', { name: '切换专注模式' }).click();

  await tabs.getByRole('button', { name: '新建笔记' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setFullScreen(true));
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen()))
    .toBe(true);
  await expect(tabs).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setFullScreen(false));
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen()))
    .toBe(false);

  await page.locator('.ProseMirror').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText(' 关闭前保存');
  await tabs.getByRole('button', { name: '关闭溢出标签 7' }).click();
  await expect(tabs.getByRole('tab', { name: '溢出标签 7' })).toHaveCount(0);
  const saved = await page.evaluate(
    async id => (await (await fetch(`/api/knowledge/notes/${id}`)).json()).data.rawMarkdown,
    notes.at(-1).id
  );
  assert(saved.includes('关闭前保存'));

  await page.getByRole('button', { name: '知境工作区' }).click();
  await assertNativeTitlebar();
  await expect(tabs).toBeVisible();
  await expect(tabs.getByRole('tab')).toHaveCount(6);
  await expect(tabs.getByRole('tab', { selected: true })).toHaveCount(0);
  await page.getByRole('button', { name: '知识', exact: true }).click();
  await assertNativeTitlebar();
  await expect(tabs).toBeVisible();
  await expect(tabs.getByRole('tab')).toHaveCount(6);
  await expect(tabs.getByRole('tab', { selected: true })).toHaveCount(0);
  await page.getByRole('button', { name: '账户与设置', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  await assertNativeTitlebar();
  await expect(tabs).toBeVisible();
  await expect(tabs.getByRole('tab')).toHaveCount(6);
  await expect(tabs.getByRole('tab', { selected: true })).toHaveCount(0);
  assert.equal(
    await tabs
      .getByRole('tab', { name: '标题栏验收笔记' })
      .evaluate(element => getComputedStyle(element).getPropertyValue('-webkit-app-region')),
    'no-drag'
  );
  await tabs.getByRole('tab', { name: '标题栏验收笔记' }).click();
  await expect(page.getByLabel('笔记编辑页面骨架')).toBeVisible();
  await page.getByRole('button', { name: '知境工作区' }).click();
  await tabs.getByRole('tab', { name: '标题栏验收笔记' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '关闭其他标签页' }).click();
  await expect(tabs.getByRole('tab')).toHaveCount(1);
  await tabs.locator('[draggable="true"]').hover();
  await tabs.getByRole('button', { name: '关闭标题栏验收笔记' }).click();
  await expect(titlebar.getByRole('tablist', { name: '打开的笔记' })).toHaveCount(0);
  await expect(titlebar.getByText('知境', { exact: true })).toBeVisible();
  await assertNativeTitlebar();
  // 与已合并的原生菜单验收相同：显式触发正常退出，并验证保存握手完成。
  diagnostics = await prepareExitDiagnostics(() =>
    createExitDiagnostics(
      app,
      page,
      directory,
      fileURLToPath(new URL('../../../test-results/mac-titlebar-exit/', import.meta.url))
    )
  );
  const closed = app.waitForEvent('close', { timeout: 45000 });
  try {
    await app.evaluate(({ app: nativeApp }) => nativeApp.quit());
    await closed;
  } catch (error) {
    try {
      await diagnostics?.onFailure();
    } catch {
      console.error('[Mac 诊断] 退出失败现场采集未完成；保留原退出错误。');
    }
    throw error;
  }
  app = null;
});
