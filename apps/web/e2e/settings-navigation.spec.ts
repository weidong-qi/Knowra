import { expect, test, type Page, type TestInfo } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLocalRuntime } from '../../desktop-runtime/src/runtime-server.mjs';

async function withSettingsRuntime(
  page: Page,
  info: TestInfo,
  run: (origin: string) => Promise<void>,
  enabled = false
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-settings-'));
  fs.writeFileSync(path.join(root, 'ai-features.json'), JSON.stringify({ knowledgeProposals: enabled }));
  const runtime = await startLocalRuntime({
    dataDirectory: root,
    distRoot: fileURLToPath(new URL('../dist/', import.meta.url)),
    logger: { error() {}, warn() {}, info() {} },
    syncOptions: { autoSync: false }
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route =>
    new URL(route.request().url()).origin === runtime.origin ? route.continue() : route.abort()
  );
  try {
    await page.goto(runtime.launchUrl);
    await run(runtime.origin);
    expect(errors).toEqual([]);
  } catch (error) {
    await page.screenshot({ path: info.outputPath('settings-failure.png'), animations: 'disabled' }).catch(() => {});
    await info.attach('settings-layout', {
      contentType: 'application/json',
      body: JSON.stringify(
        await page.locator('main, [aria-label="具体设置"], [aria-label="设置分类"]').evaluateAll(elements =>
          elements.map(element => ({
            label: element.getAttribute('aria-label'),
            rect: element.getBoundingClientRect().toJSON(),
            scrollTop: element.scrollTop,
            scrollHeight: element.scrollHeight,
            clientHeight: element.clientHeight
          }))
        )
      )
    });
    throw error;
  } finally {
    await page.close();
    await runtime.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

for (const width of [1440, 390]) {
  test(`知识库进入设置后独立显示，返回保留侧栏偏好：${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 850 });
    await withSettingsRuntime(page, info, async origin => {
      await page.goto(`${origin}/#/knowledge`);
      const knowledgeNav = page.getByRole('navigation', { name: '知识库视图' });
      if (!(await knowledgeNav.isVisible())) await page.getByRole('button', { name: '切换知识库侧栏' }).click();
      await expect(knowledgeNav).toBeVisible();
      if (width === 390) {
        await page.getByRole('button', { name: '关闭知识库导航' }).click();
        await page
          .getByRole('navigation', { name: '移动端模块导航' })
          .getByRole('button', { name: '设置', exact: true })
          .click();
      } else {
        await page.getByRole('button', { name: '账户与设置' }).click();
        await page.getByRole('menuitem', { name: '设置', exact: true }).click();
      }
      await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeInViewport();
      await expect(knowledgeNav).toHaveCount(0);
      await expect(page.getByRole('button', { name: '切换知识库侧栏' })).toHaveCount(0);
      await page.screenshot({ path: info.outputPath('settings-from-knowledge.png'), animations: 'disabled' });
      await page.goBack();
      if (width === 390) await page.getByRole('button', { name: '切换知识库侧栏' }).click();
      await expect(knowledgeNav).toBeVisible();
      expect(await page.evaluate(() => localStorage.getItem('knowra:knowledge-sidebar-open'))).toBe('true');
    });
  });

  for (const enabled of [false, true]) {
    test(`AI 开关${enabled ? '关闭' : '开启与取消'}时设置页保持可见：${width}px`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 850 });
      await withSettingsRuntime(
        page,
        info,
        async origin => {
          await page.goto(`${origin}/#/settings`);
          const settingsNav = page.getByRole('navigation', { name: '设置分类', includeHidden: true });
          await settingsNav.getByRole('button', { name: /模型接入/ }).click();
          const checkbox = page.getByRole('checkbox', { name: 'AI 提炼知识点', includeHidden: true });
          await expect(checkbox).toBeEnabled();
          const control = checkbox.locator('xpath=ancestor::label');
          await control.scrollIntoViewIfNeeded();
          await control.click();
          const dialog = page.getByRole('dialog', { name: '开启“AI 提炼知识点”？' });
          if (!enabled) {
            await expect(dialog).toBeInViewport();
            await dialog.getByRole('button', { name: '取消', exact: true }).click();
            await expect(dialog).toHaveCount(0);
            await expect(settingsNav).toBeInViewport();
            await expect(control).toBeInViewport();
            await expect(checkbox).not.toBeChecked();
            const before = await (await page.request.get(`${origin}/api/ai/features`)).json();
            expect(before.data.knowledgeProposals).toBe(false);
            await control.click();
            await dialog.getByRole('button', { name: '确认开启' }).click();
          }
          await expect(checkbox).toBeChecked({ checked: !enabled });
          await expect(dialog).toHaveCount(0);
          await expect(settingsNav).toBeInViewport();
          await expect(control).toBeInViewport();
          await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeInViewport();
          const saved = await (await page.request.get(`${origin}/api/ai/features`)).json();
          expect(saved.data.knowledgeProposals).toBe(!enabled);
          await page.screenshot({ path: info.outputPath('settings-after-ai-toggle.png'), animations: 'disabled' });
        },
        enabled
      );
    });
  }
}
