import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import { validateReviewEnvelope, type ReviewDraft } from '@study-accelerator/shared/incremental-review';
import { test } from './fixtures/syntheticTest';
import { mockShellServices } from './fixtures/shellServices';

const baseReport = JSON.parse(await readFile(new URL('../../../packages/shared/test/fixtures/incremental-review.json', import.meta.url), 'utf8'));
// 合法长字段用于窄屏溢出回归，不含用户资料。
const row = baseReport.rows[0];
row.note.id = 'S' + '0'.repeat(80); row.rowId = 'retrieval:' + row.note.id; row.requestId = 'concept-link-r2-' + row.note.id;
row.proposals[0].proposalId = baseReport.reportId + '/' + row.rowId + '#0';
row.providerResult.parsed.requestId = row.requestId; row.providerResult.rawText = JSON.stringify(row.providerResult.parsed);
row.candidateConcepts.push({ id: 'C' + '0'.repeat(110), name: '合成'.repeat(40), sense: '长字段布局回归' });
const reportFile = (report = baseReport) => ({ name: 'synthetic-review.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(report)) });
const graph = { state: { concepts: [{ id: 'C1', name: '合成原图', sense: '用于隔离检查' }], items: [] }, results: [] };

async function downloadDraft(page: Page, path: string) {
  await page.getByRole('button', { name: '下载未授权草稿' }).click();
  const warning = page.getByRole('dialog', { name: '下载包含原文的草稿？' });
  await expect(warning).toContainText('不是正式提交');
  await expect(warning).toContainText('不授予执行授权');
  const [download] = await Promise.all([page.waitForEvent('download'), warning.getByRole('button', { name: '确认下载（含原文）' }).click()]);
  expect(download.suggestedFilename()).toBe('knowra-unapproved-review-draft.json');
  await download.saveAs(path);
  return JSON.parse(await readFile(path, 'utf8')) as ReviewDraft;
}


async function prepareShell(page: Page) {
    await mockShellServices(page);
    await page.route('**/api/knowledge/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (route.request().method() !== 'GET' || !['/api/knowledge/spaces', '/api/knowledge/folders/tree', '/api/knowledge/tag-groups', '/api/knowledge/notes', '/api/knowledge/tags'].includes(pathname)) return route.fallback();
      await route.fulfill({ json: { data: pathname.endsWith('/spaces') ? [{ id: 'synthetic-space', name: '合成空间', defaultFlag: true }] : [] } });
    });
}

for (const width of [1440, 390]) {
  test(`离线报告审阅、草稿恢复与隔离 ${width}px`, async ({ page }, info) => {
    test.setTimeout(60_000);
    await prepareShell(page);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('/#/knowledge/graph');
    await page.getByLabel('选择实验结果文件').setInputFiles({ name: 'synthetic-graph.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(graph)) });
    await page.getByRole('button', { name: /^合成原图，/ }).click();
    const originalGraph = await page.getByRole('group', { name: '概念图', exact: true }).innerHTML();
    const originalDetails = await page.getByRole('region', { name: '详情', exact: true }).textContent();
    const storage = await page.evaluate(() => [JSON.stringify(localStorage), JSON.stringify(sessionStorage)]);
    const requests: string[] = []; page.on('request', request => requests.push(request.url()));
    await page.evaluate(() => {
      const calls: string[] = []; Object.assign(window, { reviewPersistenceCalls: calls });
      for (const method of ['setItem', 'removeItem', 'clear'] as const) {
        const original = Storage.prototype[method];
        Object.defineProperty(Storage.prototype, method, { value: function (...args: string[]) { calls.push(method); return Reflect.apply(original, this, args); } });
      }
      const original = indexedDB.open.bind(indexedDB);
      indexedDB.open = (...args: Parameters<IDBFactory['open']>) => { calls.push('indexedDB.open'); return original(...args); };
      for (const method of ['add', 'put', 'delete', 'clear'] as const) {
        const original = IDBObjectStore.prototype[method];
        Object.defineProperty(IDBObjectStore.prototype, method, { value: function (...args: unknown[]) { calls.push(`indexedDB.${method}`); return Reflect.apply(original, this, args); } });
      }
    });
    const launch = page.getByRole('button', { name: '离线报告审阅（实验）', exact: true });
    await launch.click();
    const dialog = page.getByRole('dialog', { name: '离线报告审阅（实验）', exact: true });
    const upload = page.getByLabel('选择离线审阅报告文件');
    const summary = dialog.getByLabel('报告审阅统计');
    await upload.setInputFiles(reportFile());
    await expect(summary).toContainText('未决定 1');
    await expect(dialog).toContainText('不认证文件来源');
    await expect(dialog.getByRole('region', { name: '报告笔记原文' })).toContainText('合成甲属于示例。');
    const capture = async (name: string) => {
      await page.evaluate(() => document.fonts.ready);
      expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      expect(await dialog.evaluate(node => Array.from(node.querySelectorAll<HTMLElement>('*')).filter(element => ['auto', 'scroll'].includes(getComputedStyle(element).overflowX)).every(element => element.scrollWidth <= element.clientWidth))).toBe(true);
      expect(await dialog.evaluate(node => { const box = node.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth; })).toBe(true);
      const path = info.outputPath(`${name}.png`); await page.screenshot({ path, animations: 'disabled' }); await info.attach(name, { path, contentType: 'image/png' });
    };
    await summary.scrollIntoViewIfNeeded(); await capture('00-report-label-and-source');
    await dialog.getByRole('region', { name: '报告笔记原文' }).scrollIntoViewIfNeeded(); await capture('00-source');
    await dialog.getByRole('region', { name: '模型提案' }).scrollIntoViewIfNeeded(); await capture('01-proposal');
    await dialog.getByRole('region', { name: '候选概念与旧条目' }).scrollIntoViewIfNeeded(); await capture('02-candidates');
    await expect(dialog.getByRole('button', { name: '归到 合成概念（C1）' })).toHaveText('归入此概念');
    await dialog.getByRole('button', { name: '归到 合成概念（C1）' }).focus(); await page.keyboard.press('Enter');
    await expect(dialog.getByRole('status')).toBeFocused(); await expect(summary).toContainText('已选择 1');
    await dialog.getByRole('button', { name: '下载未授权草稿' }).click();
    await expect(page.getByRole('dialog', { name: '下载包含原文的草稿？' })).toContainText('不是正式提交');
    const warningPath = info.outputPath('04-draft-warning.png'); await page.screenshot({ path: warningPath, animations: 'disabled' });
    await info.attach('04-draft-warning', { path: warningPath, contentType: 'image/png' });
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '确认下载（含原文）' }).click()]);
    expect(download.suggestedFilename()).toBe('knowra-unapproved-review-draft.json');
    const draftPath = info.outputPath('downloaded-existing-review-draft.json'); await download.saveAs(draftPath);
    const draft = JSON.parse(await readFile(draftPath, 'utf8')) as ReviewDraft;
    expect(draft.approval).toBe('not-granted'); expect(draft.semanticSafety).toBe('not-verified');
    expect(draft.report).toEqual(baseReport); expect(draft.counts).toEqual({ total: 1, undecided: 0, deferred: 0, selected: 1 });
    expect(draft.decisions).toEqual([{ proposalId: row.proposals[0].proposalId, holdReasons: [], decision: { kind: 'existing', conceptId: 'C1' } }]);
    await expect(summary).toContainText('已选择 1');
    // 使用浏览器实际下载的文件恢复；不能用内存对象重建上传来代替文件往返。
    await dialog.getByRole('button', { name: '撤销本条选择' }).click(); await expect(summary).toContainText('未决定 1');
    await upload.setInputFiles(draftPath);
    await expect(summary).toContainText('已选择 1'); await expect(dialog.getByRole('status')).toContainText('已选择（未授权） · C1');
    await expect(dialog).toContainText('不认证文件来源'); await expect(dialog).toContainText('恢复不会授予执行授权');
    await dialog.getByRole('status').scrollIntoViewIfNeeded(); await capture('05-restored-existing');
    const roundTrip = await downloadDraft(page, info.outputPath('round-trip-review-draft.json'));
    expect(roundTrip).toEqual(draft);
    await dialog.getByRole('button', { name: '撤销本条选择' }).click(); await expect(summary).toContainText('未决定 1');
    const undonePath = info.outputPath('undone-review-draft.json'); const undone = await downloadDraft(page, undonePath);
    expect(undone.report).toEqual(draft.report); expect(undone.approval).toBe('not-granted'); expect(undone.semanticSafety).toBe('not-verified');
    expect(undone.counts).toEqual({ total: 1, undecided: 1, deferred: 0, selected: 0 });
    expect(undone.decisions).toEqual([{ ...draft.decisions[0], decision: { kind: 'undecided' } }]);
    await dialog.getByRole('button', { name: '重置报告', exact: true }).click(); await expect(summary).toContainText('尚未导入报告');
    await upload.setInputFiles(undonePath); await expect(summary).toContainText('未决定 1');
    await upload.setInputFiles(draftPath); await expect(summary).toContainText('已选择 1');
    // 只拒绝结构/内部一致性错误，不把结构校验误当作来源或事实认证。
    const invalidDrafts = [
      ['future-version', { ...draft, version: 2 }],
      ['changed-counts', { ...draft, counts: { ...draft.counts, selected: 0 } }],
      ['changed-risk', { ...draft, decisions: [{ ...draft.decisions[0], holdReasons: ['reported-risk'] }] }],
      ['unknown-target', { ...draft, decisions: [{ ...draft.decisions[0], decision: { kind: 'existing', conceptId: 'C-outside-report' } }] }],
      ['missing-decision', { ...draft, decisions: [] }],
      ['granted-approval', { ...draft, approval: 'granted' }],
      ['verified-semantics', { ...draft, semanticSafety: 'verified' }],
      ['injected-graph', { ...draft, state: { concepts: [], items: [] } }]
    ] as const;
    for (const [name, value] of invalidDrafts) {
      await test.step(`拒绝 ${name} 并保留已恢复决定`, async () => {
        await upload.setInputFiles({ name: `${name}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
        await expect(dialog.getByRole('alert')).toContainText('已保留'); await expect(summary).toContainText('已选择 1');
        await expect(dialog.getByRole('status')).toContainText('已选择（未授权） · C1');
        await expect(page.getByRole('button', { name: '确认替换', exact: true })).toHaveCount(0);
      });
    }
    await upload.setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
    await expect(dialog.getByRole('alert')).toContainText('已保留'); await expect(summary).toContainText('已选择 1');
    await upload.setInputFiles(reportFile()); await page.getByRole('button', { name: '取消', exact: true }).click();
    await expect(summary).toContainText('已选择 1');
    await upload.setInputFiles(reportFile()); await page.getByRole('button', { name: '确认替换' }).click();
    await expect(summary).toContainText('未决定 1');
    await dialog.getByRole('button', { name: '另建概念' }).click();
    await expect(dialog.getByLabel('新概念名称')).toBeFocused();
    await expect(dialog.getByRole('button', { name: '确认另建（仅草稿）' })).toBeDisabled();
    await dialog.getByRole('button', { name: '取消另建' }).click(); await expect(dialog.getByRole('status')).toBeFocused();
    await dialog.getByRole('button', { name: '另建概念' }).click();
    await dialog.getByLabel('新概念名称').fill('合成新概念'); await dialog.getByLabel('语境说明').fill('独立合成语境');
    await dialog.getByRole('button', { name: '确认另建（仅草稿）' }).click(); await expect(summary).toContainText('已选择 1');
    await dialog.getByRole('status').scrollIntoViewIfNeeded(); await capture('03-created');
    const newDraftPath = info.outputPath('downloaded-new-review-draft.json'); const newDraft = await downloadDraft(page, newDraftPath);
    expect(newDraft.decisions[0].decision).toEqual({ kind: 'new', name: '合成新概念', sense: '独立合成语境' });
    await upload.setInputFiles(draftPath); await page.getByRole('button', { name: '取消', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('另建 合成新概念');
    await upload.setInputFiles(draftPath); await page.getByRole('button', { name: '确认替换', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('已选择（未授权） · C1');
    await upload.setInputFiles(newDraftPath); await page.getByRole('button', { name: '确认替换', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('另建 合成新概念');
    const restoredNew = await downloadDraft(page, info.outputPath('restored-new-review-draft.json')); expect(restoredNew).toEqual(newDraft);
    await dialog.getByRole('status').scrollIntoViewIfNeeded(); await capture('06-restored-new');
    await dialog.getByRole('button', { name: '撤销本条选择' }).click(); await dialog.getByRole('button', { name: '暂不决定' }).click();
    await expect(summary).toContainText('待定 1'); await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '取消', exact: true }).click(); await expect(summary).toContainText('待定 1');
    await dialog.getByRole('button', { name: '关闭审阅' }).click(); await page.getByRole('button', { name: '关闭并清空选择' }).click();
    await expect(dialog).toHaveCount(0); await expect(launch).toBeFocused();
    expect(await page.getByRole('group', { name: '概念图', exact: true }).innerHTML()).toBe(originalGraph);
    expect(await page.getByRole('region', { name: '详情', exact: true }).textContent()).toBe(originalDetails);
    await launch.click(); await expect(summary).toContainText('尚未导入报告');
    expect(await page.evaluate(() => [JSON.stringify(localStorage), JSON.stringify(sessionStorage)])).toEqual(storage);
    expect(await page.evaluate(() => (window as Window & { reviewPersistenceCalls?: string[] }).reviewPersistenceCalls)).toEqual([]);
    expect(requests).toEqual([]); expect(errors).toEqual([]);
  });
}


function mixedReport() {
  const report = structuredClone(baseReport);
  report.rows = ['risk', 'reuse', 'rejected', 'empty', 'invalid', 'failure'].map(kind => {
    const row = structuredClone(baseReport.rows[0]);
    row.note.id = `S-${kind}`; row.rowId = `retrieval:${row.note.id}`; row.requestId = `concept-link-r2-${row.note.id}`;
    row.proposals[0].proposalId = `${report.reportId}/${row.rowId}#0`;
    if (kind === 'risk') row.proposals[0].original.sourceIssue = '合成风险：原文需要人工核实。';
    if (kind === 'reuse') Object.assign(row.proposals[0].original, { itemAction: 'reuse', existingItemId: 'K1' });
    if (kind === 'rejected') Object.assign(row.proposals[0], { original: null, validationAccepted: false, validationErrors: ['合成无效提案'] });
    if (['empty', 'invalid', 'failure'].includes(kind)) row.proposals = [];
    row.providerResult.parsed.requestId = row.requestId;
    row.providerResult.parsed.links = row.proposals.map((proposal: { original: unknown }) => structuredClone(proposal.original));
    if (kind === 'empty') {
      row.responseState = 'no_proposals'; row.providerResult.parsed.remarks = '合成说明：需要更多语境。';
      row.explanation = { kind: 'model-explanation-unverified', text: row.providerResult.parsed.remarks, nativeAbstain: false, nextAction: 'inspect-or-clarify' };
    }
    row.providerResult.rawText = JSON.stringify(row.providerResult.parsed);
    if (kind === 'invalid') { row.responseState = 'invalid_response'; row.providerResult = { kind: 'provider-result', status: 'invalid-json', rawText: '{' }; }
    if (kind === 'failure') { row.responseState = 'provider_failure'; row.providerResult = { kind: 'provider-result', status: 'invocation-failed' }; }
    return row;
  });
  return validateReviewEnvelope(report);
}

for (const width of [1440, 390]) {
  test(`离线报告风险与无提案状态 ${width}px`, async ({ page }, info) => {
    await prepareShell(page);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto('/#/knowledge/graph');
    await page.getByRole('button', { name: '离线报告审阅（实验）', exact: true }).click();
    const report = mixedReport();
    await page.getByLabel('选择离线审阅报告文件').setInputFiles(reportFile(report));
    const dialog = page.getByRole('dialog', { name: '离线报告审阅（实验）', exact: true });
    const summary = dialog.getByLabel('报告审阅统计');
    const capture = async (name: string) => {
      await page.evaluate(() => document.fonts.ready);
      expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth && Array.from(node.querySelectorAll<HTMLElement>('*')).filter(element => ['auto', 'scroll'].includes(getComputedStyle(element).overflowX)).every(element => element.scrollWidth <= element.clientWidth))).toBe(true);
      const path = info.outputPath(`${name}.png`); await page.screenshot({ path, animations: 'disabled' }); await info.attach(name, { path, contentType: 'image/png' });
    };
    await expect(summary).toContainText('未决定 3');
    for (const [index, kind, reason] of [[1, 'risk', '模型报告风险'], [2, 'reuse', '复用旧条目尚不支持确认'], [3, 'rejected', '提案结构无效']] as const) {
      const navigation = dialog.getByRole('navigation', { name: '报告笔记' }).getByRole('button', { name: new RegExp(`^${index}\\. S-${kind}`) });
      await navigation.focus(); await page.keyboard.press('Enter');
      await expect(dialog.getByRole('region', { name: '模型提案' })).toContainText(reason);
      await expect(dialog.getByRole('button', { name: /^归到/ })).toHaveCount(0);
      await expect(dialog.getByRole('button', { name: '另建概念', exact: true })).toHaveCount(0);
      await dialog.getByRole('region', { name: '模型提案' }).scrollIntoViewIfNeeded(); await capture(`01-${kind}-reason`);
      await dialog.getByRole('button', { name: '暂不决定' }).scrollIntoViewIfNeeded(); await capture(`02-${kind}-actions`);
      if (kind !== 'rejected') { await dialog.getByRole('button', { name: '暂不决定' }).click(); await expect(dialog.getByRole('status')).toContainText('待定'); }
    }
    await expect(summary).toContainText('待定 2'); await expect(summary).toContainText('未决定 1');
    for (const [index, kind, label] of [[4, 'empty', '完整响应：无提案'], [5, 'invalid', '响应无效或不完整'], [6, 'failure', '模型调用失败']] as const) {
      const navigation = dialog.getByRole('navigation', { name: '报告笔记' }).getByRole('button', { name: new RegExp(`^${index}\\. S-${kind}`) });
      await navigation.focus(); await page.keyboard.press('Enter');
      const response = dialog.locator('p').filter({ hasText: `${label} · 检索组` });
      await expect(response).toBeVisible();
      await expect(dialog.getByRole('button', { name: '暂不决定' })).toHaveCount(0);
      await expect(dialog.getByRole('button', { name: /^归到/ })).toHaveCount(0);
      await response.scrollIntoViewIfNeeded(); await capture(`03-${kind}`);
      if (kind === 'empty') await expect(dialog).toContainText('模型解释（未核实，不是原生弃权）');
    }
    await dialog.getByRole('button', { name: '下载未授权草稿' }).click();
    await expect(page.getByRole('dialog', { name: '下载包含原文的草稿？' })).toContainText('已选择、待定和未决定状态');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '确认下载（含原文）' }).click()]);
    const draftPath = info.outputPath('downloaded-held-review-draft.json'); await download.saveAs(draftPath);
    const draft = JSON.parse(await readFile(draftPath, 'utf8')) as ReviewDraft;
    expect(draft.counts).toEqual({ total: 3, undecided: 1, deferred: 2, selected: 0 });
    expect(draft.report).toEqual(report); expect(draft.approval).toBe('not-granted');
    await expect(summary).toContainText('待定 2');
    await dialog.getByRole('button', { name: '关闭审阅' }).click(); await page.getByRole('button', { name: '关闭并清空选择' }).click();
    await page.getByRole('button', { name: '离线报告审阅（实验）', exact: true }).click();
    await expect(summary).toContainText('尚未导入报告');
    await page.getByLabel('选择离线审阅报告文件').setInputFiles(draftPath);
    await expect(summary).toContainText('待定 2'); await expect(summary).toContainText('未决定 1');
    await expect(dialog.getByRole('status')).toContainText('待定');
    await expect(dialog.getByRole('region', { name: '模型提案' })).toContainText('模型报告风险');
    await expect(dialog.getByRole('button', { name: /^归到/ })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: '另建概念', exact: true })).toHaveCount(0);
    await dialog.getByRole('status').scrollIntoViewIfNeeded(); await capture('04-restored-held');
    for (const [index, kind, status] of [[2, 'reuse', '待定'], [3, 'rejected', '未决定']] as const) {
      await dialog.getByRole('navigation', { name: '报告笔记' }).getByRole('button', { name: new RegExp(`^${index}\\. S-${kind}`) }).click();
      await expect(dialog.getByRole('status')).toContainText(status);
      await expect(dialog.getByRole('button', { name: /^归到/ })).toHaveCount(0);
      await expect(dialog.getByRole('button', { name: '另建概念', exact: true })).toHaveCount(0);
    }
    expect(await downloadDraft(page, info.outputPath('round-trip-held-review-draft.json'))).toEqual(draft);
    await dialog.getByRole('navigation', { name: '报告笔记' }).getByRole('button', { name: /^1\. S-risk/ }).click();
    await dialog.getByRole('button', { name: '撤销本条选择' }).click();
    await expect(summary).toContainText('待定 1'); await expect(summary).toContainText('未决定 2');
    await expect(dialog.getByRole('button', { name: /^归到/ })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: '另建概念', exact: true })).toHaveCount(0);
    const undone = await downloadDraft(page, info.outputPath('undone-held-review-draft.json'));
    expect(undone).toEqual({ ...draft, counts: { total: 3, undecided: 2, deferred: 1, selected: 0 },
      decisions: draft.decisions.map((entry, index) => index === 0 ? { ...entry, decision: { kind: 'undecided' } } : entry) });
  });
}
