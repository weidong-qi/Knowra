import { test } from './fixtures/syntheticTest';
import { expect, type Locator } from '@playwright/test';
import { createNote, mockEditorWorkspace } from './fixtures/editorWorkspace';

async function selectedControlContrast(locator: Locator, thumb = false) {
  return locator.evaluate((element, isThumb) => {
    const luminance = (color: string) => {
      const channels = color
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number);
      return channels.reduce((sum, value, index) => {
        const channel = value / 255;
        const linear = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        return sum + linear * [0.2126, 0.7152, 0.0722][index];
      }, 0);
    };
    const style = getComputedStyle(element);
    const foreground = luminance(isThumb ? style.backgroundColor : style.color);
    const background = luminance(
      isThumb ? getComputedStyle(element.parentElement!).backgroundColor : style.backgroundColor
    );
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  }, thumb);
}

for (const mode of ['light', 'dark'] as const) {
  test(`${mode} 强调底色上的标签勾选保持可见`, async ({ page }) => {
    await mockEditorWorkspace(page, []);
    await page.addInitScript(value => {
      localStorage.setItem('knowra:notes-index-appearance:v1', JSON.stringify({ mode: value }));
    }, mode);
    await page.goto('/#/materials');
    await page.getByRole('button', { name: '筛选', exact: true }).click();
    await page.getByRole('menu', { name: '筛选维度' }).getByRole('menuitem', { name: /^标签/ }).click();
    const tag = page.getByRole('menu', { name: '标签', exact: true }).getByRole('menuitemcheckbox', { name: /^学习/ });
    await tag.click();
    await expect(tag).toHaveAttribute('aria-checked', 'true');
    const box = tag.locator('[class*="box"][data-checked]');
    await expect(box.locator('svg')).toBeVisible();
    await expect.poll(() => selectedControlContrast(box)).toBeGreaterThanOrEqual(3);
  });

  test(`${mode} 强调底色上的显示开关圆点保持可见`, async ({ page }) => {
    await mockEditorWorkspace(page, []);
    await page.addInitScript(value => {
      localStorage.setItem('knowra:notes-index-appearance:v1', JSON.stringify({ mode: value }));
    }, mode);
    await page.goto('/#/materials');
    await page.getByRole('button', { name: /^显示选项/ }).click();
    const toggle = page
      .getByRole('dialog', { name: '索引显示选项' })
      .getByRole('switch', { name: '标签', exact: true });
    if (!(await toggle.isChecked())) await toggle.click();
    await expect(toggle).toBeChecked();
    const thumb = toggle.locator('xpath=ancestor::label').locator('[class*="switchThumb"]');
    await expect(thumb).toBeVisible();
    await expect.poll(() => selectedControlContrast(thumb, true)).toBeGreaterThanOrEqual(3);
  });
}

for (const mode of ['light', 'dark'] as const) {
  test(`笔记侧栏快速入口和文件夹在${mode === 'light' ? '浅色' : '深色'}模式显示主题选中卡片`, async ({
    page
  }, testInfo) => {
    await mockEditorWorkspace(page, []);
    await page.addInitScript(
      mode => localStorage.setItem('knowra:notes-index-appearance:v1', JSON.stringify({ mode })),
      mode
    );
    await page.goto('/#/materials');
    const sidebar = page.getByRole('complementary', { name: '笔记上下文导航' });
    const allNotes = sidebar.getByRole('button', { name: /全部笔记/ });
    await allNotes.click();
    await expect(allNotes).toHaveAttribute('aria-current', 'page');
    const folder = sidebar.locator('[data-folder-id="folder-1"]');
    for (const entry of [allNotes, folder]) {
      if (entry === folder) await folder.click();
      await expect(entry).toHaveAttribute('aria-current', 'page');
      if (mode === 'light') {
        await expect(entry).toHaveCSS('background-color', 'rgb(255, 255, 255)');
        await expect(entry).toHaveCSS('background-image', 'none');
      } else {
        await expect(entry).toHaveCSS('background-image', /linear-gradient/);
      }
      await expect(entry).not.toHaveCSS('box-shadow', 'none');
    }
    await page.screenshot({ path: testInfo.outputPath(`侧栏选中态-${mode}.png`), animations: 'disabled' });
  });
}

