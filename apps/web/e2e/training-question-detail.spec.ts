import { expect, test, type Page } from '@playwright/test';

const date = '2026-10-02T00:00:00.000Z';
const item = { id: 'detail-knowledge', title: '导数与变化率', canonicalStatement: '导数刻画瞬时变化率。', knowledgeType: 'concept', sourceMode: 'manual', reviewStatus: 'confirmed', createdAt: date, updatedAt: date, deletedAt: null };
const objectives = [
  { id: 'detail-goal-1', objective: '解释导数的几何意义', knowledgeItemId: item.id, actionVerb: 'explain', cognitiveLevel: 'understand', reviewStatus: 'confirmed', updatedAt: date },
  { id: 'detail-goal-2', objective: '计算函数在给定点的导数', knowledgeItemId: item.id, actionVerb: 'calculate', cognitiveLevel: 'apply', reviewStatus: 'candidate', updatedAt: date }
];
const shortAnswer = { id: 'detail-question', stem: '解释导数，并计算 f(x)=x² 在 x=2 处的导数。', questionType: 'shortAnswer', referenceAnswer: '导数表示切线斜率，f′(2)=4。',
  rubric: { totalPoints: 4, criteria: [{ description: '解释切线斜率', points: 2 }, { description: '正确求导并代入', points: 2 }] }, explanation: '平均变化率的极限。', difficulty: 'medium',
  reviewStatus: 'candidate', sourceMode: 'manual', version: 2, updatedAt: date, learningObjectiveIds: objectives.map(value => value.id), deletedAt: null,
  sources: [{ id: 'detail-source', sourceType: 'noteVersion', sourceId: 'detail-version', quote: '编题时的原始摘录。', locator: { noteId: 'detail-note' }, status: 'stale' }] };

async function fixture(page: Page, options: { desktopLocal?: boolean; missingLocator?: boolean; failVersionOnce?: boolean; numericChoice?: boolean; directKnowledgeSource?: boolean } = {}) {
  if (options.desktopLocal) await page.addInitScript(() => { Object.assign(window, { knowraRuntime: { persistenceMode: 'desktop-local', datasetId: 'synthetic-training-details' } }); });
  const sourceItem = { ...item, id: 'detail-source-knowledge', title: '独立的来源知识' };
  let question = { ...shortAnswer, questionType: options.numericChoice ? 'singleChoice' : shortAnswer.questionType,
    referenceAnswer: options.numericChoice ? 1 : shortAnswer.referenceAnswer,
    options: options.numericChoice ? [{ id: 1, text: '正确选项' }, { id: 2, text: '干扰选项' }] : null,
    sources: options.directKnowledgeSource ? [
      { id: 'direct-knowledge', sourceType: 'knowledgeItem', sourceId: sourceItem.id, quote: '另一知识提供编题依据', status: 'active', locator: null },
      { ...shortAnswer.sources[0], locator: null },
      { id: 'direct-evidence', sourceType: 'knowledgeEvidence', sourceId: 'direct-evidence-id', quote: '编题时的证据', status: 'active', locator: null }
    ] : shortAnswer.sources.map(source => ({ ...source, locator: options.missingLocator ? null : source.locator })) };
  let versionReads = 0;
  let refuseVersionRead = Boolean(options.failVersionOnce);
  let currentNoteReads = 0;
  const writes: string[] = [];
  await page.route('**/api/**', async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (!pathname.startsWith('/api/')) return route.continue();
    let data: unknown = [];
    if (pathname === '/api/local-runtime/sync') data = { serverUrl: null, generation: 1, phase: 'synced', pendingNotes: 0, pendingEntities: 0, lastSyncedAt: null, conflicts: [], error: null, blockedNotes: [] };
    if (request.method() !== 'GET') writes.push(`${request.method()} ${pathname}`);
    if (pathname === '/api/knowledge/spaces') data = [{ id: 'detail-space', name: '合成试题验收', defaultFlag: true }];
    else if (pathname === '/api/knowledge/items') data = options.directKnowledgeSource ? [item, sourceItem] : [item];
    else if (pathname === '/api/knowledge/items/detail-knowledge') data = item;
    else if (pathname === '/api/knowledge/items/detail-source-knowledge') data = sourceItem;
    else if (pathname === '/api/knowledge/items/detail-source-knowledge/evidence') data = [{ id: 'direct-evidence-id', knowledgeItemId: sourceItem.id, noteId: 'detail-note', noteVersionId: 'detail-version', quoteText: '独立来源知识的证据摘录', status: 'valid', headingPath: ['来源章节'] }];
    else if (pathname === '/api/knowledge/learning-objectives') data = objectives;
    else if (pathname === '/api/knowledge/questions') data = [question, { ...shortAnswer, id: 'detail-bool', stem: '导数一定大于零。', questionType: 'trueFalse', referenceAnswer: false, rubric: null, sources: [] }];
    else if (pathname === '/api/knowledge/questions/detail-question' && request.method() === 'PATCH') {
      question = { ...question, ...request.postDataJSON(), updatedAt: '2026-10-02T00:00:01.000Z' }; data = question;
    } else if (pathname === '/api/knowledge/notes/detail-note') { currentNoteReads += 1; data = { id: 'detail-note', rawMarkdown: '当前正文不同于历史版本。' }; }
    else if (pathname === '/api/knowledge/notes/detail-note/versions/detail-version') {
      versionReads += 1;
      if (refuseVersionRead) return route.fulfill({ status: 503, json: { error: { code: 'SYNTHETIC_UNAVAILABLE', message: '历史版本暂不可读' } } });
      data = { id: 'detail-version', noteId: 'detail-note', content: '# 导数\n\n编题时的原始摘录。\n\n这是引用的历史正文。', contentHash: 'synthetic-hash', createdAt: date, createdBy: 'user' };
    }
    await route.fulfill({ json: { data } });
  });
  return { writes, getVersionReads: () => versionReads, getCurrentNoteReads: () => currentNoteReads, allowVersionRead: () => { refuseVersionRead = false; } };
}

