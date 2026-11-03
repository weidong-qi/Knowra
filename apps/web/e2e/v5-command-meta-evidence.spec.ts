import { expect, test, type Locator, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { attachmentName, bodyQuery, bodySnippet, bodyTitle, commandTitle, emptyQuery, errorQuery,
  folderName, loadingQuery, longListQuery, mockV5CommandMetaEvidence, parentFolderName, secondTitle, titleQuery } from './fixtures/v5CommandMetaEvidence';

// 只从真实入口进入现有页面；所有网络资料都是合成 GET 夹具，不执行资料或配置写入。
test.skip(!process.env.KNOWRA_MOBILE_EVIDENCE, '仅在明确启用的合成证据任务运行');
const viewports = [
  { name: 'phone-360', width: 360, height: 800 }, { name: 'phone-390', width: 390, height: 844 },
  { name: 'phone-412', width: 412, height: 915 }, { name: 'tablet-768-portrait', width: 768, height: 1024 },
  { name: 'tablet-1024-landscape', width: 1024, height: 768 }, { name: 'tablet-1024-portrait', width: 1024, height: 1366 },
  { name: 'tablet-1366-landscape', width: 1366, height: 1024 }, { name: 'desktop-1440', width: 1440, height: 1000 }
];
const overflowX = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
async function withinViewport(locator: Locator, page: Page) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox(), viewport = page.viewportSize();
  expect(box).not.toBeNull(); expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-2); expect(box!.y).toBeGreaterThanOrEqual(-2);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 2);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 2);
}

