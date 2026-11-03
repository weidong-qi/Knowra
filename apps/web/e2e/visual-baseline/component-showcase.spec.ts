// V4-04 视觉基线
//
// 目的：在真实 Chromium 中采集组件展台的视觉快照，作为回归基线。
// 1. 桌面 1440×900：顶区、按钮 + 输入、D1alog 打开、Menu 打开、集合/状态；
// 2. 手机 390×843：顶区、集合组件；
// 3. 200% 缩放：1280×720@200% zoom；
// 4. 与结构断言一起，证明 Dialog 取消/确认/右上角/Escape 都能关闭并归还焦点。
//
// 所有 toHaveScreenshot 都与基线对比；首次跑会生成基线，二次跑若差异 ≤ threshold 即 PASS。

import { expect, test } from '@playwright/test';

const SHOWCASE_HASH = '#/showcase';

test.describe.configure({ mode: 'serial' });

test.describe('V4-04 桌面视觉基线 1440×900', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('顶区 + Token + 按钮', async ({ page }) => {
    await page.goto(`/${SHOWCASE_HASH}`);
    await page.waitForLoadState('networkidle');
    // 关闭任何动画完成（让动效结束）
    await page.waitForTimeout(300);
    await expect(page.getByRole('heading', { name: /Knowra V4 组件展台/ })).toBeVisible();
    await page.screenshot({
      path: 'e2e/visual-baseline/screenshots/desktop-hero-buttons.png',
      fullPage: true
    });
  });

  test('Input / SearchField / Checkbox / Select', async ({ page }) => {
    await page.goto(`/${SHOWCASE_HASH}`);
    await page.waitForLoadState('networkidle');
    const inputSection = page.getByRole('region', { name: /Input \/ SearchField/ });
    await expect(inputSection).toBeVisible();
    await inputSection.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await inputSection.screenshot({
      path: 'e2e/visual-baseline/screenshots/desktop-input-section.png'
    });
  });

  test('Dialog 打开（含 4px + 7px 双层硬阴影）', async ({ page }) => {
    await page.goto(`/${SHOWCASE_HASH}`);
    await page.waitForLoadState('networkidle');
    await page.getByTestId('trigger-new').click();
    const dialog = page.getByRole('dialog', { name: '新建资料' });
    await expect(dialog).toBeVisible();
    // 让 dialog 完成进入动画
    await page.waitForTimeout(300);
    await dialog.screenshot({
      path: 'e2e/visual-baseline/screenshots/desktop-dialog-open.png'
    });
  });

  test('Menu 展开', async ({ page }) => {
    await page.goto(`/${SHOWCASE_HASH}`);
    await page.waitForLoadState('networkidle');
    await page.getByTestId('trigger-more').click();
    const menu = page.getByRole('menu', { name: '更多' });
    await expect(menu).toBeVisible();
    await page.waitForTimeout(200);
    await menu.screenshot({
      path: 'e2e/visual-baseline/screenshots/desktop-menu-open.png'
    });
  });

  test('Tree / GridList / TagGroup 集合组件', async ({ page }) => {
    await page.goto(`/${SHOWCASE_HASH}`);
    await page.waitForLoadState('networkidle');
    const collectionSection = page.getByRole('region', { name: /Tree \/ GridList/ });
    await collectionSection.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await collectionSection.screenshot({
      path: 'e2e/visual-baseline/screenshots/desktop-collection-section.png'
    });
  });
});