test('完整详情和历史来源对照保留多目标、答案、评分标准；只读查看不产生写请求', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/#/training');
  await page.getByRole('region', { name: '题目列表' }).getByRole('article').filter({ has: page.getByRole('heading', { name: shortAnswer.stem, exact: true }) }).getByRole('button', { name: '查看详情' }).click();
  const detail = page.getByRole('article', { name: '题目详情' });
  await expect(detail.getByRole('region', { name: '关联学习目标' })).toContainText(objectives[0].objective);
  await expect(detail.getByRole('region', { name: '关联学习目标' })).toContainText(objectives[1].objective);
  await expect(detail.getByRole('region', { name: '参考答案' })).toContainText(shortAnswer.referenceAnswer);
  await expect(detail.getByRole('region', { name: '评分标准' })).toContainText('正确求导并代入');
  await detail.getByRole('button', { name: '对照来源' }).click();
  const dialog = page.getByRole('dialog', { name: '题目来源对照' });
  await expect(dialog.getByRole('region', { name: '编题时保存的摘录' })).toContainText('编题时的原始摘录。');
  await expect(dialog.getByRole('region', { name: '来源内容' })).toContainText('这是引用的历史正文。');
  expect(state.getVersionReads()).toBeGreaterThanOrEqual(1); expect(state.getCurrentNoteReads()).toBe(0); expect(state.writes).toEqual([]);
  await page.keyboard.press('Escape'); await expect(dialog).toBeHidden();
  await expect(detail.getByRole('button', { name: '对照来源' })).toBeFocused();
});