for (const viewport of viewports) test(`V5 命令搜索与编辑器元信息只读合成验收 ${viewport.name}`, async ({ page, browser }, info) => {
  test.setTimeout(120_000);
  const network = await mockV5CommandMetaEvidence(page);
  const pageErrors: string[] = [], focusChecks: string[] = [], readonlyChecks: string[] = [];
  const scenarios: unknown[] = [], layoutChecks: unknown[] = [], fontChecks: unknown[] = [], boundaryObservations: unknown[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.setViewportSize(viewport);
  const capture = async (name: string, surface?: Locator) => {
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => overflowX(page)).toBeLessThanOrEqual(2);
    if (surface) await withinViewport(surface, page);
    const path = info.outputPath(`${name}.png`);
    await page.screenshot({ path, animations: 'disabled' });
    await info.attach(name, { path, contentType: 'image/png' });
    scenarios.push({ name, screenshot: `${name}.png`, viewport, overflowX: await overflowX(page),
      surfaceBounds: surface ? await surface.boundingBox() : null, activeElement: await page.evaluate(() => ({
        tag: document.activeElement?.tagName, label: document.activeElement?.getAttribute('aria-label'),
        activeDescendant: document.activeElement?.getAttribute('aria-activedescendant') })) });
  };
  const checkUiFont = async (name: string, locator: Locator) => {
    await expect(locator).toBeVisible();
    const result = await locator.evaluate(element => {
      const probe = document.createElement('span'); probe.style.fontFamily = 'var(--font-ui)';
      element.append(probe);
      const expected = getComputedStyle(probe).fontFamily;
      probe.remove();
      const style = getComputedStyle(element);
      return { actual: style.fontFamily, expected, fontSize: style.fontSize, fontVariantNumeric: style.fontVariantNumeric };
    });
    fontChecks.push({ name, ...result });
    expect(result.actual, `${name} 应使用 UI 字体`).toBe(result.expected);
  };
  const checkReadable = async (name: string, locator: Locator, minimumWidth: number, maximumLines: number, allowEllipsis = false) => {
    await locator.scrollIntoViewIfNeeded();
    await expect(locator).toBeInViewport({ ratio: 0.95 });
    const result = await locator.evaluate(element => {
      const style = getComputedStyle(element), box = element.getBoundingClientRect();
      const range = document.createRange(); range.selectNodeContents(element);
      const lineTops = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0).map(rect => Math.round(rect.top));
      return { width: box.width, height: box.height, lineCount: new Set(lineTops).size,
        lineHeight: style.lineHeight, fontSize: style.fontSize, textOverflow: style.textOverflow,
        overflowX: element.scrollWidth - element.clientWidth };
    });
    layoutChecks.push({ name, ...result, minimumWidth, maximumLines, allowEllipsis, minimumVisibleRatio: 0.95 });
    expect(result.width, `${name} 不能被按钮挤成逐字竖排`).toBeGreaterThanOrEqual(minimumWidth - 2);
    expect(result.lineCount).toBeGreaterThan(0); expect(result.lineCount).toBeLessThanOrEqual(maximumLines);
    if (allowEllipsis) expect(result.textOverflow).toBe('ellipsis');
    else expect(result.overflowX, `${name} 应换行而非横向裁掉正文`).toBeLessThanOrEqual(2);
  };
  const searchTrigger = () => viewport.width < 768
    ? page.getByRole('navigation', { name: '移动端模块导航', exact: true }).getByRole('button', { name: '打开全局搜索', exact: true })
    : page.getByRole('complementary', { name: '笔记上下文导航', exact: true }).getByRole('button', { name: '搜索笔记', exact: true });
  const dialog = page.getByRole('dialog', { name: '全局搜索', exact: true });
  const input = dialog.getByRole('combobox', { name: '搜索关键字', exact: true });
  const resultList = dialog.locator('#search-command-results');
  const openSearch = async (keyboard = false) => {
    // 首页没有笔记侧栏；快捷键应从普通顶栏控件的焦点直接打开搜索。
    const search = searchTrigger();
    // 平板的笔记导航默认折叠，先通过真实侧栏开关到达搜索入口。
    if (!keyboard && !await search.isVisible()) {
      await page.getByRole('button', { name: '切换侧栏', exact: true }).click();
      await expect(search).toBeVisible();
    }
    const trigger = keyboard && !await search.isVisible()
      ? page.getByRole('button', { name: '工作区状态', exact: true }) : search;
    await trigger.scrollIntoViewIfNeeded(); await trigger.focus();
    if (keyboard) await page.keyboard.press('ControlOrMeta+K'); else await trigger.click();
    await expect(dialog).toBeVisible(); await expect(input).toBeFocused(); await expect(input).toHaveValue('');
    return trigger;
  };
  const closeSearch = async (trigger: Locator, method: 'escape' | 'button' = 'escape') => {
    if (method === 'escape') await page.keyboard.press('Escape');
    else await dialog.getByRole('button', { name: '关闭对话框', exact: true }).click();
    await expect(dialog).toBeHidden(); await expect(trigger).toBeFocused();
  };
  try {
    await page.goto('/#/');
    await expect(page.getByRole('heading', { name: '笔记工作台', exact: true })).toBeVisible();
    let trigger = await openSearch(true);
    await capture('01-keyboard-command-open', dialog);
    await input.fill(titleQuery);
    const first = dialog.getByRole('option').filter({ hasText: commandTitle });
    const second = dialog.getByRole('option').filter({ hasText: secondTitle });
    await expect(dialog.getByRole('option')).toHaveCount(2);
    await expect(first).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(second).toHaveAttribute('aria-selected', 'true');
    await expect(input).toHaveAttribute('aria-activedescendant', 'search-hit-note:note-2');
    // 可见性在任何滚动辅助之前核对，避免仅凭 aria-selected 掩盖键盘选中项离屏。
    await expect(second).toBeInViewport({ ratio: 0.95 });
    await page.keyboard.press('ArrowUp'); await expect(first).toHaveAttribute('aria-selected', 'true');
    await expect(first).toBeInViewport({ ratio: 0.95 });
    await page.keyboard.press('ArrowDown'); await expect(second).toBeInViewport({ ratio: 0.95 });
    const copy = second.locator(':scope > span').nth(1);
    await checkReadable('long-search-snippet', copy.locator(':scope > span').nth(1), 120, 10);
    await checkUiFont('search-group', second.locator(':scope > span').first());
    await checkUiFont('search-primary', copy.locator(':scope > span').first());
    await checkUiFont('search-hint', second.locator(':scope > span').last());
    await capture('02-title-results-arrow-selection', dialog);
    await input.focus(); await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden(); await expect(page).toHaveURL(/#\/materials\/notes\/note-2$/);
    await expect(page.getByRole('textbox', { name: '笔记标题', exact: true })).toHaveValue(secondTitle);
    focusChecks.push('首页真实 Cmd/Ctrl+K 打开并聚焦输入，无笔记侧栏时从顶栏普通控件获焦触发；上下选择的前两项实际可见；Enter 跳转标题命中');

    trigger = await openSearch();
    await input.fill(bodyQuery);
    const bodyResult = dialog.getByRole('option').filter({ hasText: bodyTitle });
    await expect(bodyResult).toContainText(bodySnippet); await expect(bodyResult).toBeInViewport({ ratio: 0.95 });
    expect(bodyTitle).not.toContain(bodyQuery);
    await checkReadable('body-only-search-snippet', bodyResult.locator(':scope > span').nth(1).locator(':scope > span').nth(1), 120, 10);
    await capture('03-body-only-result', dialog);
    await dialog.getByRole('button', { name: '清除搜索关键字', exact: true }).click();
    await expect(input).toHaveValue(''); await expect(input).toBeFocused();
    await input.fill(loadingQuery);
    await expect.poll(() => network.heldSearches.length).toBe(1);
    await expect(resultList).toHaveAttribute('aria-busy', 'true');
    await expect(dialog).toContainText('正在搜索…');
    const beforePendingEnter = page.url();
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible(); expect(page.url()).toBe(beforePendingEnter);
    await expect(input).not.toHaveAttribute('aria-activedescendant', /.+/);
    await capture('04-held-search-loading', dialog);
    await closeSearch(trigger); await network.releaseSearches();
    focusChecks.push('清除回到输入；等待中的正文搜索禁止选择/Enter；Escape 取消并归还入口焦点');

    trigger = await openSearch();
    await input.fill(errorQuery);
    await expect(dialog.getByRole('alert')).toContainText('正文搜索失败');
    await expect(dialog.getByRole('alert')).toContainText('合成搜索暂不可用');
    await capture('05-search-error', dialog);
    await input.fill(emptyQuery);
    await expect(dialog).toContainText(`没有匹配「${emptyQuery}」的结果`);
    await expect(dialog.getByRole('option')).toHaveCount(0);
    await capture('06-empty-after-error', dialog);
    await closeSearch(trigger, 'button');
    trigger = await openSearch(true);
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect(dialog.getByRole('option')).not.toHaveCount(0);
    await page.keyboard.press('Tab');
    await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Shift+Tab');
    await expect(input).toBeFocused();
    await capture('07-reopened-query-cleared', dialog);
    focusChecks.push('错误后更换查询可恢复空结果；关闭按钮归还焦点；重开清空查询和错误；Tab/Shift+Tab 留在弹窗');

    // 异步结果进入鼠标下方也会触发 onMouseEnter；把指针移出结果区后再验证纯键盘路径。
    await page.mouse.move(1, 1);
    await input.focus();
    await input.fill(longListQuery);
    await expect(dialog.getByRole('option')).toHaveCount(12);
    const firstLongResult = dialog.getByRole('option').first();
    await expect(firstLongResult).toHaveAttribute('aria-selected', 'true');
    await expect(input).toBeFocused();
    const ancestorScrollPositions = () => resultList.evaluate(element => {
      const positions: Array<{ scrollTop: number; scrollLeft: number }> = [];
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        positions.push({ scrollTop: ancestor.scrollTop, scrollLeft: ancestor.scrollLeft });
      }
      return { windowX: scrollX, windowY: scrollY, positions };
    });
    const ancestorScrollBefore = await ancestorScrollPositions();
    const listScrollBefore = await resultList.evaluate(element => element.scrollTop);
    await page.keyboard.press('ArrowUp');
    const last = dialog.getByRole('option').last();
    await expect(last).toHaveAttribute('aria-selected', 'true');
    await expect(input).toHaveAttribute('aria-activedescendant', 'search-hit-note:synthetic-long-hit-12');
    // 不调用 scrollIntoView；必须由应用的键盘选择自行滚动结果容器，输入仍持有焦点。
    const readBoundary = () => last.evaluate(element => {
      const list = document.getElementById('search-command-results')!, row = element.getBoundingClientRect(), clip = list.getBoundingClientRect();
      const activeInViewport = row.top >= clip.top - 2 && row.bottom <= clip.bottom + 2 && row.left >= clip.left - 2
        && row.right <= clip.right + 2 && row.top >= 0 && row.bottom <= innerHeight;
      return { selectedId: element.id, row: { x: row.x, y: row.y, width: row.width, height: row.height },
        scrollport: { x: clip.x, y: clip.y, width: clip.width, height: clip.height }, scrollTop: list.scrollTop,
        activeInViewport };
    });
    await expect.poll(async () => (await readBoundary()).activeInViewport, '键盘选中末项必须真实进入结果容器和视口').toBe(true);
    await expect(last).toBeInViewport({ ratio: 0.95 });
    await expect(input).toBeFocused();
    const boundary = await readBoundary();
    expect(boundary.scrollTop, '只滚动结果列表到末项').toBeGreaterThan(listScrollBefore);
    const ancestorScrollAfter = await ancestorScrollPositions();
    expect(ancestorScrollAfter, '结果列表滚动不能牵动弹窗祖先或背景页面').toEqual(ancestorScrollBefore);
    boundaryObservations.push({ name: 'long-list-keyboard-last-option', ...boundary,
      listScrollBefore, ancestorScrollBefore, ancestorScrollAfter, classification: 'visible-and-list-scoped',
      assertionScope: '12 项末项实际可见、输入保留焦点、只滚动结果列表；无测试辅助滚动' });
    await capture('08-long-list-keyboard-boundary', dialog);
    await page.keyboard.press('ArrowDown');
    await expect(firstLongResult).toHaveAttribute('aria-selected', 'true');
    await expect(firstLongResult).toBeInViewport({ ratio: 0.95 });
    await expect(input).toBeFocused();
    await expect.poll(() => resultList.evaluate(element => element.scrollTop)).toBeLessThan(boundary.scrollTop);
    expect(await ancestorScrollPositions()).toEqual(ancestorScrollBefore);
    focusChecks.push('12 项结果首尾键盘循环时高亮实际入镜；仅结果容器滚动，背景与弹窗祖先不滚动，输入持续获焦');
    await closeSearch(trigger);

    await openSearch(); await input.fill(bodyQuery);
    await expect(bodyResult).toBeVisible(); await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden(); await expect(page).toHaveURL(/#\/materials\/notes\/note-3$/);
    await expect(page.getByRole('textbox', { name: '笔记标题', exact: true })).toHaveValue(bodyTitle);
    await expect(page.locator('[data-editor-ready]')).toHaveAttribute('data-editor-ready', 'true');
    await expect(page.locator('.ProseMirror')).toContainText(bodyQuery);
    readonlyChecks.push('标题命中和仅正文命中均通过 Enter 导航；笔记正文只读取，未聚焦输入或触发保存');
    const statusTrigger = page.getByRole('button', { name: '工作区状态', exact: true });
    await statusTrigger.click();
    const status = page.getByRole('dialog', { name: '工作区状态', exact: true });
    const location = status.getByLabel('工作区位置', { exact: true });
    await expect(location.locator('[aria-current="location"]')).toHaveText(bodyTitle);
    await checkUiFont('status-path-current', location.locator('[aria-current="location"]'));
    await capture('09-status-current-path', status);
    readonlyChecks.push('真实状态入口只显示当前路径和同步状态；App 未传入状态栏字数，数字元信息在检查器验证');
    await page.keyboard.press('Escape'); await expect(statusTrigger).toBeFocused();

    const compactTrigger = page.getByRole('button', { name: '打开文档检查器', exact: true });
    const inspectorTrigger = await compactTrigger.isVisible() ? compactTrigger : page.getByRole('button', { name: '切换文档检查器', exact: true });
    const inspector = page.getByRole('complementary', { name: '文档检查器', exact: true });
    if (await inspector.isVisible()) await inspector.getByRole('button', { name: '关闭文档检查器', exact: true }).click();
    await inspectorTrigger.click(); await withinViewport(inspector, page);
    await inspector.getByRole('tab', { name: '信息', exact: true }).click();
    const metadata = inspector.locator('dl');
    await expect(metadata).toContainText(folderName);
    // 信息面板将字数/阅读时长合为“篇幅”，创建/更新时间合为“时间”。
    const extent = metadata.getByRole('term').filter({ hasText: /^篇幅$/ }).locator('..').getByRole('definition').locator(':scope > span');
    await expect(extent).toHaveText(/^[1-9][\d,]* 字 · (?:约 \d+ 分钟|少于 1 分钟)$/);
    await checkUiFont('inspector-字数', extent);
    const times = metadata.getByRole('term').filter({ hasText: /^时间$/ }).locator('..').getByRole('definition').locator(':scope > span');
    await expect(times).toHaveText(/^更新 .+ · 创建 .+$/);
    for (const label of ['创建', '更新']) await checkUiFont(`inspector-${label}`, times);
    const folderValue = metadata.getByRole('term').filter({ hasText: /^位置$/ }).locator('..').getByRole('definition');
    await checkReadable('inspector-folder-location', folderValue, 120, 5);
    await capture('10-inspector-information', inspector);
    const attachment = inspector.getByRole('button', { name: `打开附件 ${attachmentName}`, exact: true });
    await attachment.scrollIntoViewIfNeeded(); await expect(attachment).toBeInViewport({ ratio: 0.95 });
    await checkUiFont('attachment-size-state', attachment.locator('small'));
    await expect(attachment.locator('small')).toContainText('可用');
    const attachmentTitle = attachment.locator('strong');
    // 文件名设计为单行省略，完整名称已由按钮 aria-label 验证；不把有意省略当作正文换行。
    await checkReadable('attachment-long-name', attachmentTitle, 120, 1, true);
    await checkUiFont('attachment-section-count', inspector.getByRole('heading', { name: /^附件/ }).locator('small'));
    await capture('11-attachment-metadata-readonly', inspector);

    await inspector.getByRole('tab', { name: '标注', exact: true }).click();
    const annotationPanel = inspector.getByRole('region', { name: '正文标注', exact: true });
    await expect(annotationPanel.locator('article[data-annotation-card-id]')).toHaveCount(2);
    const count = annotationPanel.getByText('重点标记', { exact: true }).locator('..').locator(':scope > span');
    await expect(count).toHaveText('2'); await checkUiFont('annotation-count', count);
    const quote = annotationPanel.getByText('只切换视图和读取内容，不保存、恢复、上传或下载。', { exact: true });
    await checkReadable('annotation-quote', quote, 120, 5);
    await capture('12-annotation-counts-readonly', inspector);

    await inspector.getByRole('tab', { name: '记录', exact: true }).click();
    const history = inspector.getByRole('region', { name: '历史记录', exact: true });
    await expect(history).toContainText('2 条历史记录');
    const firstVersion = history.getByRole('button', { name: /历史正文/ }).first();
    await checkUiFont('version-timestamp', firstVersion.locator('time'));
    await firstVersion.scrollIntoViewIfNeeded(); await expect(firstVersion).toBeInViewport({ ratio: 0.95 });
    await capture('13-version-list-readonly', inspector);
    const group = history.locator('details');
    await group.locator('summary').click();
    await expect(history.getByRole('button', { name: /历史正文/ })).toHaveCount(2);
    await group.locator('summary').click();
    await firstVersion.click();
    const preview = history.getByRole('article', { name: '版本正文预览', exact: true });
    await expect(preview).toContainText('仅供只读预览');
    await preview.scrollIntoViewIfNeeded(); await expect(preview).toBeInViewport({ ratio: 0.95 });
    // 字数元信息随新版历史面板移到所选版本标题下，仍需可见且使用 UI 字体。
    const versionMetadata = history.locator('section').filter({ has: page.getByRole('heading', { name: '所选版本', exact: true }) }).locator(':scope > p');
    const previewContent = await preview.locator('pre').innerText();
    await expect(versionMetadata).toContainText(`${previewContent.length.toLocaleString('zh-CN')} 字符`);
    await checkUiFont('version-preview-character-count', versionMetadata);
    await capture('14-version-preview-readonly', inspector);
    await expect(page.getByRole('dialog', { name: '恢复历史正文', exact: true })).toHaveCount(0);
    readonlyChecks.push('信息、附件元信息、2 条标注、分组版本和正文预览均只读；未保存、恢复版本、另存、下载、上传或调用 AI');
    await inspector.getByRole('button', { name: '关闭文档检查器', exact: true }).click();
    await expect(inspector).toBeHidden(); await expect(inspectorTrigger).toBeFocused();
    await inspectorTrigger.click(); await expect(inspector).toBeVisible();
    if (viewport.width <= 1100) await page.keyboard.press('Escape');
    else await inspector.getByRole('button', { name: '关闭文档检查器', exact: true }).click();
    await expect(inspector).toBeHidden(); await expect(inspectorTrigger).toBeFocused();
    focusChecks.push('检查器关闭/重开后归还原入口焦点；紧凑视口额外验证 Escape 关闭');

    await page.goto('/#/materials?folder=folder-1');
    if (viewport.width <= 560) {
      const index = page.getByRole('article', { name: '笔记索引', exact: true });
      const current = index.locator('header strong');
      await expect(current).toHaveText(folderName);
      await checkUiFont('top-path-current', current);
      await expect(current).toBeInViewport({ ratio: 0.95 });
      const more = index.getByRole('toolbar', { name: '笔记索引工具栏', exact: true }).getByRole('button', { name: '更多操作', exact: true });
      await more.click();
      await page.getByRole('menu', { name: '更多操作', exact: true }).getByRole('menuitem', { name: '路径导航', exact: true }).click();
      const pathMenu = page.getByRole('menu', { name: '路径导航', exact: true });
      await expect(pathMenu.getByRole('menuitem')).toHaveText(['笔记库', parentFolderName]);
      await expect(pathMenu.getByRole('menuitem', { name: folderName, exact: true })).toHaveCount(0);
      const parent = pathMenu.getByRole('menuitem', { name: parentFolderName, exact: true });
      await parent.focus();
      await expect(parent).toBeFocused();
      await expect(parent).toBeInViewport({ ratio: 0.95 });
      await checkUiFont('top-path-parent', parent);
      await capture('15-top-path-menu-reachability', pathMenu);
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/#\/materials\?folder=folder-parent$/);
      await expect(pathMenu).toBeHidden();
      await expect(current).toHaveText(parentFolderName);
      readonlyChecks.push('紧凑索引标题保留当前目录全称；更多操作的路径菜单保留根目录及父目录全称，父项可见且可键盘 Enter 返回，不重复当前目录');
    } else {
      const trail = page.getByRole('navigation', { name: '当前位置', exact: true });
      await expect(trail).toHaveAttribute('title', `笔记库 / ${parentFolderName} / ${folderName}`);
      const current = trail.locator('[aria-current="page"]');
      await expect(current).toHaveText(folderName);
      await checkUiFont('top-path-current', current);
      await current.scrollIntoViewIfNeeded(); await expect(current).toBeInViewport({ ratio: 0.95 });
      await capture('15-top-path-horizontal-reachability');
      const parent = trail.getByRole('button', { name: `跳转到「${parentFolderName}」`, exact: true });
      await parent.scrollIntoViewIfNeeded(); await parent.focus(); await expect(parent).toBeInViewport({ ratio: 0.95 });
      await checkUiFont('top-path-parent', parent);
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/#\/materials\?folder=folder-parent$/);
      await expect(trail.locator('[aria-current="page"]')).toHaveText(parentFolderName);
      readonlyChecks.push('长路径全称保留在可访问 title；当前段与父路径可正常横向到达，键盘 Enter 返回父目录');
    }

    expect(scenarios).toHaveLength(15);
    expect(network.searchRequests.map(item => item.query)).toEqual(expect.arrayContaining([titleQuery, bodyQuery, loadingQuery, errorQuery, emptyQuery, longListQuery]));
    expect(network.searchRequests.every(item => item.result === 'command' && item.spaceId === 'space-1')).toBe(true);
    expect(network.mutations, '任何非 GET 都由夹具阻断，并应使只读验收失败').toEqual([]);
    expect(network.blocked, '未知 API、外部网络、WebSocket 均不得发生').toEqual([]);
    expect(network.requests.every(request => request.startsWith('GET '))).toBe(true);
    expect(pageErrors, '页面脚本错误不能当作截图基线').toEqual([]);
  } finally {
    await network.releaseSearches();
    const path = info.outputPath('scenario-manifest.json');
    await writeFile(path, JSON.stringify({ schema: 1, sourcePRHead: process.env.KNOWRA_EVIDENCE_PR_HEAD ?? null,
      builtCommit: process.env.KNOWRA_EVIDENCE_SHA ?? 'local-unverified', sourceTree: process.env.KNOWRA_EVIDENCE_SOURCE_TREE ?? null,
      viewport, syntheticData: true, readonlyApi: true, chromiumSandbox: true, browserVersion: browser.version(),
      scenarios, focusChecks, readonlyChecks, layoutChecks, fontChecks, boundaryObservations, pageErrors,
      apiRequests: network.requests, blockedRequests: network.blocked, attemptedMutations: network.mutations, searchRequests: network.searchRequests,
      limitations: ['CSS 视口合成验收，不代表真实手机软键盘/OriginOS 或原生桌面应用验收',
        '全部 API 仅由 context 夹具返回合成 GET；未知 API、外网、WebSocket 和所有非 GET 请求均阻断',
        '前两项、正文命中及 12 项首尾键盘循环均断言实际可见；长列表额外验证滚动范围和输入焦点',
        '仅查看元信息、标注和版本，不进行正文编辑、附件文件访问、恢复、保存、配置修改或模型调用'] }, null, 2));
    await info.attach('scenario-manifest', { path, contentType: 'application/json' });
  }
});
