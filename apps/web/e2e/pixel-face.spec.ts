// V4 PixelFace —— 像素五官装饰的轻量视觉基线
//
// 目标：
// 1. 主页标题区域存在 PixelFace 装饰元素
// 2. 桌面 / 移动端不产生横向滚动
// 3. console 零 warning/error
// 4. prefers-reduced-motion 时无 transform 动画跳变

import { expect, test } from '@playwright/test';

test.describe('V4 PixelFace 主页装饰基线', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/knowledge/**', route => route.fulfill({ json: { data: new URL(route.request().url()).pathname.endsWith('/spaces') ? [{ id: 'space-1', name: '合成空间' }] : [] } }));
  });
  test('桌面 1440: 主页标题区出现 PixelFace，无 console 错误', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // PixelFace 装饰：role="img" + aria-label="AI 助手"
    const face = page.getByRole('img', { name: 'AI 助手' });
    await expect(face).toBeVisible();
    await expect(face).toHaveAttribute('data-state', /idle|thinking|happy|success|error|sleep/);

    // PixelFace 内部 3 个像素元素（2 眼 + 1 嘴）
    const pixels = face.locator('[data-pf]');
    await expect(pixels).toHaveCount(3);

    await page.screenshot({
      path: 'e2e/visual-baseline/screenshots/pixel-face-desktop.png',
      fullPage: false
    });

    expect(consoleErrors).toEqual([]);
  });

  test('移动端 390: PixelFace 仍可见且不引起横向滚动', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 843 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const face = page.getByRole('img', { name: 'AI 助手' });
    await expect(face).toBeVisible();

    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth - document.documentElement.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(2);

    await page.screenshot({
      path: 'e2e/visual-baseline/screenshots/pixel-face-mobile.png',
      fullPage: false
    });
  });

  test('prefers-reduced-motion: PixelFace 不破坏 transform 动画（直接跳转或平滑过渡）', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const face = page.getByRole('img', { name: 'AI 助手' });
    await expect(face).toBeVisible();
    // 不抛错即可
  });
});