test('窄屏桌面本地模式可查看判断题 false 和评分空状态，查看详情不写入', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await fixture(page, { desktopLocal: true });
  await page.goto('/#/training');
  const row = page.getByRole('region', { name: '题目列表' }).getByRole('article').filter({ has: page.getByRole('heading', { name: '导数一定大于零。', exact: true }) });
  await row.getByRole('button', { name: '查看详情' }).click();
  const detail = page.getByRole('article', { name: '题目详情' });
  await expect(detail.getByRole('region', { name: '参考答案' })).toContainText('错误');
  await expect(detail.getByRole('region', { name: '评分标准' })).toContainText('尚未填写评分标准');
  // 本地训练写入已由现行能力契约支持；只读查看流程仍不得自行提交资料。
  await expect(page.getByRole('button', { name: '新建题目' })).toBeEnabled();
  await expect(page.getByRole('button', { name: '编辑', exact: true }).first()).toBeEnabled();
  expect(await detail.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(state.writes).toEqual([]);
});

test('历史来源读取失败可重试，缺定位的旧来源保留摘录并明确无法定位', async ({ page }) => {
  const state = await fixture(page, { failVersionOnce: true });
  await page.goto('/#/training'); await page.getByRole('button', { name: '查看详情' }).first().click();
  await page.getByRole('button', { name: '对照来源' }).click();
  const dialog = page.getByRole('dialog', { name: '题目来源对照' });
  await expect(dialog.getByRole('alert')).toContainText('历史版本暂不可读');
  await expect(dialog.getByRole('region', { name: '编题时保存的摘录' })).toContainText('编题时的原始摘录');
  state.allowVersionRead();
  await dialog.getByRole('button', { name: '重新读取来源' }).click();
  await expect(dialog.getByRole('region', { name: '来源内容' })).toContainText('这是引用的历史正文');
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.unroute('**/api/**'); await fixture(page, { missingLocator: true });
  await page.reload(); await page.getByRole('button', { name: '查看详情' }).first().click();
  await page.getByRole('button', { name: '对照来源' }).click();
  await expect(page.getByRole('alert')).toContainText('缺少笔记定位');
  await expect(page.getByRole('region', { name: '编题时保存的摘录' })).toContainText('编题时的原始摘录');
  await expect(page.getByRole('button', { name: '打开当前笔记' })).toHaveCount(0);
});

test('现有编辑保存后详情更新，搜索隐藏题目时不残留另一题的答案', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/#/training'); await page.getByRole('button', { name: '查看详情' }).first().click();
  await page.getByRole('region', { name: '题目列表' }).getByRole('button', { name: '编辑', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: '编辑题目' });
  await dialog.getByRole('textbox', { name: '参考答案' }).fill('修订后的参考答案。');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('region', { name: '参考答案' })).toContainText('修订后的参考答案。');
  await page.getByRole('searchbox', { name: '搜索题目' }).fill('导数一定');
  await expect(page.getByRole('article', { name: '题目详情' })).toHaveCount(0);
  await page.getByRole('button', { name: '查看详情' }).click();
  await expect(page.getByRole('region', { name: '参考答案' })).toContainText('错误');
  expect(state.writes).toEqual(['PATCH /api/knowledge/questions/detail-question']);
});

test('合法的数字选项标识在浏览器中对应参考答案文本', async ({ page }) => {
  await fixture(page, { numericChoice: true });
  await page.goto('/#/training'); await page.getByRole('button', { name: '查看详情' }).first().click();
  const answer = page.getByRole('region', { name: '参考答案' });
  await expect(answer).toContainText('1 · 正确选项');
  await expect(answer).not.toContainText('未找到对应选项');
});

test('目标知识与直接来源知识不同，仍可准确对照笔记版本和证据', async ({ page }) => {
  const state = await fixture(page, { directKnowledgeSource: true });
  await page.goto('/#/training'); await page.getByRole('button', { name: '查看详情' }).first().click();
  const detail = page.getByRole('article', { name: '题目详情' });
  await detail.getByRole('button', { name: '对照来源' }).nth(1).click();
  const dialog = page.getByRole('dialog', { name: '题目来源对照' });
  await expect(dialog.getByRole('region', { name: '来源内容' })).toContainText('这是引用的历史正文');
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await detail.getByRole('button', { name: '对照来源' }).nth(2).click();
  await expect(dialog.getByRole('region', { name: '来源内容' })).toContainText('独立来源知识的证据摘录');
  expect(state.getCurrentNoteReads()).toBe(0); expect(state.writes).toEqual([]);
});
