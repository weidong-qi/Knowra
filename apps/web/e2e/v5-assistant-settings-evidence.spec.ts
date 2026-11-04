import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { mockV5AssistantSettingsEvidence } from './fixtures/v5AssistantSettingsEvidence';

// 独立证据任务：真实 Chromium 渲染，所有 API 数据均为合成夹具。
test.skip(!process.env.KNOWRA_MOBILE_EVIDENCE, '仅在明确启用的合成证据任务运行');
const viewports = [
  { name: 'phone-360', width: 360, height: 800 }, { name: 'phone-390', width: 390, height: 844 },
  { name: 'phone-412', width: 412, height: 915 }, { name: 'tablet-768-portrait', width: 768, height: 1024 },
  { name: 'tablet-1024-landscape', width: 1024, height: 768 }, { name: 'tablet-1024-portrait', width: 1024, height: 1366 },
  { name: 'tablet-1366-landscape', width: 1366, height: 1024 }, { name: 'desktop-1440', width: 1440, height: 1000 }
];
async function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

for (const viewport of viewports) test(`V5 主页助手设置空间合成验收 ${viewport.name}`, async ({ page, browser }, info) => {
  const network = await mockV5AssistantSettingsEvidence(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize(viewport);
  const scenarios: unknown[] = [];
  const focusChecks: string[] = [];
  const capture = async (name: string) => {
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => horizontalOverflow(page)).toBeLessThanOrEqual(2);
    const path = info.outputPath(`${name}.png`);
    await page.screenshot({ path, animations: 'disabled' });
    await info.attach(name, { path, contentType: 'image/png' });
    scenarios.push({ name, screenshot: `${name}.png`, viewport, overflowX: await horizontalOverflow(page),
      activeElement: await page.evaluate(() => ({ tag: document.activeElement?.tagName,
        label: document.activeElement?.getAttribute('aria-label') })) });
  };
  try {
    await page.goto('/#/');
    await expect(page.getByRole('heading', { name: '笔记工作台', exact: true })).toBeVisible();
    await capture('01-home');

    await page.goto('/#/assistant?new=1');
    const composer = page.getByRole('textbox', { name: '消息', exact: true });
    await expect(composer).toBeVisible();
    await capture('02-assistant-welcome');
    await composer.fill('请解释梯度下降并给出学习建议。');
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(page.getByText(/这段回答来自合成测试/)).toBeVisible();
    await expect(page.getByRole('button', { name: /合成成果：本周学习总结.*成果草稿/ })).toBeVisible();
    await composer.fill('尚未发送的合成追问草稿');
    await composer.focus();
    await capture('03-assistant-answer-draft');

    const attachmentTrigger = page.getByRole('button', { name: '附件（0）', exact: true });
    await attachmentTrigger.click();
    const attachment = page.getByRole('dialog', { name: '对话附件管理', exact: true });
    await expect(attachment).toContainText('尚未发送给 AI');
    await capture('04-attachment-picker');
    await page.keyboard.press('Escape');
    await expect(attachment).toBeHidden();
    await expect(attachmentTrigger).toBeFocused();
    focusChecks.push('附件 Escape 关闭后返回触发按钮');
    await attachmentTrigger.click();
    await attachment.getByRole('button', { name: '关闭附件', exact: true }).click();
    await expect(attachment).toBeHidden();
    await expect(attachmentTrigger).toBeFocused();
    focusChecks.push('附件关闭按钮返回触发按钮');
    await expect(composer).toHaveValue('尚未发送的合成追问草稿');

    const inboxTrigger = page.getByRole('button', { name: 'AI 成果收件箱', exact: true });
    await inboxTrigger.click();
    const inbox = page.getByRole('complementary', { name: 'AI 成果收件箱', exact: true });
    await inbox.getByRole('button', { name: '审阅成果', exact: true }).click();
    await expect(inbox.getByRole('heading', { name: '合成成果：本周学习总结', exact: true })).toBeVisible();
    await expect(inbox.getByRole('button', { name: '确认采纳到笔记', exact: true })).toBeVisible();
    await capture('05-inbox-review');
    await inbox.getByRole('button', { name: '关闭成果', exact: true }).click();
    await expect(inbox).toBeHidden();
    await expect(inboxTrigger).toBeFocused();
    focusChecks.push('成果关闭后返回成果入口');
    await expect(composer).toHaveValue('尚未发送的合成追问草稿');

    await page.goto('/#/settings');
    await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: '显示笔记目录栏', exact: true })).toBeVisible();
    await capture('06-settings-general');
    await page.getByRole('navigation', { name: '设置分类', exact: true })
      .getByRole('button', { name: /模型接入/ }).click();
    await expect(page.getByRole('region', { name: '模型接入', exact: true })).toContainText('尚未配置');
    await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('');
    await expect(page.getByRole('button', { name: '检查连接', exact: true })).toBeDisabled();
    await page.getByRole('heading', { name: '模型接入', exact: true }).scrollIntoViewIfNeeded();
    await capture('07-settings-model-readonly');
    await expect(page.getByRole('textbox', { name: '每日上限金额（元）', exact: true })).toHaveValue('20');
    await page.getByRole('heading', { name: '预算与价格', exact: true }).scrollIntoViewIfNeeded();
    await capture('08-settings-budget-readonly');

    await page.goto('/#/materials/spaces');
    await expect(page.getByRole('heading', { name: '空间管理', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: '空间列表', exact: true })).toContainText('合成验收空间');
    await capture('09-spaces');
    const createSpace = page.getByRole('button', { name: '新建空间', exact: true });
    await createSpace.click();
    const spaceDialog = page.getByRole('dialog', { name: '新建空间', exact: true });
    await spaceDialog.getByRole('textbox', { name: '空间名称', exact: true }).fill('未创建的合成空间草稿');
    await capture('10-space-create-draft');
    await spaceDialog.getByRole('button', { name: '取消', exact: true }).click();
    await expect(spaceDialog).toBeHidden();
    await expect(createSpace).toBeFocused();
    focusChecks.push('新建空间取消后返回触发按钮');
    await createSpace.click();
    await expect(spaceDialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(spaceDialog).toBeHidden();
    await expect(createSpace).toBeFocused();
    focusChecks.push('新建空间 Escape 关闭后返回触发按钮');
    expect(scenarios).toHaveLength(10);
    expect(network.blocked, '未知请求、设置写入和外部请求均不得发生').toEqual([]);
    expect(network.requests.filter(request => !request.startsWith('GET '))).toEqual([
      'POST /api/ai/conversations',
      expect.stringMatching(/^POST \/api\/ai\/conversations\/[^/]+\/messages$/)
    ]);
    expect(errors, '页面脚本错误不能作为成功截图基线').toEqual([]);
  } finally {
    const path = info.outputPath('scenario-manifest.json');
    await writeFile(path, JSON.stringify({ schema: 1, sourcePRHead: process.env.KNOWRA_EVIDENCE_PR_HEAD,
      builtCommit: process.env.KNOWRA_EVIDENCE_SHA, sourceTree: process.env.KNOWRA_EVIDENCE_SOURCE_TREE,
      viewport, syntheticData: true, chromiumSandbox: true, browserVersion: browser.version(),
      scenarios, focusChecks, pageErrors: errors, blockedRequests: network.blocked, apiRequests: network.requests,
      limitations: ['CSS 视口合成验收，不是真实手机软键盘/OriginOS 验收',
        '模型与预算只读展示；会话发送完全由合成夹具响应，未调用外部模型、保存配置、采纳成果或创建空间'] }, null, 2));
    await info.attach('scenario-manifest', { path, contentType: 'application/json' });
  }
});
