// V4-04 视觉基线
//
// 目的：在真实 Chromium 中复验组件展台的关键交互与可访问性契约。
// 1. 工作区首页加载；
// 2. 切到 /showcase 路由，所有 V4-04 章节可见；
// 3. Dialog 打开、焦点陷阱、Esc 关闭、焦点归还；
// 4. Menu 打开、↑↓ 导航、Enter 激活、Esc 关闭；
// 5. focus-visible 蓝实阴影；
// 6. prefers-reduced-motion 关闭动画；
// 7. 200% 缩放无横向滚动。
//
// 注意：所有断言都是结构性的（role / aria-* / 焦点位置），不依赖像素级截图。

import { expect, test } from '@playwright/test';

test.describe('V4-04 ComponentShowcase 视觉与交互基线', () => {
  test('首页 + 组件展台路由都加载成功', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '早安，创造者。' })).toBeVisible();

    await page.goto('/#/showcase');
    await expect(page.getByRole('heading', { name: /Knowra V4 组件展台/ })).toBeVisible();
    const tokensHeading = page.getByRole('heading', { name: /Canonical Tokens/ });
    await expect(tokensHeading).toBeVisible();
    const tokensTop = await tokensHeading.evaluate((element) => Math.round(element.getBoundingClientRect().top));
    expect(tokensTop).toBeGreaterThanOrEqual(0);
  });

  test('展台列出全部 Canonical Token 颜色', async ({ page }) => {
    await page.goto('/#/showcase');
    for (const token of ['ink-bg', 'ink', 'ink-accent', 'ink-success', 'ink-warning', 'ink-danger']) {
      await expect(page.getByText(`--${token}`).first()).toBeVisible();
    }
  });

  test('Dialog：打开 → 焦点陷阱 → Esc 关闭 → 焦点归还触发器', async ({ page }) => {
    await page.goto('/#/showcase');
    const trigger = page.getByTestId('trigger-new');
    await trigger.click();

    const dialog = page.getByRole('dialog', { name: '新建资料' });
    await expect(dialog).toBeVisible();
    // 对话框内的"标题"输入获得焦点
    const titleInput = dialog.getByLabel(/^标题/);
    await expect(titleInput).toBeFocused();

    // Tab 走出对话框应被焦点陷阱挡住
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const stillInside = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      return Boolean(dialog?.contains(document.activeElement));
    });
    expect(stillInside).toBe(true);

    // Esc 关闭
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('Menu：触发器展开 → ↑↓ 导航 → Esc 关闭 → 焦点归还', async ({ page }) => {
    await page.goto('/#/showcase');
    const trigger = page.getByTestId('trigger-more');
    await trigger.click();

    // React Aria 把 Menu 的 accessible name 绑定到 trigger 按钮的文本。
    const menu = page.getByRole('menu', { name: '更多' });
    await expect(menu).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /复制为 Markdown/ })).toBeVisible();

    // 方向键导航不报错
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    // Esc 关闭，焦点归还触发器
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('focus-visible：键盘 Tab 显示出蓝色硬阴影', async ({ page }) => {
    await page.goto('/#/showcase');
    await page.keyboard.press('Tab');
    const focusBoxShadow = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return '';
      return getComputedStyle(el).boxShadow;
    });
    // 我们的 focus-visible CSS 使用 var(--shadow-focus) = 3px 3px 0 var(--ink-accent)
    // 真实浏览器解析后应包含 rgb(37, 99, 235) 即 --ink-accent
    expect(focusBoxShadow).toMatch(/rgb\(37,\s*99,\s*235\)/);
  });

  test('prefers-reduced-motion：动画时长被压缩到 0.01ms', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/#/showcase');
    const transitionDuration = await page.evaluate(() => {
      const el = document.querySelector('button') as HTMLElement | null;
      if (!el) return '';
      return getComputedStyle(el).transitionDuration;
    });
    const ms = parseFloat(transitionDuration) * 1000;
    expect(ms).toBeLessThanOrEqual(1);
  });

  test('200% 缩放（1280×720）下无横向滚动', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/#/showcase');
    await page.evaluate(() => {
      document.documentElement.style.zoom = '2';
    });
    await page.waitForTimeout(50);
    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth - document.documentElement.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(2);
  });
});