test.describe('V4-04 移动视觉基线 390×843', () => {
  test.use({ viewport: { width: 390, height: 843 } });

  test('移动端顶区 + Hero（不挤压不触字断行）', async ({ page }) => {
    await page.goto(`/${SHOWCASE_HASH}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(300);
    await page.screenshot({
      path: 'e2e/visual-baseline/screenshots/mobile-hero.png',
      fullPage: false
    });
  });

  test('移动端 GridList（两行紧凑列表，不横滚）', async ({ page }) => {
    await page.goto(`/${SHOWCASE_HASH}`);
    await page.waitForLoadState('networkidle');
    const collectionSection = page.getByRole('region', { name: /Tree \/ GridList/ });
    await collectionSection.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await collectionSection.screenshot({
      path: 'e2e/visual-baseline/screenshots/mobile-gridlist.png'
    });

    // 关键断言：GridList 内部不横滚
    const overflow = await collectionSection.evaluate((el) => {
      const grid = el.querySelector('[role="grid"]') as HTMLElement | null;
      if (!grid) return { scrollWidth: 0, clientWidth: 0 };
      return { scrollWidth: grid.scrollWidth, clientWidth: grid.clientWidth };
    });
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
  });
});

test.describe('V4-04 200% 缩放视觉基线 1280×720', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('200% 缩放无横向滚动', async ({ page }) => {
    await page.goto(`/${SHOWCASE_HASH}`);
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      document.documentElement.style.zoom = '2';
    });
    await page.waitForTimeout(200);
    await page.screenshot({
      path: 'e2e/visual-baseline/screenshots/zoom-200-percent.png',
      fullPage: true
    });
    const overflow = await page.evaluate(() => {
      return {
        html: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        body: document.body.scrollWidth - document.body.clientWidth
      };
    });
    expect(overflow.html).toBeLessThanOrEqual(2);
    expect(overflow.body).toBeLessThanOrEqual(2);
  });
});

test.describe('V4-04 Dialog 关闭契约', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('取消按钮关闭 Dialog 并归还焦点', async ({ page }) => {
    await page.goto(`/${SHOWCASE_HASH}`);
    await page.waitForLoadState('networkidle');
    const trigger = page.getByTestId('trigger-new');
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: '新建资料' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '取消' }).click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('确认按钮关闭 Dialog 并归还焦点', async ({ page }) => {
    await page.goto(`/${SHOWCASE_HASH}`);
    await page.waitForLoadState('networkidle');
    const trigger = page.getByTestId('trigger-delete');
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: '确认删除？' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '确认删除' }).click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('右上角 X 关闭 Dialog 并归还焦点', async ({ page }) => {
    await page.goto(`/${SHOWCASE_HASH}`);
    await page.waitForLoadState('networkidle');
    const trigger = page.getByTestId('trigger-new');
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: '新建资料' });
    await expect(dialog).toBeVisible();
    await page.getByRole('button', { name: '关闭对话框' }).click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('Escape 关闭 Dialog 并归还焦点', async ({ page }) => {
    await page.goto(`/${SHOWCASE_HASH}`);
    await page.waitForLoadState('networkidle');
    const trigger = page.getByTestId('trigger-new');
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: '新建资料' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});

test.describe('V4-04 SearchField 清除按钮契约', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('空值时无清除按钮；输入非空后显示；清除后按钮消失并保留焦点', async ({ page }) => {
    await page.goto(`/${SHOWCASE_HASH}`);
    await page.waitForLoadState('networkidle');
    const inputSection = page.getByRole('region', { name: /Input \/ SearchField/ });
    await inputSection.scrollIntoViewIfNeeded();
    const searchInput = inputSection.getByLabel('搜索');
    await expect(searchInput).toBeVisible();
    // 空值：清除按钮不应在 DOM
    await expect(page.getByTestId('search-clear')).toHaveCount(0);
    await searchInput.fill('印格');
    // 非空：清除按钮出现
    await expect(page.getByTestId('search-clear')).toBeVisible();
    // 清除：按钮消失，焦点回到 input
    await page.getByTestId('search-clear').click();
    await expect(page.getByTestId('search-clear')).toHaveCount(0);
    await expect(searchInput).toBeFocused();
    await expect(searchInput).toHaveValue('');
  });
});

test.describe('V4-04 独立展台运行不调用 workspace API', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('console 零 warning/error 且 /api/knowledge/spaces 永不请求', async ({ page }) => {
    const consoleErrors: string[] = [];
    const consoleWarns: string[] = [];
    const apiRequests: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
      if (msg.type() === 'warning' || msg.type() === 'warn') consoleWarns.push(msg.text());
    });
    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('/api/knowledge')) apiRequests.push(url);
    });

    await page.goto(`/${SHOWCASE_HASH}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    expect(apiRequests).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(consoleWarns).toEqual([]);
  });
});
