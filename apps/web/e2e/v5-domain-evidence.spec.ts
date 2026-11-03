import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { knowledgeTitle, questionTitle, mockV5DomainEvidence } from './fixtures/v5DomainEvidence';

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

for (const viewport of viewports) test(`V5 知识题库标签合成验收 ${viewport.name}`, async ({ page, browser }, info) => {
  const network = await mockV5DomainEvidence(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize(viewport);
  const scenarios: unknown[] = [];
  const capture = async (name: string) => {
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => horizontalOverflow(page)).toBeLessThanOrEqual(2);
    const path = info.outputPath(`${name}.png`);
    await page.screenshot({ path, animations: 'disabled' });
    await info.attach(name, { path, contentType: 'image/png' });
    scenarios.push({ name, screenshot: `${name}.png`, viewport, overflowX: await horizontalOverflow(page),
      activeElement: await page.evaluate(() => ({ tag: document.activeElement?.tagName, label: document.activeElement?.getAttribute('aria-label') })) });
  };
  try {
    await page.goto('/#/knowledge?item=v5-knowledge');
    const knowledge = page.getByRole('article', { name: '知识详情' });
    await expect(knowledge).toContainText(knowledgeTitle);
    await capture('01-knowledge');
    const compare = knowledge.getByRole('button', { name: '对照来源', exact: true });
    await compare.click();
    const source = page.getByRole('dialog', { name: '来源对照', exact: true });
    await expect(source.getByLabel('历史版本正文')).toContainText('仅使用合成测试资料');
    await capture('02-knowledge-source');
    await page.keyboard.press('Escape');
    await expect(source).toBeHidden();
    await expect(compare).toBeFocused();

    await page.goto('/#/training');
    const row = page.getByRole('region', { name: '题目列表' }).getByRole('article').filter({ has: page.getByRole('heading', { name: questionTitle, exact: true }) });
    await expect(row).toBeVisible();
    await capture('03-questions');
    await row.getByRole('button', { name: '查看详情' }).click();
    const detail = page.getByRole('article', { name: '题目详情' });
    await expect(detail.getByRole('region', { name: '参考答案' })).toContainText('f′(2)=4');
    await detail.scrollIntoViewIfNeeded();
    await capture('04-question-detail');
    const questionCompare = detail.getByRole('button', { name: '对照来源' });
    await questionCompare.click();
    const questionSource = page.getByRole('dialog', { name: '题目来源对照' });
    await expect(questionSource.getByRole('region', { name: '来源内容' })).toContainText('仅使用合成测试资料');
    await capture('05-question-source');
    await page.keyboard.press('Escape');
    await expect(questionSource).toBeHidden();
    await expect(questionCompare).toBeFocused();
    await page.getByRole('button', { name: '学习目标', exact: true }).click();
    await expect(page.getByRole('region', { name: '学习目标列表' })).toContainText('解释导数的几何意义');
    await capture('06-objectives');

    await page.goto('/#/materials/tags');
    await expect(page.getByRole('heading', { name: '标签管理' })).toBeVisible();
    await expect(page.getByText('数学概念', { exact: true })).toBeVisible();
    await capture('07-tag-manager');
    const tagMenu = page.getByRole('button', { name: '标签“数学概念”的更多操作' });
    await tagMenu.click();
    await page.getByRole('menuitem', { name: '编辑', exact: true }).click();
    const tagDialog = page.getByRole('dialog', { name: '编辑标签' });
    await tagDialog.getByRole('textbox', { name: '名称', exact: true }).fill('未保存的标签草稿');
    await capture('08-tag-edit');
    await tagDialog.getByRole('button', { name: '取消', exact: true }).click();
    await expect(tagDialog).toBeHidden();
    await expect(tagMenu).toBeFocused();
    await expect(page.getByText('数学概念', { exact: true })).toBeVisible();
    expect(network.blocked).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    const path = info.outputPath('scenario-manifest.json');
    await writeFile(path, JSON.stringify({ schema: 1, sourcePRHead: process.env.KNOWRA_EVIDENCE_PR_HEAD,
      builtCommit: process.env.KNOWRA_EVIDENCE_SHA, sourceTree: process.env.KNOWRA_EVIDENCE_SOURCE_TREE,
      viewport, syntheticData: true, chromiumSandbox: true, browserVersion: browser.version(),
      scenarios, pageErrors: errors, blockedRequests: network.blocked, apiRequests: network.requests,
      limitations: ['CSS视口合成验收，不是真实手机软键盘/OriginOS验收'] }, null, 2));
    await info.attach('scenario-manifest', { path, contentType: 'application/json' });
  }
});