test('全局定稿外观跨页面和浮层生效，明暗切换在刷新后保留', async ({ page }, info) => {
  await mockEditorWorkspace(page, []);
  await page.route('**/api/ai/model-settings', route =>
    route.fulfill({
      json: {
        data: {
          configured: false,
          modelId: 'deepseek-flash',
          modelSupported: true,
          supportedModelIds: ['deepseek-flash']
        }
      }
    })
  );
  await page.addInitScript(() => {
    if (!localStorage.getItem('knowra:notes-index-appearance:v1')) {
      localStorage.setItem(
        'knowra:notes-index-appearance:v1',
        JSON.stringify({ mode: 'light', theme: 'mono', shape: 'rounded', deco: 'off' })
      );
    }
  });
  await page.goto('/');
  const shell = page.locator('[data-ni-mode]:has(> #feature-stage)');
  const mode = page.getByRole('button', { name: '切换深色模式' });
  await expect(mode).toBeVisible();
  const skip = page.getByRole('link', { name: '跳到主内容', exact: true });
  await skip.focus();
  await expect(skip).toBeFocused();
  await expect(skip).toHaveCSS('outline-style', 'solid');
  await expect(skip).toHaveCSS('outline-width', '2px');
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
    await expect(page.locator('#feature-stage')).toHaveCSS('background-color', 'rgb(26, 28, 32)');
    const radius = await shell.evaluate(element =>
      getComputedStyle(element).getPropertyValue('--radius-control').trim()
    );
    expect(radius).toBe('6px');
  }
  await page.getByRole('button', { name: '暖橙', exact: true }).click();
  await expect(shell).toHaveAttribute('data-accent-color', 'orange');
  expect(await shell.evaluate(element => getComputedStyle(element).getPropertyValue('--brand-base-dark').trim())).toBe(
    '#f08346'
  );
  await page.reload();
  await expect(shell).toHaveAttribute('data-ni-mode', 'dark');
  await expect(page.getByRole('button', { name: '暖橙', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '预览对话框', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建文件夹', exact: true });
  await expect(dialog.locator('xpath=ancestor::*[@data-accent-color][1]')).toHaveAttribute(
    'data-accent-color',
    'orange'
  );
  const folderName = dialog.getByRole('textbox', { name: '文件夹名称' });
  const inputShell = dialog.locator('[class*="inputShell"]');
  await folderName.focus();
  await expect(folderName).toBeFocused();
  await expect(inputShell).not.toHaveCSS('box-shadow', 'none');
  await page.emulateMedia({ forcedColors: 'active' });
  await expect(inputShell).toHaveCSS('outline-style', 'solid');
  await expect(inputShell).toHaveCSS('outline-width', '2px');
  await page.emulateMedia({ forcedColors: 'none' });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.screenshot({ path: info.outputPath('settings-dark.png'), animations: 'disabled' });
  await page.goto('/#/materials');
  const create = page
    .getByRole('article', { name: '笔记索引' })
    .getByRole('toolbar', { name: '笔记索引工具栏' })
    .getByRole('button', { name: '新建', exact: true });
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
  await page.route('**/api/ai/model-settings', route =>
    route.fulfill({
      json: {
        data: {
          configured: false,
          modelId: 'deepseek-flash',
          modelSupported: true,
          supportedModelIds: ['deepseek-flash']
        }
      }
    })
  );
  const folders = ['工作', '灵感箱', '学习资料', '生活'].map((name, index) => ({
    id: `folder-${index + 1}`,
    name,
    parentId: null,
    children: []
  }));
  const notes = [14, 7, 10, 3].flatMap((count, index) =>
    Array.from({ length: count }, (_, number) =>
      createNote('', false, `note-${index}-${number}`, `资料 ${index + 1}-${number + 1}`, folders[index].id)
    )
  );
  await page.route(
    url => url.pathname === '/api/knowledge/folders/tree',
    route => route.fulfill({ json: { data: folders } })
  );
  await page.route(
    url => url.pathname === '/api/knowledge/notes',
    route => route.fulfill({ json: { data: notes } })
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/materials');
  const index = page.getByRole('article', { name: '笔记索引' });
  const toolbar = index.getByRole('toolbar', { name: '笔记索引工具栏' });
  await expect(toolbar.getByRole('button', { name: '图标视图' })).toHaveAttribute('aria-pressed', 'true');
  await expect(toolbar.getByRole('button', { name: '图标视图' })).toHaveCSS('min-height', '22px');
  await toolbar.getByRole('button', { name: /^显示选项/ }).click();
  await page
    .getByRole('group', { name: '类型' })
    .getByRole('button', { name: /^文件夹/ })
    .click();
  await page.keyboard.press('Escape');
  await expect(index.locator('[data-entry-item]')).toHaveCount(4);
  await expect(index.locator('[data-folder-style="illustrated"]')).toHaveCount(4);
  await expect(
    index.locator('[data-kind="folder"]').filter({ hasText: '工作' }).locator('[data-folder-paper]')
  ).toHaveCount(3);
  const heading = index.getByRole('button', { name: /^文件夹\s*4$/ });
  await expect(heading.locator('span > i')).toHaveCount(0);
  await heading.click();
  await expect(index.locator('[data-entry-item]')).toHaveCount(0);
  await heading.click();
  await page.screenshot({ path: info.outputPath('folder-icons.png'), animations: 'disabled' });
  await toolbar.getByRole('button', { name: '卡片视图' }).click();
  const paper = index.locator('[data-folder-style="paper"]');
  await expect(paper).toHaveCount(4);
  await expect(paper.first()).toHaveCSS('height', '74px');
  await page.screenshot({ path: info.outputPath('folder-cards.png'), animations: 'disabled' });
  await page.getByRole('button', { name: '切换深色模式' }).click();
  await page.screenshot({ path: info.outputPath('folder-cards-dark.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  // 窄屏：标题与工具合为一行，类型筛选与布局切换收进“显示选项”。
  const displayOptions = toolbar.getByRole('button', { name: /^显示选项/ });
  await expect(displayOptions).toHaveCSS('min-height', '44px');
  await expect(paper.first()).toBeInViewport();
  await page.screenshot({ path: info.outputPath('folder-cards-mobile.png'), animations: 'disabled' });
  await page.reload();
  await toolbar.getByRole('button', { name: /^显示选项/ }).click();
  await expect(page.getByRole('group', { name: '类型' }).getByRole('button', { name: /^全部/ })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(page.getByRole('group', { name: '布局' }).getByRole('button', { name: '图标' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});

test('文档与 PDF 图标风格切换后在刷新及深色模式中保留', async ({ page }, info) => {
  await mockEditorWorkspace(page, []);
  await page.route('**/api/ai/model-settings', route =>
    route.fulfill({
      json: {
        data: {
          configured: false,
          modelId: 'deepseek-flash',
          modelSupported: true,
          supportedModelIds: ['deepseek-flash']
        }
      }
    })
  );
  const notes = [
    createNote('', false, 'icon-note', '图标笔记', null),
    { ...createNote('', false, 'icon-pdf', '图标 PDF', null), contentKind: 'pdf' }
  ];
  await page.route(
    url => url.pathname === '/api/knowledge/notes',
    route => route.fulfill({ json: { data: notes } })
  );
  await page.goto('/#/settings');
  await expect(page.getByRole('button', { name: '胶囊徽标' })).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/#/materials');
  const document = page.locator('[data-art-kind="document"] svg[data-document-style]');
  const pdf = page.locator('[data-art-kind="pdf"] svg[data-document-style]');
  await expect(document).toHaveAttribute('data-document-style', 'capsule');
  await expect(pdf).toHaveAttribute('data-document-style', 'capsule');
  await page.screenshot({ path: info.outputPath('icons-capsule-light.png'), animations: 'disabled' });
  await page.goto('/#/settings');
  await page.getByRole('button', { name: '学术版式' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: '学术版式' })).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/#/materials');
  await expect(document).toHaveAttribute('data-document-style', 'layout');
  await expect(pdf).toHaveAttribute('data-document-style', 'layout');
  await page.screenshot({ path: info.outputPath('icons-layout-light.png'), animations: 'disabled' });
  await page.getByRole('button', { name: '切换深色模式' }).click();
  await expect(document).toHaveAttribute('data-document-style', 'layout');
  await expect(pdf).toHaveAttribute('data-document-style', 'layout');
  await page.screenshot({ path: info.outputPath('icons-layout-dark.png'), animations: 'disabled' });
});

test('外栏和侧栏颜色及外形可独立调整并持久保存', async ({ page }, info) => {
  await mockEditorWorkspace(page, []);
  await page.route('**/api/ai/model-settings', route =>
    route.fulfill({
      json: {
        data: {
          configured: false,
          modelId: 'deepseek-flash',
          modelSupported: true,
          supportedModelIds: ['deepseek-flash']
        }
      }
    })
  );
  await page.goto('/#/settings');
  const outer = page.getByRole('heading', { name: '外栏背景', exact: true }).locator('xpath=../..');
  const topbarSetting = page.getByRole('heading', { name: '顶部栏背景', exact: true }).locator('xpath=../..');
  const railSetting = page.getByRole('heading', { name: '左侧模块栏背景', exact: true }).locator('xpath=../..');
  const sidebarSetting = page.getByRole('heading', { name: '上下文侧栏背景', exact: true }).locator('xpath=../..');
  await outer.getByRole('textbox', { name: '十六进制颜色' }).fill('#cdd9e6');
  await topbarSetting.getByRole('textbox', { name: '十六进制颜色' }).fill('#ddeeff');
  await railSetting.getByRole('textbox', { name: '十六进制颜色' }).fill('#ccddee');
  await sidebarSetting.getByRole('textbox', { name: '十六进制颜色' }).fill('#f4f0e8');
  await page.getByRole('switch', { name: '独立间距' }).locator('xpath=ancestor::label').click();
  await page.getByRole('switch', { name: '四角圆角' }).locator('xpath=ancestor::label').click();
  await page.getByRole('switch', { name: '细边线' }).locator('xpath=ancestor::label').click();
  await page.reload();
  await expect(page.getByRole('switch', { name: '四角圆角' })).toBeChecked();
  await expect(outer.getByRole('textbox', { name: '十六进制颜色' })).toHaveValue('#cdd9e6');
  await page.goto('/#/materials');
  const shell = page.locator('[data-ni-mode]:has(> #feature-stage)');
  const sidebar = page.getByRole('complementary', { name: '笔记上下文导航' });
  const stage = page.locator('#feature-stage');
  await expect(shell).toHaveAttribute('data-sidebar-card', 'true');
  await expect(page.getByRole('banner', { name: '全局顶栏' })).toHaveCSS('background-color', 'rgb(221, 238, 255)');
  await expect(page.getByRole('navigation', { name: '工作域导航' })).toHaveCSS(
    'background-color',
    'rgb(204, 221, 238)'
  );
  await expect(sidebar).toHaveCSS('background-color', 'rgb(244, 240, 232)');
  await expect(sidebar).toHaveCSS('border-top-right-radius', '12px');
  await expect(sidebar).toHaveCSS('outline-width', '1px');
  const gap = await sidebar.evaluate(element => {
    const main = document.getElementById('feature-stage')!;
    return main.getBoundingClientRect().left - element.getBoundingClientRect().right;
  });
  expect(gap).toBeGreaterThan(0);
  await expect(stage).toHaveCSS('border-top-left-radius', '12px');
  await page.screenshot({ path: info.outputPath('sidebar-independent.png'), animations: 'disabled' });
  await page.getByRole('button', { name: '切换深色模式' }).click();
  await expect(sidebar).not.toHaveCSS('background-color', 'rgb(244, 240, 232)');
  await page.screenshot({ path: info.outputPath('sidebar-independent-dark.png'), animations: 'disabled' });
});

test('侧栏内容独立滚动，桌面和窄屏新建入口保持尺寸及完整菜单', async ({ page }, info) => {
  await mockEditorWorkspace(page, []);
  await page.route(
    url => url.pathname === '/api/knowledge/folders/tree',
    route =>
      route.fulfill({
        json: {
          data: Array.from({ length: 30 }, (_, index) => ({
            id: `folder-${index + 1}`,
            name: `目录 ${index + 1}`,
            parentId: null,
            children: []
          }))
        }
      })
  );
  await page.setViewportSize({ width: 1440, height: 700 });
  await page.goto('/#/materials');
  const sidebar = page.getByRole('complementary', { name: '笔记上下文导航' });
  const lastFolder = sidebar.getByRole('treeitem').last();
  const scroll = sidebar.locator('[class*="scrollBody"]');
  const trash = sidebar.getByRole('button', { name: /回收站/ });
  await expect(sidebar.getByRole('region', { name: '已加载笔记 · 最近更新时间分布' })).toHaveCount(0);
  await expect(sidebar.getByRole('treeitem')).toHaveCount(30);
  const position = await lastFolder.boundingBox();
  const trashBefore = await trash.boundingBox();
  await scroll.evaluate(element => {
    element.scrollTop = element.scrollHeight;
  });
  const moved = await lastFolder.boundingBox();
  expect(position!.y - moved!.y).toBeGreaterThan(100);
  expect((await trash.boundingBox())!.y).toBe(trashBefore!.y);
  await expect(lastFolder).toBeInViewport();
  await page.screenshot({ path: info.outputPath('sidebar-scroll.png') });
  for (const { width, targetSize } of [
    { width: 1440, targetSize: 30 },
    { width: 390, targetSize: 44 }
  ]) {
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
    await expect(menu.getByRole('menuitem')).toHaveText(['新建笔记', '新建文件夹', '导入 PDF', '导入 Markdown']);
    for (const name of ['新建笔记', '新建文件夹', '导入 PDF', '导入 Markdown']) {
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
  { label: '手机鼠标', hasTouch: false, viewport: { width: 390, height: 844 } },
  { label: '手机触屏', hasTouch: true, viewport: { width: 390, height: 844 } },
  { label: '767px 手机边界鼠标', hasTouch: false, viewport: { width: 767, height: 900 } },
  { label: '767px 手机边界触屏', hasTouch: true, viewport: { width: 767, height: 900 } },
  { label: '768px 平板边界鼠标', hasTouch: false, viewport: { width: 768, height: 900 } },
  { label: '768px 平板边界触屏', hasTouch: true, viewport: { width: 768, height: 900 } },
  { label: '宽屏鼠标', hasTouch: false, viewport: { width: 1024, height: 900 } },
  { label: '宽屏触屏', hasTouch: true, viewport: { width: 1024, height: 900 } }
]) {
  test.describe(`${label}共享图标按钮`, () => {
    // 复用 fixture context，确保 syntheticNetwork 的请求和 WebSocket 隔离始终生效。
    test.use({ hasTouch, viewport });
    test(viewport.width < 768 ? '手机宽度保留44px点击区域' : '宽屏使用图标按钮声明尺寸', async ({ page }) => {
      await mockEditorWorkspace(page, []);
      await page.goto('/#/materials');
      const index = page.getByRole('article', { name: '笔记索引' });
      for (const [button, regularSize] of [
        [index.getByRole('button', { name: '筛选', exact: true }), 28],
        [index.getByRole('button', { name: /^显示选项/ }), 28],
        [index.getByRole('button', { name: '上一页', exact: true }), 24],
        [index.getByRole('button', { name: '下一页', exact: true }), 24]
      ] as const) {
        await expect(button).toBeVisible();
        const box = await button.boundingBox();
        if (viewport.width < 768) {
          expect(Number(box!.width.toFixed(3))).toBeGreaterThanOrEqual(44);
          expect(Number(box!.height.toFixed(3))).toBeGreaterThanOrEqual(44);
        } else {
          expect(box!.width).toBeCloseTo(regularSize, 3);
          expect(box!.height).toBeCloseTo(regularSize, 3);
        }
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
  for (const buttonStyle of ['paper', 'frost']) {
    test(`${mode} ${buttonStyle}：按钮材质不覆盖禁用反馈`, async ({ page }) => {
      await mockEditorWorkspace(page, []);
      await page.addInitScript(
        appearance => {
          localStorage.setItem('knowra:notes-index-appearance:v1', JSON.stringify(appearance));
        },
        { mode, buttonStyle }
      );
      await page.goto('/#/showcase');
      const shell = page.locator('[data-ni-mode]:has(> #feature-stage)');
      await expect(shell).toHaveAttribute('data-button-style', buttonStyle);
      for (const name of ['默认', '保存']) {
        const button = page.getByRole('button', { name, exact: true, disabled: true });
        await expect(button).toBeDisabled();
        await expect(button).toHaveCSS('box-shadow', 'none');
        await expect(button).toHaveCSS('opacity', '0.65');
        await expect(button).toHaveCSS('cursor', 'not-allowed');
        const colors = await button.evaluate(element => {
          const computed = getComputedStyle(element);
          const probe = document.createElement('span');
          probe.style.cssText =
            'color:var(--text-muted);background:var(--surface-hover);border:1px solid var(--border-subtle)';
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
      // 默认按钮是细线样式：透明底和 1px 描边，没有投影；主按钮仍保留材质投影，防止用全局移除样式掩盖问题。
      const outline = page.getByRole('button', { name: '默认胶囊', exact: true });
      await expect(outline).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect(outline).toHaveCSS('border-top-width', '1px');
      await expect(outline).toHaveCSS('box-shadow', 'none');
      await expect(page.getByRole('button', { name: '发布', exact: true })).not.toHaveCSS('box-shadow', 'none');
    });
  }
}
