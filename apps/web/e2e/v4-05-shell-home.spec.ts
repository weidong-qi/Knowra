import { test } from './fixtures/syntheticTest';
import { expect, type Page } from '@playwright/test';
import { mockShellServices } from './fixtures/shellServices';

test.describe('V4-05 公共 Shell 与主页', () => {
  test.beforeEach(async ({ page }) => {
    await mockWorkspace(page);
  });

  test('1024 / 1280 / 1440 / 2048 均无页面级横向滚动', async ({ page }) => {
    for (const width of [1024, 1280, 1440, 2048]) {
      await page.setViewportSize({ width, height: width === 1280 ? 720 : 1024 });
      await page.goto('/');
      await expect(page.getByRole('heading', { name: '笔记工作台' })).toBeVisible();
      await expect(page.getByText(/版本 v\d+\.\d+\.\d+/)).toBeVisible();
      const overflow = await page.evaluate(() => (
        document.documentElement.scrollWidth - document.documentElement.clientWidth
      ));
      expect(overflow, `${width}px 视口出现横向滚动`).toBeLessThanOrEqual(2);
      await expect(page.getByRole('button', { name: '工作区状态' })).toBeVisible();
      await expect(page.getByRole('contentinfo', { name: '状态栏' })).toHaveCount(0);
    }
  });

  test('全局搜索支持快捷键、过滤、清空、Enter、Escape 与焦点归还', async ({ page }) => {
    await page.goto('/');
    const trigger = page.getByRole('button', { name: '知境工作区' });
    const shortcut = process.platform === 'darwin' ? 'Meta+K' : 'Control+K';
    await trigger.focus();
    await page.keyboard.press(shortcut);

    const dialog = page.getByRole('dialog', { name: '全局搜索' });
    await expect(dialog).toBeVisible();
    const input = dialog.getByRole('combobox');
    await expect(input).toBeFocused();
    await input.fill('设计');
    await expect(dialog.getByRole('option', { name: /设计复盘/ })).toBeVisible();
    await dialog.getByRole('button', { name: '清除搜索关键字' }).click();
    await expect(input).toHaveValue('');

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await page.keyboard.press(shortcut);
    await input.fill('设计复盘');
    await expect(dialog.getByRole('option', { name: /设计复盘/ })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('status')).toContainText('设计复盘');
  });

  test('工作域与未上线入口使用对应的可用/禁用语义', async ({ page }) => {
    await page.goto('/');
    const rail = page.getByRole('navigation', { name: '工作域导航' });
    await expect(rail.getByRole('button', { name: /知识/ })).toBeEnabled();
    await expect(rail.getByRole('button', { name: /试题/ })).toBeEnabled();
    await expect(rail.getByRole('button', { name: '设置' })).toBeEnabled();
    await expect(page.getByRole('button', { name: '通知（尚未上线）' })).toBeDisabled();
    await expect(rail.getByRole('button', { name: '全局搜索' })).toHaveCount(0);
    await expect(rail.getByRole('button', { name: '新建笔记' })).toHaveCount(0);
    await expect(rail.getByRole('button', { name: '组件库' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '新建笔记（Ctrl+N）' })).toBeEnabled();

    await page.goto('/#/showcase');
    await expect(page).toHaveURL(/#\/showcase$/);
    await expect(page.getByRole('heading', { name: 'Knowra V4 组件展台' })).toBeVisible();
    await expect(rail.getByRole('button', { name: '资料', exact: true })).not.toHaveAttribute('aria-current', 'page');
    await rail.getByRole('button', { name: '知境工作区' }).click();
    await expect(page).toHaveURL(/#\/$/);

    await page.goto('/#/training');
    await expect(page.getByRole('heading', { name: '试题库' })).toBeVisible();
    await expect(page.getByRole('toolbar', { name: '训练资产筛选' })).toBeVisible();
    await rail.getByRole('button', { name: '知境工作区' }).click();
    await expect(page).toHaveURL(/#\/$/);
  });

  test('外栏沿用原型光晕与紧凑尺寸，选中按钮悬停及按下保持视觉状态', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/#/materials');
    const rail = page.getByRole('navigation', { name: '工作域导航' });
    const home = rail.getByRole('button', { name: '知境工作区' });
    const selected = rail.getByRole('button', { name: '资料', exact: true });
    await expect(selected).toHaveAttribute('aria-current', 'page');
    for (const button of [home, selected]) {
      await expect(button).toHaveCSS('width', '36px');
      await expect(button).toHaveCSS('height', '36px');
    }
    const homeBox = await home.boundingBox();
    const selectedBox = await selected.boundingBox();
    expect(selectedBox!.y - homeBox!.y - homeBox!.height).toBe(4);
    const appearance = () => selected.evaluate(element => {
      const style = getComputedStyle(element);
      return { background: style.backgroundImage, color: style.color, shadow: style.boxShadow, transform: style.transform };
    });
    await home.hover();
    // 定稿外观全局使用 .045 悬停令牌；Chromium 的 alpha 会量化至 8 bit。
    expect(await home.evaluate(element => {
      const style = getComputedStyle(element);
      return style.getPropertyValue('--surface-hover').trim() === style.getPropertyValue('--ni-hover').trim();
    })).toBe(true);
    await expect(home).toHaveCSS('background-color', 'rgba(24, 30, 48, 0.043)');
    const resting = await appearance();
    expect(resting.background).toContain('linear-gradient');
    expect(resting.shadow).toContain('0px 1px 2px');
    expect(resting.shadow).toContain('inset');
    await selected.hover();
    await expect.poll(appearance).toEqual(resting);
    await page.waitForTimeout(150); // 等待原型的 120ms 状态过渡结束，再确认没有悬停变化。
    expect(await appearance()).toEqual(resting);
    await page.mouse.down();
    expect(await appearance()).toEqual(resting);
    await page.mouse.up();
    const chrome = rail.locator('..');
    expect(await chrome.evaluate(element => getComputedStyle(element).backgroundImage)).toContain('radial-gradient');
    await expect(rail).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await page.mouse.move(1000, 20);
    await page.screenshot({ path: testInfo.outputPath('V5-外栏光晕与紧凑按钮.png') });
    await home.click();
    await expect(page).toHaveURL(/#\/$/);
    const other = rail.getByRole('button', { name: '资料', exact: true });
    await other.hover();
    await expect(other).toHaveCSS('background-color', 'rgba(24, 30, 48, 0.043)');
  });

  test('上下文侧栏开关对齐模块轨道，展开与折叠显示对应视觉状态', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/#/materials');
    const toggle = page.getByRole('button', { name: '切换侧栏' });
    const sidebar = page.getByRole('complementary', { name: '笔记上下文导航' });
    const module = page.getByRole('navigation', { name: '工作域导航' }).getByRole('button', { name: '资料', exact: true });
    await expect(sidebar).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toHaveCSS('background-color', /rgba\(24, 30, 48, 0\.08[56]\)/);
    const toggleBox = await toggle.boundingBox(), moduleBox = await module.boundingBox();
    expect(toggleBox!.x + toggleBox!.width / 2).toBe(moduleBox!.x + moduleBox!.width / 2);
    await toggle.click();
    await page.mouse.move(1000, 20);
    await expect(sidebar).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(toggle).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await toggle.click();
    await page.mouse.move(1000, 20);
    await expect(sidebar).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toHaveCSS('background-color', /rgba\(24, 30, 48, 0\.08[56]\)/);
    await page.screenshot({ path: testInfo.outputPath('V5-侧栏开关对齐与展开态.png') });
  });

  test('顶部标签栏复用浏览历史，空历史禁用，选中笔记图标使用亮橙色', async ({ page }, testInfo) => {
    await page.goto('/#/');
    const top = page.getByRole('banner', { name: '全局顶栏' });
    const back = top.getByRole('button', { name: '后退' });
    const forward = top.getByRole('button', { name: '前进' });
    await expect(back).toBeDisabled();
    await expect(forward).toBeDisabled();
    await page.getByRole('navigation', { name: '工作域导航' }).getByRole('button', { name: '资料', exact: true }).click();
    await expect(page).toHaveURL(/#\/materials$/);
    await expect(back).toBeEnabled();
    await expect(forward).toBeDisabled();
    const sidebarToggle = await top.getByRole('button', { name: '切换侧栏' }).boundingBox();
    const backBox = await back.boundingBox(), forwardBox = await forward.boundingBox();
    const tabsBox = await top.getByRole('tablist', { name: '打开的笔记' }).boundingBox();
    expect(sidebarToggle!.x + sidebarToggle!.width).toBeLessThan(backBox!.x);
    expect(backBox!.x + backBox!.width).toBeLessThan(forwardBox!.x);
    expect(forwardBox!.x + forwardBox!.width).toBeLessThan(tabsBox!.x);
    await expect(back).toHaveCSS('width', '28px');
    await back.click();
    await expect(page).toHaveURL(/#\/$/);
    await expect(back).toBeDisabled();
    await expect(forward).toBeEnabled();
    await forward.click();
    await expect(page).toHaveURL(/#\/materials$/);
    await top.getByRole('tab', { name: '设计复盘' }).click();
    await expect(page).toHaveURL(/#\/materials\/notes\/note-1$/);
    const selected = top.getByRole('tab', { name: '设计复盘' });
    await expect(selected).toHaveAttribute('aria-selected', 'true');
    await expect(selected.locator('svg')).toHaveCSS('color', 'rgb(242, 107, 29)');
    await back.click();
    await expect(page).toHaveURL(/#\/materials$/);
    await expect(forward).toBeEnabled();
    await page.getByRole('navigation', { name: '工作域导航' }).getByRole('button', { name: '设置', exact: true }).click();
    await expect(page).toHaveURL(/#\/settings$/);
    await expect(forward).toBeDisabled();
    await top.getByRole('tab', { name: '设计复盘' }).click();
    await expect(selected).toHaveAttribute('aria-selected', 'true');
    await page.screenshot({ path: testInfo.outputPath('V5-顶部导航与橙色标签图标.png') });
    await page.setViewportSize({ width: 390, height: 843 });
    await expect(back).toBeVisible();
    await expect(forward).toBeVisible();
    await expect(back).toHaveCSS('width', '44px');
    await expect.poll(() => horizontalOverflow(page)).toBeLessThanOrEqual(2);
  });

  test('侧栏头部搜索替代搜索栏，新建使用圆形透明高光并保留菜单', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/#/materials');
    const sidebar = page.getByRole('complementary', { name: '笔记上下文导航' });
    const search = sidebar.getByRole('button', { name: '搜索笔记', exact: true });
    const create = sidebar.getByRole('button', { name: '新建', exact: true });
    await expect(sidebar.getByRole('searchbox')).toHaveCount(0);
    const searchBox = await search.boundingBox(), createBox = await create.boundingBox();
    expect(searchBox!.x + searchBox!.width).toBeLessThan(createBox!.x);
    await expect(create).toHaveCSS('border-radius', '999px');
    expect(await create.evaluate(element => getComputedStyle(element).backgroundImage)).toContain('linear-gradient');
    expect(await create.evaluate(element => getComputedStyle(element).boxShadow)).not.toBe('none');
    await search.click();
    const dialog = page.getByRole('dialog', { name: '全局搜索' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('combobox').fill('设计');
    await expect(dialog.getByRole('option', { name: /设计复盘/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(search).toBeFocused();
    await create.click();
    await expect(page.getByRole('menuitem', { name: '新建笔记' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: '新建文件夹' })).toBeVisible();
    await page.getByRole('menuitem', { name: '新建笔记' }).click();
    await expect(page.getByRole('dialog', { name: '新建笔记' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: '新建笔记' })).toBeHidden();
    await page.mouse.click(1000, 300);
    await expect(page.getByRole('menu', { name: '新建', exact: true })).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath('V5-侧栏搜索与圆形透明新建.png') });
  });

  test('设置页在桌面与移动端可访问，偏好可持久保存', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('navigation', { name: '工作域导航' }).getByRole('button', { name: '设置' }).click();
    await expect(page).toHaveURL(/#\/settings$/);
    await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: '设置分类' })).toBeVisible();
    const selectedCategory = page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: /全部设置/ });
    await expect(selectedCategory).toHaveAttribute('aria-pressed', 'true');
    expect(await selectedCategory.evaluate((element) => { const style = getComputedStyle(element); return Number.parseFloat(style.borderLeftWidth) <= 1 && style.borderLeftWidth === style.borderRightWidth && style.borderLeftColor === style.borderRightColor; })).toBe(true);
    const selectionBackground = await selectedCategory.evaluate(element => {
      // 在被测控件的主题作用域解析令牌，保留已定稿的渐变选中态。
      const probe = document.createElement('span');
      probe.style.background = 'var(--nav-selected-bg, var(--surface-raised))';
      element.append(probe);
      const actual = getComputedStyle(element), expected = getComputedStyle(probe);
      const result = { actual: { image: actual.backgroundImage, color: actual.backgroundColor },
        expected: { image: expected.backgroundImage, color: expected.backgroundColor } };
      probe.remove();
      return result;
    });
    expect(selectionBackground.expected.image).toContain('linear-gradient');
    expect(selectionBackground.actual).toEqual(selectionBackground.expected);
    await expect(page.getByText('显示 9 / 9 项设置')).toBeVisible();
    await expect(page.getByRole('heading', { name: '模型接入' })).toBeVisible();
    await expect(page.getByText('尚未配置')).toBeVisible();
    await page.getByLabel('API Key').fill('synthetic-no-save');
    await expect(page.getByRole('button', { name: '保存配置' })).toBeEnabled();
    await page.getByLabel('API Key').fill('');
    await page.getByRole('button', { name: '大（19 像素）' }).click();
    await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: /辅助体验/ }).click();
    await page.getByRole('checkbox', { name: '减少界面动效' }).locator('xpath=ancestor::label').click();
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--note-font-size'))).toBe('19px');
    await page.reload();
    await expect(page.getByRole('button', { name: '大（19 像素）' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('checkbox', { name: '减少界面动效' })).toBeChecked();

    await page.setViewportSize({ width: 390, height: 843 });
    await expect(page.getByRole('navigation', { name: '移动端模块导航' }).getByRole('button', { name: '设置', exact: true })).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(2);
  });

  test('图标库可从组件展台访问并在窄屏搜索', async ({ page }) => {
    await page.goto('/#/showcase');
    await page.getByRole('link', { name: '浏览完整图标库 →' }).click();
    await expect(page).toHaveURL(/#\/showcase\/icons$/);
    // 本地 V5 图标目录新增图标；保留 main 的目录完整性断言。
    await expect(page.getByText('77 / 77')).toBeVisible();
    await expect(page.getByRole('figure')).toHaveCount(77);
    await page.getByRole('button', { name: '工作区状态' }).click();
    await expect(page.getByRole('contentinfo', { name: '状态栏' })).toContainText('图标库');
    await expect(page.getByRole('contentinfo', { name: '状态栏' })).not.toContainText('加载中');
    await page.keyboard.press('Escape');
    await page.getByRole('searchbox', { name: /搜索图标/ }).fill('Backup');
    await expect(page.getByText('BackupIcon')).toBeVisible();
    await expect(page.getByText('1 / 77')).toBeVisible();
    await expect(page.getByRole('figure')).toHaveCount(1);

    await page.setViewportSize({ width: 390, height: 843 });
    // viewport 更新先于浏览器 resize/media-query 布局提交；在连续渲染帧后验证相同溢出上限。
    await expect.poll(async () => {
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      return horizontalOverflow(page);
    }).toBeLessThanOrEqual(2);
  });

  test('移动端与 200% 缩放保留核心入口且无横向滚动', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 843 });
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: '移动端模块导航' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: '工作域导航' })).toBeHidden();
    await expect(page.getByRole('navigation', { name: '移动端模块导航', exact: true }).getByRole('button', { name: '打开全局搜索', exact: true })).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(2);

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(2);
  });

  test('最近资料可通过键盘聚焦并触发可感知反馈', async ({ page }) => {
    await page.goto('/');
    const note = page.getByRole('button', { name: '设计复盘', exact: true });
    await note.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status')).toContainText('设计复盘');
  });

  test('标签区收起后真正退出侧栏布局', async ({ page }) => {
    await page.goto('/#/materials');

    const toggle = page.getByRole('button', { name: '标签', exact: true });
    const body = page.locator('#sidebar-tags-body');
    const tag = body.getByRole('button', { name: '设计', exact: true });
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(body).toBeVisible();
    await expect(tag).toBeVisible();

    await toggle.click();

    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(body).toBeHidden();
    await expect(body).toHaveCSS('display', 'none');
    await expect(tag).toBeHidden();

    await toggle.click();
    await expect(body).toBeVisible();
    await expect(tag).toBeVisible();
  });

  test('桌面与移动端视觉证据无 console warning/error', async ({ page }) => {
    const consoleProblems: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') {
        consoleProblems.push(`${message.type()}: ${message.text()}`);
      }
    });

    await page.setViewportSize({ width: 1440, height: 1024 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '笔记工作台' })).toBeVisible();
    await page.screenshot({
      path: 'e2e/visual-baseline/screenshots/v4-05-home-1440.png',
      fullPage: false
    });

    await page.setViewportSize({ width: 390, height: 843 });
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: '移动端模块导航' })).toBeVisible();
    await page.screenshot({
      path: 'e2e/visual-baseline/screenshots/v4-05-home-390.png',
      fullPage: false
    });

    expect(consoleProblems).toEqual([]);
  });
});

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function mockWorkspace(page: Page): Promise<void> {
  await mockShellServices(page);
  await page.route('**/api/ai/model-settings', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { provider: 'deepseek', modelId: 'deepseek-flash', configured: false } })
    });
  });
  await page.route('**/api/knowledge/**', async (route) => {
    const url = new URL(route.request().url());
    let data: unknown = [];
    if (url.pathname.endsWith('/search/notes') && url.searchParams.get('result') === 'command') {
      data = [{ id: 'note-1', title: '设计复盘', folderId: 'folder-1', snippet: '合成内容' }];
    } else if (url.pathname.endsWith('/spaces')) {
      data = [{ id: 'space-1', name: '主空间' }];
    } else if (url.pathname.endsWith('/folders/tree')) {
      data = [{ id: 'folder-1', name: '工作', parentId: null, children: [] }];
    } else if (url.pathname.endsWith('/notes')) {
      data = [{
        id: 'note-1',
        spaceId: 'space-1',
        title: '设计复盘',
        folderId: 'folder-1',
        tagIds: ['tag-1'],
        internalLinks: [],
        rawMarkdown: '',
        contentLoaded: false,
        favorite: true,
        deleted: false,
        createdAt: '2026-08-18T08:00:00.000Z',
        updatedAt: '2026-08-20T08:00:00.000Z'
      }];
    } else if (url.pathname.endsWith('/notes/note-1')) {
      data = { id: 'note-1', title: '设计复盘', spaceId: 'space-1', folderId: 'folder-1',
        tagIds: ['tag-1'], internalLinks: [], rawMarkdown: '合成设计复盘正文', contentLoaded: true,
        sourceType: 'note', status: 'draft', favorite: true, deleted: false,
        createdAt: '2026-08-18T08:00:00.000Z', updatedAt: '2026-08-20T08:00:00.000Z' };
    } else if (url.pathname.endsWith('/tags')) {
      data = [{ id: 'tag-1', name: '设计' }];
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data })
    });
  });
}
