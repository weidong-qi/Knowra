import { expect, test, type Locator, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { mockV5StatusDialogEvidence, syntheticBackupId, syntheticClientName, syntheticEntityTitle,
  syntheticNoteTitle, syntheticPassword } from './fixtures/v5StatusDialogsEvidence';

// 真实页面与可达入口；桌面能力仅作合成标记，不使用真实同步、备份、凭据或配对。
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

for (const viewport of viewports) test(`V5 同步备份状态与设置边界合成验收 ${viewport.name}`, async ({ page, browser }, info) => {
  test.setTimeout(120_000);
  const network = await mockV5StatusDialogEvidence(page);
  const errors: string[] = [], focusChecks: string[] = [], readonlyChecks: string[] = [];
  const scenarios: unknown[] = [], layoutChecks: unknown[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize(viewport);
  const capture = async (name: string, surface?: Locator) => {
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => overflowX(page)).toBeLessThanOrEqual(2);
    if (surface) await withinViewport(surface, page);
    const path = info.outputPath(`${name}.png`);
    await page.screenshot({ path, animations: 'disabled' });
    await info.attach(name, { path, contentType: 'image/png' });
    scenarios.push({ name, screenshot: `${name}.png`, viewport, overflowX: await overflowX(page),
      surfaceBounds: surface ? await surface.boundingBox() : null,
      activeElement: await page.evaluate(() => ({ tag: document.activeElement?.tagName,
        label: document.activeElement?.getAttribute('aria-label') })) });
  };
  const checkTwoFocusSteps = async (dialog: Locator) => {
    await page.keyboard.press('Tab');
    await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Shift+Tab');
    await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  };
  try {
    await page.goto('/#/');
    await expect(page.getByRole('heading', { name: '笔记工作台', exact: true })).toBeVisible();
    const statusTrigger = page.getByRole('button', { name: '工作区状态', exact: true });
    const status = page.getByRole('dialog', { name: '工作区状态', exact: true });
    await statusTrigger.click();
    await expect(status).toContainText('本地资料 · 同步操作位于顶栏');
    await capture('01-top-status-popover', status);
    await page.keyboard.press('Escape');
    await expect(status).toBeHidden(); await expect(statusTrigger).toBeFocused();
    await statusTrigger.click(); await expect(status).toBeVisible();
    await page.mouse.click(8, viewport.height - 8);
    await expect(status).toBeHidden();
    focusChecks.push('状态浮层 Escape 返回入口；再次打开后点击外部关闭');

    const syncTrigger = page.getByRole('button', { name: /^(本地资料 连接云端|资料待核对 2 项同步冲突)$/ });
    const sync = page.getByRole('dialog', { name: '云端同步', exact: true });
    await syncTrigger.click(); await expect(sync).toBeVisible();
    const password = sync.getByLabel('登录密码', { exact: true });
    await password.fill(syntheticPassword);
    await expect(password).toHaveAttribute('type', 'password');
    await expect(password).toHaveValue(syntheticPassword);
    await expect(sync).not.toContainText(syntheticPassword);
    await checkTwoFocusSteps(sync);
    await capture('02-sync-password-masked', sync);
    await sync.getByRole('button', { name: '关闭对话框', exact: true }).click();
    await expect(sync).toBeHidden(); await expect(syncTrigger).toBeFocused();
    focusChecks.push('同步表单 Tab/Shift+Tab 两次导航仍在弹窗；关闭按钮返回顶栏入口');
    readonlyChecks.push('登录密码仅为明确标注的合成字符串，type=password，未提交连接');

    network.showConflicts();
    await syncTrigger.click();
    const note = sync.getByRole('region', { name: `冲突：${syntheticNoteTitle}`, exact: true });
    const entity = sync.getByRole('region', { name: `冲突：${syntheticEntityTitle}`, exact: true });
    await expect(note).toBeVisible(); await expect(entity).toBeVisible();
    await entity.getByRole('heading', { name: `${syntheticEntityTitle} · 关联资料需要核对`, exact: true }).scrollIntoViewIfNeeded();
    await expect(entity.getByRole('button', { name: '采用本地', exact: true })).toBeDisabled();
    await expect(entity).toContainText('云端资产已永久删除，不能采用本地恢复原编号');
    await capture('03-entity-conflict-readonly', sync);
    const entityDetails = entity.locator('details').nth(1);
    await entityDetails.locator('summary').click();
    await expect(entityDetails).toHaveAttribute('open', '');
    await expect(entityDetails).toContainText('合成来源片段');
    await entityDetails.locator('summary').click();
    await expect(entityDetails).not.toHaveAttribute('open', '');

    const comparison = note.getByRole('button', { name: /正文比较/ });
    const diff = note.getByRole('region', { name: '本机与云端的正文差异', exact: true });
    const diffContent = diff.getByLabel('正文差异内容', { exact: true });
    // 标题刚进入视口不等于正文比较已入镜；正常滚动到比较控件，并核对实际差异区。
    await comparison.evaluate(element => element.scrollIntoView({ block: 'start', inline: 'nearest' }));
    await expect(comparison).toBeInViewport({ ratio: 1 });
    await expect(diffContent).toBeInViewport({ ratio: 0.95 });
    await expect(diff).toContainText('本机修改：');
    await expect(diff).toContainText('云端修改：');
    layoutChecks.push({ name: 'note-comparison-visible', comparisonBounds: await comparison.boundingBox(),
      diffContentBounds: await diffContent.boundingBox(), minimumVisibleRatio: 0.95 });
    await capture('04-note-conflict-comparison', sync);
    await comparison.click();
    await page.getByRole('option', { name: '共同基线 → 本机', exact: true }).click();
    await expect(comparison).toContainText('共同基线 → 本机');
    await note.getByRole('button', { name: '手动合并', exact: true }).click();
    const merged = note.getByRole('textbox', { name: '合并后的正文', exact: true });
    await merged.fill('这是尚未保存的合成合并草稿，不会发送到任何服务。');
    await merged.scrollIntoViewIfNeeded();
    await capture('05-note-manual-merge-unsaved', sync);
    await expect(note.getByRole('button', { name: '保存合并结果', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sync).toBeHidden(); await expect(syncTrigger).toBeFocused();
    focusChecks.push('冲突比较、展开与未保存合并后 Escape 返回顶栏入口');
    readonlyChecks.push('笔记/关联冲突只读比较；云端已删除资产禁止采用本地；未采用版本或保存合并');

    const backup = page.getByRole('dialog', { name: '本机备份与恢复', exact: true });
    const openBackup = async () => {
      await syncTrigger.click();
      await sync.getByRole('button', { name: '本机备份与恢复', exact: true }).click();
      await expect(sync).toBeHidden(); await expect(backup).toBeVisible();
      await expect(backup.getByRole('button', { name: '刷新列表', exact: true })).toBeEnabled();
    };
    await openBackup();
    await expect(backup).toContainText('还没有本机备份');
    await expect(backup.getByRole('button', { name: '导入外部完整备份', exact: true })).toBeDisabled();
    await expect(backup.getByRole('button', { name: '确认恢复所选备份', exact: true })).toHaveCount(0);
    await checkTwoFocusSteps(backup);
    await capture('06-backup-empty', backup);
    await page.keyboard.press('Escape');
    await expect(backup).toBeHidden(); await expect(syncTrigger).toBeFocused();
    focusChecks.push('从同步切换到空备份弹窗，Tab/Shift+Tab 两次导航仍在弹窗，Escape 返回顶栏入口');

    network.showBackupList();
    await openBackup();
    await expect(backup).toContainText('本机列出 3 份备份，清单合计 3.5 MB');
    const selection = backup.getByRole('button', { name: /选择备份/ });
    await selection.click();
    await expect(page.getByRole('option', { name: /恢复前保护/ })).toBeVisible();
    await expect(page.getByRole('option', { name: /历史备份/ })).toBeVisible();
    await capture('07-backup-list-selection', backup);
    await page.keyboard.press('Escape');
    await expect(backup).toBeVisible(); await expect(selection).toBeFocused();
    await selection.click();
    await page.getByRole('option', { name: /手动备份/ }).click();
    await expect(backup.getByRole('button', { name: '导出所选完整备份', exact: true })).toBeDisabled();
    await backup.getByRole('button', { name: '检查所选备份', exact: true }).click();
    const inspection = backup.getByRole('region', { name: '备份检查结果', exact: true });
    await expect(inspection).toContainText('完整性检查通过');
    await expect(inspection).toContainText('18 篇笔记 · 2 个附件 · 3 项待同步修改');
    await inspection.getByRole('heading').scrollIntoViewIfNeeded();
    await capture('08-backup-synthetic-inspection', backup);
    const restore = inspection.getByRole('button', { name: '确认恢复所选备份', exact: true });
    const confirmation = inspection.getByRole('checkbox', { name: '我确认使用所选备份恢复整个本机资料库', exact: true });
    await expect(confirmation).not.toBeChecked(); await expect(restore).toBeDisabled();
    await restore.scrollIntoViewIfNeeded(); await withinViewport(restore, page);
    await capture('09-backup-restore-disabled-boundary', backup);
    // 不勾选恢复确认，也不点击创建、导入、导出、恢复或草稿下载。
    await backup.getByRole('button', { name: '关闭对话框', exact: true }).click();
    await expect(backup).toBeHidden(); await expect(syncTrigger).toBeFocused();
    await openBackup();
    await expect(backup.getByRole('region', { name: '备份检查结果', exact: true })).toHaveCount(0);
    await expect(backup.getByRole('button', { name: '确认恢复所选备份', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape'); await expect(backup).toBeHidden(); await expect(syncTrigger).toBeFocused();
    focusChecks.push('备份选择器 Escape 只关闭选项；检查后关闭与重开清除选择/检查，焦点返回顶栏');
    readonlyChecks.push('完整备份导入/导出在无桌面桥时禁用；恢复未确认且禁用；检查 POST 仅返回固定夹具');

    await page.goto('/#/settings');
    await page.getByRole('navigation', { name: '设置分类', exact: true }).getByRole('button', { name: /模型接入/ }).click();
    const model = page.getByRole('region', { name: '模型接入', exact: true });
    const key = model.getByLabel('API Key', { exact: true });
    await expect(key).toHaveValue(''); await key.fill(syntheticPassword);
    await expect(key).toHaveAttribute('type', 'password');
    await expect(model).not.toContainText(syntheticPassword);
    await expect(model.getByRole('button', { name: '检查连接', exact: true })).toBeDisabled();
    await key.scrollIntoViewIfNeeded(); await key.focus();
    await capture('10-model-synthetic-password-mask');
    await key.fill('');
    await expect(model.getByRole('button', { name: '保存配置', exact: true })).toBeDisabled();
    const budget = page.getByRole('region', { name: '预算与价格', exact: true });
    await expect(budget.getByRole('textbox', { name: '每日上限金额（元）', exact: true })).toHaveValue('20');
    const saveBudget = budget.getByRole('button', { name: '保存设置', exact: true });
    await saveBudget.scrollIntoViewIfNeeded(); await withinViewport(saveBudget, page);
    await saveBudget.click({ trial: true }); // 仅验证未被覆盖且可操作；绝不真正保存。
    await saveBudget.focus(); await expect(saveBudget).toBeFocused();
    await capture('11-budget-bottom-save-reachable');
    readonlyChecks.push('预算底部保存按钮可滚动到达、未遮挡且可获焦；仅 trial 检查，不保存设置');

    const clients = page.getByRole('list', { name: '已配对的外部客户端', exact: true });
    await expect(clients).toContainText(syntheticClientName);
    await clients.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    const clientHeading = clients.getByRole('heading', { name: syntheticClientName, level: 4, exact: true });
    const clientLayout = await clientHeading.evaluate(heading => {
      const copy = heading.parentElement?.parentElement, row = heading.closest('li');
      if (!copy || !row) throw new Error('合成客户端标题必须位于文案块和列表卡片内');
      const rowStyle = getComputedStyle(row), headingStyle = getComputedStyle(heading);
      const rowBox = row.getBoundingClientRect(), copyBox = copy.getBoundingClientRect(), titleBox = heading.getBoundingClientRect();
      const lineHeight = Number.parseFloat(headingStyle.lineHeight);
      const range = document.createRange(); range.selectNodeContents(heading);
      const lineTops = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0)
        .map(rect => Math.round(rect.top));
      return { rowWidth: rowBox.width, rowHeight: rowBox.height, copyWidth: copyBox.width,
        rowContentWidth: row.clientWidth - Number.parseFloat(rowStyle.paddingLeft) - Number.parseFloat(rowStyle.paddingRight),
        titleWidth: titleBox.width, titleHeight: titleBox.height, titleLineHeight: lineHeight,
        titleLineCount: new Set(lineTops).size, titleHeightInLines: titleBox.height / lineHeight };
    });
    const minCopyWidth = Math.min(240, clientLayout.rowContentWidth);
    layoutChecks.push({ name: 'external-client-readable-card', ...clientLayout,
      minimumCopyWidth: minCopyWidth, maximumTitleLines: 6, maximumRowHeight: 360 });
    // 无横向溢出仍可能被按钮挤成逐字竖排；同时约束文案宽度、真实文字行数和整卡高度。
    expect(clientLayout.rowContentWidth).toBeGreaterThan(0);
    expect(clientLayout.copyWidth, '客户端文案块不能被操作按钮挤窄').toBeGreaterThanOrEqual(minCopyWidth - 2);
    expect(clientLayout.titleLineCount).toBeGreaterThan(0);
    expect(clientLayout.titleLineCount, '合成客户端名称应正常换行，不能逐字竖排').toBeLessThanOrEqual(6);
    expect(clientLayout.titleHeightInLines).toBeLessThanOrEqual(6.1);
    expect(clientLayout.rowHeight, '单个合成客户端卡片不能异常拉长').toBeLessThanOrEqual(360);
    await capture('12-external-client-long-name');
    const connectionTrigger = clients.getByRole('button', { name: `查看连接方式：${syntheticClientName}`, exact: true });
    await connectionTrigger.click();
    const connection = page.getByRole('dialog', { name: `连接方式：${syntheticClientName}`, exact: true });
    await expect(connection).toContainText('SYNTHETIC-UI-ONLY');
    await capture('13-external-client-connection-readonly', connection);
    await connection.getByRole('button', { name: '完成', exact: true }).click();
    await expect(connection).toBeHidden(); await expect(connectionTrigger).toBeFocused();
    await connectionTrigger.click(); await expect(connection).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(connection).toBeHidden(); await expect(connectionTrigger).toBeFocused();
    focusChecks.push('长名称连接方式弹窗完成/Escape 均返回同一客户端入口');
    const addClient = page.getByRole('button', { name: '添加外部客户端', exact: true });
    await addClient.click();
    const clientChoice = page.getByRole('dialog', { name: '选择客户端', exact: true });
    await expect(clientChoice).toBeVisible();
    await clientChoice.getByRole('button', { name: '使用 Claude Code', exact: true }).click();
    await expect(clientChoice).toBeHidden();
    const creation = page.getByRole('dialog', { name: '选择外部 AI 客户端权限', exact: true });
    await creation.getByRole('textbox', { name: '客户端名称', exact: true }).fill(syntheticClientName);
    const scope = creation.getByRole('button', { name: /授权范围/ });
    await expect(scope).toContainText('不授权普通笔记（仅任务工作区）');
    await expect(creation.getByRole('button', { name: '创建配对', exact: true })).toBeDisabled();
    await scope.click();
    await page.getByRole('option', { name: '当前知识空间', exact: true }).click();
    await expect(scope).toContainText('当前知识空间');
    await expect(creation.getByRole('checkbox', { name: '我了解所选范围内的笔记片段会发给该客户端所属的厂商', exact: true })).not.toBeChecked();
    await expect(creation.getByRole('checkbox', { name: '允许读取知识点（全部开放，默认关闭）', exact: true })).not.toBeChecked();
    await expect(creation.getByRole('checkbox', { name: '同时允许该客户端提交待审核的知识候选（默认不允许）', exact: true })).not.toBeChecked();
    await expect(creation.getByRole('button', { name: '创建配对', exact: true })).toBeDisabled();
    await capture('14-external-client-unapproved-draft', creation);
    await creation.getByRole('button', { name: '取消', exact: true }).click();
    await expect(creation).toBeHidden(); await expect(addClient).toBeFocused();
    focusChecks.push('未授权客户端草稿取消返回添加入口；不创建配对或改变读取授权');

    await page.reload();
    await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('');
    await expect(page.getByRole('textbox', { name: '每日上限金额（元）', exact: true })).toHaveValue('20');
    expect(await page.evaluate(sample => [...Object.values(localStorage), ...Object.values(sessionStorage)]
      .some(value => typeof value === 'string' && value.includes(sample)), syntheticPassword)).toBe(false);
    readonlyChecks.push('刷新后 API Key 为空、预算仍为原值；合成密码未进入 localStorage/sessionStorage');
    expect(scenarios).toHaveLength(14);
    expect(network.syntheticInspections).toEqual([`POST /api/local-runtime/backups/${syntheticBackupId}/inspect`]);
    expect(network.blocked.filter(request => request !== 'POST /api/local-runtime/sync/wake'), '未知请求、外部请求与主动写入均不得发生').toEqual([]);
    expect(network.requests.filter(request => !request.startsWith('GET ') && request !== 'POST /api/local-runtime/sync/wake'))
      .toEqual(network.syntheticInspections);
    expect(errors, '页面脚本错误不能作为成功截图基线').toEqual([]);
  } finally {
    const path = info.outputPath('scenario-manifest.json');
    await writeFile(path, JSON.stringify({ schema: 1, sourcePRHead: process.env.KNOWRA_EVIDENCE_PR_HEAD,
      builtCommit: process.env.KNOWRA_EVIDENCE_SHA, sourceTree: process.env.KNOWRA_EVIDENCE_SOURCE_TREE,
      viewport, syntheticData: true, syntheticRuntimeOnly: true, desktopBridgeInstalled: false,
      chromiumSandbox: true, browserVersion: browser.version(), scenarios, focusChecks, readonlyChecks, layoutChecks,
      pageErrors: errors, apiRequests: network.requests, blockedRequests: network.blocked,
      blockedAutomaticWakeRequests: network.blockedWakeRequests, syntheticInspections: network.syntheticInspections,
      limitations: ['CSS 视口合成验收，不是真实手机软键盘/OriginOS 或原生桌面应用验收',
        '所有 API 请求由 context 夹具处理；外部网络、未知 API、WebSocket 和写入均阻断，只有指定检查 POST 返回固定合成结果',
        '不实际同步、解决冲突、创建备份、导入/导出/恢复、配置模型、保存预算、配对客户端或改变授权',
        '密码掩码仅使用 SYNTHETIC_UI_ONLY_NOT_A_CREDENTIAL，绝非真实密码或 API Key'] }, null, 2));
    await info.attach('scenario-manifest', { path, contentType: 'application/json' });
  }
});
