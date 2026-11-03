import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { mockMobileEvidence, title } from './mobile-evidence.fixture';

// 仅显式证据任务运行；不改变已有回归断言。尺寸是 CSS 视口，并非真实 OriginOS 验证。
test.skip(!process.env.KNOWRA_MOBILE_EVIDENCE, '使用独立 mobile-evidence 配置与环境变量运行');
const viewports = [
  { name: 'phone-360', width: 360, height: 800 }, { name: 'phone-390', width: 390, height: 844 },
  { name: 'phone-412', width: 412, height: 915 }, { name: 'tablet-768-portrait', width: 768, height: 1024 },
  { name: 'tablet-1024-landscape', width: 1024, height: 768 }, { name: 'tablet-1024-portrait', width: 1024, height: 1366 },
  { name: 'tablet-1366-landscape', width: 1366, height: 1024 }, { name: 'desktop-1440', width: 1440, height: 1000 }
];

async function measure(page: Page) {
  return page.evaluate(() => {
    const describe = (element: Element) => ({ tag: element.tagName, label: element.getAttribute('aria-label'),
      text: element.textContent?.trim().slice(0, 90), class: element.className });
    const visible = (element: Element) => { const r = element.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    return {
      url: location.hash, viewport: { width: innerWidth, height: innerHeight },
      documentOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      activeElement: document.activeElement ? describe(document.activeElement) : null,
      overflowingElements: [...document.querySelectorAll('body *')].filter(visible).filter(element => {
        const r = element.getBoundingClientRect(); return r.left < -2 || r.right > innerWidth + 2;
      }).slice(0, 60).map(element => ({ ...describe(element), rect: element.getBoundingClientRect().toJSON() })),
      scrollRegions: [...document.querySelectorAll('body *')].filter(visible).filter(element => /auto|scroll/.test(getComputedStyle(element).overflowY))
        .map(element => ({ ...describe(element), scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight })),
      smallControls: [...document.querySelectorAll('button, input, textarea, [role="tab"]')].filter(visible)
        .filter(element => { const r = element.getBoundingClientRect(); return r.height < 44 || r.width < 44; })
        .map(element => ({ ...describe(element), rect: element.getBoundingClientRect().toJSON() }))
    };
  });
}

for (const viewport of viewports) test(`合成移动证据 ${viewport.name}`, async ({ page, browser }, info: TestInfo) => {
  const network = await mockMobileEvidence(page);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize(viewport);
  const scenarios: unknown[] = [];
  const fontSession = await page.context().newCDPSession(page);
  await fontSession.send('DOM.enable');
  await fontSession.send('CSS.enable');
  const renderedFonts = async () => {
    const { root } = await fontSession.send('DOM.getDocument');
    const samples = [];
    for (const selector of ['h1', '.ProseMirror h1', '.ProseMirror h2', '.ProseMirror > p']) {
      const { nodeId } = await fontSession.send('DOM.querySelector', { nodeId: root.nodeId, selector });
      if (nodeId) samples.push({ selector, text: (await page.locator(selector).first().textContent())?.slice(0, 120), ...(await fontSession.send('CSS.getPlatformFontsForNode', { nodeId })) });
    }
    return samples;
  };
  const capture = async (name: string, observation?: string) => {
    await page.evaluate(() => document.fonts.ready);
    const path = info.outputPath(`${name}.png`);
    await page.screenshot({ path, fullPage: false, animations: 'disabled' });
    await info.attach(name, { path, contentType: 'image/png' });
    scenarios.push({ name, screenshot: `${name}.png`, observation, measurements: await measure(page), renderedFonts: await renderedFonts() });
  };
  try {
    await page.goto('/#/materials');
    await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
    await capture('01-note-list');
    const sidebar = page.getByRole('button', { name: '切换侧栏', exact: true });
    if (await sidebar.isVisible()) {
      if (await sidebar.getAttribute('aria-pressed') !== 'true') await sidebar.click();
      await capture('02-navigation');
    }
    else await capture('02-navigation', '当前视口未显示侧栏切换按钮；保留实际导航布局。');
    await page.goto('/#/materials/notes/note-1');
    await expect(page.locator('.ProseMirror')).toContainText('合成验收笔记');
    await capture('03-editor');
    await page.locator('.ProseMirror').focus();
    await capture('04-editor-focus');
    const scroll = page.locator('[data-editor-scroll-root]');
    await expect(scroll).toHaveCount(1);
    await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await capture('05-editor-bottom');
    await scroll.evaluate(element => { element.scrollTop = 0; });
    const compactInspector = page.getByRole('button', { name: '打开文档检查器', exact: true });
    const inspector = await compactInspector.isVisible() ? compactInspector
      : page.getByRole('button', { name: '切换文档检查器', exact: true });
    await expect(inspector).toBeVisible();
    {
      if (await inspector.getAttribute('aria-pressed') !== 'true') await inspector.click();
      await expect(page.getByRole('complementary', { name: '文档检查器', exact: true })).toBeVisible();
      await capture('06-inspector');
      await page.getByRole('button', { name: '关闭文档检查器', exact: true }).click();
      await expect(page.getByRole('complementary', { name: '文档检查器', exact: true })).toBeHidden();
    }
    await page.goto('/#/assistant?new=1');
    const composer = page.getByRole('textbox', { name: '消息', exact: true });
    await expect(composer).toBeVisible();
    await capture('07-ai-welcome');
    await composer.fill('请解释梯度下降并给出学习建议。');
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(page.getByText(/这段回答来自合成测试/)).toBeVisible();
    await capture('08-ai-chat');
    await composer.focus(); await capture('09-ai-focus');
    await page.getByRole('button', { name: 'AI 成果收件箱', exact: true }).click();
    await page.getByRole('button', { name: '审阅成果', exact: true }).click();
    await expect(page.getByRole('heading', { name: '合成成果：本周学习总结' })).toBeVisible();
    await capture('10-ai-review');
    await page.getByRole('button', { name: '关闭成果', exact: true }).click();
    await capture('11-ai-review-dismissed');
    expect(network.blocked, '未建模 API 或外部请求必须阻断并显式修复测试夹具').toEqual([]);
    expect(errors, '脚本错误不是可接受的截图基线').toEqual([]);
  } finally {
    const manifest = { schema: 1, sourceTree: process.env.KNOWRA_EVIDENCE_SOURCE_TREE ?? null, builtCommit: process.env.KNOWRA_EVIDENCE_SHA ?? 'local-unverified',
      sourcePRHead: process.env.KNOWRA_EVIDENCE_PR_HEAD ?? null,
      baseCommit: process.env.KNOWRA_EVIDENCE_BASE ?? null, baseRef: process.env.KNOWRA_EVIDENCE_BASE_REF ?? null,
      productionEquivalentToBase: process.env.KNOWRA_BASE_PRODUCTION_EQUIVALENT === 'true',
      buildKind: process.env.GITHUB_EVENT_NAME === 'pull_request' ? 'PR synthetic merge checkout' : 'explicit checkout',
      viewport, syntheticData: true, browser: 'Playwright / installed Chrome', browserVersion: browser.version(), browserChannel: 'chrome', chromiumSandbox: true, chineseFont: process.env.KNOWRA_EVIDENCE_CJK_FONT ?? null,
      limitations: ['CSS 视口模拟，不是真实 vivo/OriginOS 或软键盘测试', '几何、焦点和滚动指标仅观察记录，未将现有 UI 缺陷伪装成测试失败或通过'],
      scenarios, blockedRequests: network.blocked, apiRequests: network.requests, pageErrors: errors };
    const path = info.outputPath('scenario-manifest.json');
    await writeFile(path, JSON.stringify(manifest, null, 2));
    await info.attach('scenario-manifest', { path, contentType: 'application/json' });
  }
});
