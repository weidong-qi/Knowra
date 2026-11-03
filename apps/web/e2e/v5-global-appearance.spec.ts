import { test } from './fixtures/syntheticTest';
import { expect } from '@playwright/test';
import { createNote, mockEditorWorkspace } from './fixtures/editorWorkspace';

test('全局定稿外观跨页面和浮层生效，明暗切换在刷新后保留', async ({ page }, info) => {
  await mockEditorWorkspace(page, []);
  await page.route('**/api/ai/model-settings', route => route.fulfill({ json: { data: { configured: false, modelId: 'deepseek-flash', modelSupported: true, supportedModelIds: ['deepseek-flash'] } } }));
  await page.addInitScript(() => {
    if (!localStorage.getItem('knowra:notes-index-appearance:v1')) {
      localStorage.setItem('knowra:notes-index-appearance:v1', JSON.stringify({ mode: 'light', theme: 'mono', shape: 'rounded', deco: 'off' }));
    }
  });
  await page.goto('/');
  const shell = page.locator('[data-ni-mode]:has(> #feature-stage)');
  const mode = page.getByRole('button', { name: '切换深色模式' });
  await expect(mode).toBeVisible();
  for (const name of ['素', '完整', '圆角', '胶囊', '黑白配色', '橙色配色']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  await mode.click();
  for (const route of ['/', '/materials', '/materials/notes/note-1', '/knowledge', '/training', '/settings']) {
    await page.goto(`/#${route}`);
    await expect(shell).toHaveAttribute('data-ni-mode', 'dark');
    await expect(shell).toHaveAttribute('data-ni-shape', 'pill');
    await expect(shell).not.toHaveAttribute('data-ni-deco');
    await expect(shell).toHaveAttribute('data-ni-theme', 'orange');
    await expect(page.getByRole('button', { name: '切换浅色模式' })).toBeVisible();
    await expect(page.locator('#feature-stage')).toHaveCSS('background-color', 'rgb(24, 25, 29)');
    const radius = await shell.evaluate(element => getComputedStyle(element).getPropertyValue('--radius-control').trim());
    expect(radius).toBe('7px');
  }
  await page.reload();
  await expect(shell).toHaveAttribute('data-ni-mode', 'dark');
  await page.screenshot({ path: info.outputPath('settings-dark.png'), animations: 'disabled' });
  await page.goto('/#/materials');
  const create = page.getByRole('article', { name: '笔记索引' }).getByRole('toolbar', { name: '笔记索引工具栏' }).getByRole('button', { name: '新建', exact: true });
  await create.click();
  const menu = page.getByRole('menu', { name: '新建', exact: true });
  await expect(menu).toBeVisible();
  await expect(menu.locator('..')).toHaveAttribute('data-ni-mode', 'dark');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(create).toBeFocused();
  await page.getByRole('button', { name: '切换浅色模式' }).click();
  await expect(shell).toHaveAttribute('data-ni-mode', 'light');
  await expect(page.locator('#feature-stage')).toHaveCSS('background-color', 'rgb(254, 254, 254)');
  await page.screenshot({ path: info.outputPath('notes-light.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: '切换深色模式' })).toBeVisible();
});

test('默认图标布局与卡片文件夹按原型展示，类型筛选收进显示选项', async ({ page }, info) => {
  await mockEditorWorkspace(page, []);
  const folders = ['工作', '灵感箱', '学习资料', '生活'].map((name, index) => ({ id: `folder-${index + 1}`, name, parentId: null, children: [] }));
  const notes = [14, 7, 10, 3].flatMap((count, index) => Array.from({ length: count }, (_, number) => createNote('', false, `note-${index}-${number}`, `资料 ${index + 1}-${number + 1}`, folders[index].id)));
  await page.route(url => url.pathname === '/api/knowledge/folders/tree', route => route.fulfill({ json: { data: folders } }));
  await page.route(url => url.pathname === '/api/knowledge/notes', route => route.fulfill({ json: { data: notes } }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/materials');
  const index = page.getByRole('article', { name: '笔记索引' });
  const toolbar = index.getByRole('toolbar', { name: '笔记索引工具栏' });
  await expect(toolbar.getByRole('button', { name: '图标视图' })).toHaveAttribute('aria-pressed', 'true');
  await expect(toolbar.getByRole('button', { name: '图标视图' })).toHaveCSS('min-height', '22px');
  await toolbar.getByRole('button', { name: /^显示选项/ }).click();
  await page.getByRole('group', { name: '类型' }).getByRole('button', { name: /^文件夹/ }).click();
  await page.keyboard.press('Escape');
  await expect(index.locator('[data-entry-item]')).toHaveCount(4);
  await expect(index.locator('[data-folder-style="illustrated"]')).toHaveCount(4);
  await expect(index.locator('[data-kind="folder"]').filter({ hasText: '工作' }).locator('[data-folder-paper]')).toHaveCount(3);
  const heading = index.getByRole('button', { name: /^文件夹\s*4$/ });
  await expect(heading.locator('span > i')).toHaveCount(0);
  await heading.click();
  await expect(index.locator('[data-entry-item]')).toHaveCount(0);
  await heading.click();
  await page.screenshot({ path: info.outputPath('folder-icons.png'), animations: 'disabled' });
  await toolbar.getByRole('button', { name: '卡片视图' }).click();
  const badge = index.locator('[data-folder-style="badge"]');
  await expect(badge).toHaveCount(4);
  await expect(badge.first()).toHaveCSS('width', '40px');
  await expect(badge.first()).toHaveCSS('border-radius', '12px');
  await page.screenshot({ path: info.outputPath('folder-cards.png'), animations: 'disabled' });
  await page.getByRole('button', { name: '切换深色模式' }).click();
  await expect(badge.first()).toHaveCSS('color', 'rgb(242, 107, 29)');
  await page.screenshot({ path: info.outputPath('folder-cards-dark.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  // 窄屏：标题与工具合为一行，类型筛选与布局切换收进“显示选项”。
  const displayOptions = toolbar.getByRole('button', { name: /^显示选项/ });
  await expect(displayOptions).toHaveCSS('min-height', '44px');
  await expect(badge.first()).toBeInViewport();
  await page.screenshot({ path: info.outputPath('folder-cards-mobile.png'), animations: 'disabled' });
  await page.reload();
  await toolbar.getByRole('button', { name: /^显示选项/ }).click();
  await expect(page.getByRole('group', { name: '类型' }).getByRole('button', { name: /^全部/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('group', { name: '布局' }).getByRole('button', { name: '图标' })).toHaveAttribute('aria-pressed', 'true');
});

test('热力图随标签区域滚动，桌面和窄屏新建入口保持尺寸及完整菜单', async ({ page }, info) => {
  await mockEditorWorkspace(page, []);
  await page.route(url => url.pathname === '/api/knowledge/folders/tree', route => route.fulfill({ json: { data: Array.from({ length: 30 }, (_, index) => ({ id: `folder-${index + 1}`, name: `目录 ${index + 1}`, parentId: null, children: [] })) } }));
  await page.setViewportSize({ width: 1440, height: 700 });
  await page.goto('/#/materials');
  const sidebar = page.getByRole('complementary', { name: '笔记上下文导航' });
  const distribution = sidebar.getByRole('region', { name: '已加载笔记 · 最近更新时间分布' });
  const scroll = sidebar.locator('[class*="scrollBody"]');
  const trash = sidebar.getByRole('button', { name: /回收站/ });
  await expect(distribution).toHaveCount(1);
  await expect(sidebar.getByRole('treeitem')).toHaveCount(30);
  const position = await distribution.boundingBox();
  const trashBefore = await trash.boundingBox();
  await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
  const moved = await distribution.boundingBox();
  expect(position!.y - moved!.y).toBeGreaterThan(100);
  expect((await trash.boundingBox())!.y).toBe(trashBefore!.y);
  await expect(distribution).toBeInViewport();
  await page.screenshot({ path: info.outputPath('sidebar-scroll.png') });
  for (const { width, targetSize } of [{ width: 1440, targetSize: 30 }, { width: 390, targetSize: 44 }]) {
    await page.setViewportSize({ width, height: 844 });
    const toolbar = page.getByRole('article', { name: '笔记索引' }).getByRole('toolbar', { name: '笔记索引工具栏' });
    const create = toolbar.getByRole('button', { name: '新建', exact: true });
    await expect(create).toBeVisible();
    const box = await create.boundingBox();
    expect(box!.width).toBe(targetSize);
    expect(box!.height).toBe(targetSize);
    await create.click();
    const menu = page.getByRole('menu', { name: '新建', exact: true });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem')).toHaveText(['新建笔记', '新建文件夹', '导入 Markdown']);
    for (const name of ['新建笔记', '新建文件夹', '导入 Markdown']) {
      await expect(menu.getByRole('menuitem', { name, exact: true })).toBeEnabled();
    }
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(create).toBeFocused();
    // 关闭后仍可通过键盘重新打开，不遗留失效触发器或焦点。
    await page.keyboard.press('Space');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(create).toBeFocused();
  }
});

for (const { label, hasTouch, viewport } of [
  { label: '窄屏', hasTouch: false, viewport: { width: 390, height: 844 } },
  { label: '宽屏触屏', hasTouch: true, viewport: { width: 1024, height: 900 } }
]) {
  test.describe(`${label}共享图标按钮`, () => {
    // 复用 fixture context，确保 syntheticNetwork 的请求和 WebSocket 隔离始终生效。
    test.use({ hasTouch, viewport });
    test('保留44px点击区域', async ({ page }) => {
      await mockEditorWorkspace(page, []);
      await page.goto('/#/materials');
      const index = page.getByRole('article', { name: '笔记索引' });
      for (const button of [
        index.getByRole('button', { name: '筛选', exact: true }),
        index.getByRole('button', { name: /^显示选项/ }),
        index.getByRole('button', { name: '上一页', exact: true }),
        index.getByRole('button', { name: '下一页', exact: true })
      ]) {
        await expect(button).toBeVisible();
        const box = await button.boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
    });
  });
}

test('强制色保留页签和表单焦点，错误字段继续报告校验错误', async ({ page }) => {
  await mockEditorWorkspace(page, []);
  await page.goto('/#/showcase');
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.keyboard.press('Tab');
  const title = page.getByRole('textbox', { name: '标题', exact: true });
  const invalid = page.getByRole('textbox', { name: '路径', exact: true });
  const search = page.getByRole('searchbox', { name: '搜索', exact: true });
  const select = page.getByRole('button', { name: /排序方式/ });
  const tab = page.getByRole('tab', { name: '概览', exact: true });
  for (const control of [title, invalid, search, select, tab]) {
    await control.focus();
    await expect(control).toBeFocused();
    const ring = control === title || control === invalid || control === search ? control.locator('..') : control;
    await expect(ring).toHaveCSS('outline-style', 'solid');
    await expect(ring).toHaveCSS('outline-width', '2px');
  }
  await expect(invalid).toHaveAttribute('aria-invalid', 'true');
  await expect(invalid).toHaveAccessibleDescription(/路径已被占用/);
});

for (const mode of ['light', 'dark']) {
  for (const [buttonStyle, defaultButtonStyle] of [['paper', 'soft'], ['frost', 'glass']]) {
    test(`${mode} ${buttonStyle}/${defaultButtonStyle}：按钮材质不覆盖禁用反馈`, async ({ page }) => {
      await mockEditorWorkspace(page, []);
      await page.addInitScript(appearance => {
        localStorage.setItem('knowra:notes-index-appearance:v1', JSON.stringify(appearance));
      }, { mode, buttonStyle, defaultButtonStyle });
      await page.goto('/#/showcase');
      const shell = page.locator('[data-ni-mode]:has(> #feature-stage)');
      await expect(shell).toHaveAttribute('data-button-style', buttonStyle);
      await expect(shell).toHaveAttribute('data-default-button-style', defaultButtonStyle);
      for (const name of ['默认', '保存']) {
        const button = page.getByRole('button', { name, exact: true, disabled: true });
        await expect(button).toBeDisabled();
        await expect(button).toHaveCSS('box-shadow', 'none');
        await expect(button).toHaveCSS('opacity', '0.65');
        await expect(button).toHaveCSS('cursor', 'not-allowed');
        const colors = await button.evaluate(element => {
          const computed = getComputedStyle(element);
          const probe = document.createElement('span');
          probe.style.cssText = 'color:var(--text-muted);background:var(--surface-hover);border:1px solid var(--border-subtle)';
          element.append(probe);
          const neutral = getComputedStyle(probe);
          const result = {
            actual: [computed.color, computed.backgroundColor, computed.borderTopColor],
            expected: [neutral.color, neutral.backgroundColor, neutral.borderTopColor]
          };
          probe.remove();
          return result;
        });
        expect(colors.actual).toEqual(colors.expected);
      }
      // 同一外观下启用按钮仍保留材质投影，防止用全局移除样式掩盖问题。
      await expect(page.getByRole('button', { name: '默认胶囊', exact: true })).not.toHaveCSS('box-shadow', 'none');
      await expect(page.getByRole('button', { name: '发布', exact: true })).not.toHaveCSS('box-shadow', 'none');
    });
  }
}
