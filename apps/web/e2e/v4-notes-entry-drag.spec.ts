import { expect, type Page } from '@playwright/test';
import { test } from './fixtures/syntheticTest';
import { mockShellServices } from './fixtures/shellServices';

test('笔记和文件夹可在索引、侧栏及根目录之间拖动', async ({ page }) => {
  const workspace = await mockMoveWorkspace(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '笔记工作台' })).toBeVisible();
  await page.goto('/#/materials');
  await expect(page.getByRole('article', { name: '笔记索引' })).toBeVisible();

  const index = page.getByRole('article', { name: '笔记索引' });
  const noteTile = index.locator('[data-entry-item]').filter({ hasText: '待移动笔记' }).locator('button[draggable="true"]');
  const sidebarFolder = page.locator('[data-folder-id="folder-b"]');
  await noteTile.dragTo(sidebarFolder);
  await expect.poll(() => workspace.notes[0].folderId).toBe('folder-b');
  expect(workspace.patchCalls).toContainEqual({ kind: 'note', id: 'note-1', parentId: 'folder-b' });

  await page.getByRole('button', { name: '展开甲目录' }).click();
  const folderTile = index.locator('[data-entry-item][data-kind="folder"]').getByRole('button', { name: /^甲目录(?:\d+ 项)?$/ });
  await folderTile.dragTo(page.locator('[data-folder-id="folder-child"]'));
  expect(workspace.patchCalls).toHaveLength(1);

  const targetTile = index.locator('[data-entry-item][data-kind="folder"]').getByRole('button', { name: /^乙目录(?:\d+ 项)?$/ });
  await folderTile.dragTo(targetTile);
  await expect.poll(() => workspace.folders[0].parentId).toBe('folder-b');
  expect(workspace.patchCalls).toContainEqual({ kind: 'folder', id: 'folder-a', parentId: 'folder-b' });

  await page.getByRole('button', { name: '列表视图' }).click();
  const noteRow = index.locator('tr[data-entry-item]').filter({ hasText: '待移动笔记' }).locator('button[draggable="true"]');
  await noteRow.dragTo(page.locator('[class*="libraryRow"]'));
  await expect.poll(() => workspace.notes[0].folderId).toBeNull();
  expect(workspace.patchCalls).toContainEqual({ kind: 'note', id: 'note-1', parentId: null });
});

test('从侧栏移走笔记后，当前文件夹的服务端索引立即刷新', async ({ page }) => {
  const workspace = await mockMoveWorkspace(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '笔记工作台' })).toBeVisible();
  await page.goto('/#/materials?folder=folder-a');
  await expect(page.getByRole('article', { name: '笔记索引' })).toBeVisible();
  await page.getByRole('button', { name: '展开甲目录' }).click();
  const indexContent = page.getByTestId('notes-index-scroll');
  await expect(indexContent.getByText('待移动笔记')).toBeVisible();

  await page.getByRole('complementary', { name: '笔记上下文导航' }).locator('[data-note-id="note-1"]').dragTo(page.locator('[class*="libraryRow"]'));
  await expect.poll(() => workspace.notes[0].folderId).toBeNull();
  await expect(indexContent.getByText('待移动笔记')).toHaveCount(0);
});

test('悬停文件夹会展开目录，空白区域可接收移动到当前文件夹', async ({ page }) => {
  const workspace = await mockMoveWorkspace(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '笔记工作台' })).toBeVisible();
  await page.goto('/#/materials');
  const index = page.getByRole('article', { name: '笔记索引' });
  await expect(index).toBeVisible();

  const source = index.locator('[data-entry-item][data-kind="folder"]').getByRole('button', { name: /^乙目录(?:\d+ 项)?$/ });
  const target = page.locator('[data-folder-id="folder-a"]');
  await source.evaluate((element) => {
    const transfer = new DataTransfer();
    (window as typeof window & { __entryDragTransfer?: DataTransfer }).__entryDragTransfer = transfer;
    element.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await target.evaluate((element) => {
    const transfer = (window as typeof window & { __entryDragTransfer?: DataTransfer }).__entryDragTransfer;
    element.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await expect(target).toHaveAttribute('data-drop-active', 'true');
  await expect(page.locator('[data-folder-id="folder-child"]')).toBeVisible();
  await source.evaluate((element) => element.dispatchEvent(new DragEvent('dragend', { bubbles: true })));

  await page.goto('/#/materials?folder=folder-b');
  await expect(index).toBeVisible();
  if (await page.getByRole('button', { name: '展开甲目录' }).count()) {
    await page.getByRole('button', { name: '展开甲目录' }).click();
  }
  const noteSource = page.getByRole('complementary', { name: '笔记上下文导航' }).locator('[data-note-id="note-1"]');
  await noteSource.dragTo(page.getByTestId('notes-index-scroll'), { targetPosition: { x: 400, y: 300 } });
  await expect.poll(() => workspace.notes[0].folderId).toBe('folder-b');
  await expect(page.getByTestId('notes-index-scroll').getByText('待移动笔记')).toBeVisible();
});

test('目标目录拒绝移动时保留原位置并显示原因', async ({ page }) => {
  const workspace = await mockMoveWorkspace(page);
  workspace.rejectNextMove();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '笔记工作台' })).toBeVisible();
  await page.goto('/#/materials');
  const note = page.getByRole('article', { name: '笔记索引' })
    .locator('[data-entry-item]').filter({ hasText: '待移动笔记' }).locator('button[draggable="true"]');
  await note.dragTo(page.locator('[data-folder-id="folder-b"]'));
  await expect(page.getByRole('alert')).toContainText('目标目录已有同名笔记');
  expect(workspace.notes[0].folderId).toBe('folder-a');
  await page.getByRole('button', { name: '关闭移动错误提示' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('全部笔记空白处不代表根目录，笔记库页面空白处可移入根目录', async ({ page }) => {
  const workspace = await mockMoveWorkspace(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '笔记工作台' })).toBeVisible();
  await page.goto('/#/materials');
  const index = page.getByRole('article', { name: '笔记索引' });
  const content = page.getByTestId('notes-index-scroll');
  await index.locator('[data-entry-item]').filter({ hasText: '待移动笔记' })
    .locator('button[draggable="true"]').dragTo(content, { targetPosition: { x: 400, y: 300 } });
  expect(workspace.patchCalls).toHaveLength(0);

  await page.goto('/#/materials?scope=root');
  await expect(index).toBeVisible();
  if (await page.getByRole('button', { name: '展开甲目录' }).count()) {
    await page.getByRole('button', { name: '展开甲目录' }).click();
  }
  await page.getByRole('complementary', { name: '笔记上下文导航' }).locator('[data-note-id="note-1"]').dragTo(content, { targetPosition: { x: 400, y: 300 } });
  await expect.poll(() => workspace.notes[0].folderId).toBeNull();
  await expect(content.getByText('待移动笔记')).toBeVisible();
});

test('V5 笔记选中使用中性底色，索引保留独立滚动和图标焦点', async ({ page }) => {
  await mockMoveWorkspace(page);
  await page.goto('/#/materials');
  const index = page.getByRole('article', { name: '笔记索引' });
  await expect(index).toBeVisible();
  await expect(index.getByText('INDEX', { exact: true })).toHaveCount(0);
  await expect(index.locator('[data-art-kind] > svg')).toHaveCount(3);
  const content = page.getByTestId('notes-index-scroll');
  await expect(content).toHaveCSS('background-image', 'none');
  await expect(content).toHaveCSS('overflow-y', 'auto');
  await page.getByRole('button', { name: '图标视图' }).click();
  const tile = index.locator('[data-entry-item]').filter({ hasText: '待移动笔记' }).locator('button[draggable="true"]');
  await expect(tile).toHaveCSS('border-radius', '10px');
  await expect(tile).toHaveCSS('transform', 'none');
  // A mouse-triggered view change does not establish :focus-visible. Tab from
  // the preceding selection control to exercise the actual keyboard entry path.
  await index.getByRole('checkbox', { name: '选择待移动笔记', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(tile).toBeFocused();
  await expect(tile).not.toHaveCSS('outline-style', 'none');

  await page.getByRole('button', { name: '展开甲目录' }).click();
  const note = page.getByRole('complementary', { name: '笔记上下文导航' }).locator('[data-note-id="note-1"]');
  await note.click();
  await expect(note).toHaveAttribute('aria-current', 'page');
  await expect(note).toHaveCSS('color', 'rgb(23, 24, 27)');
  await expect(note).toHaveCSS('background-color', 'rgba(24, 30, 48, 0.075)');
  await expect(note).toHaveCSS('border-left-width', '0px');
  // 侧栏的文字与文档图标统一使用深色墨色，保留选中背景和键盘焦点验收。
  await expect(note.locator('svg path').last()).toHaveCSS('stroke', 'rgb(23, 24, 27)');
});

test('V5 窄屏目录展开按钮和笔记触点至少44px', async ({ page }) => {
  await mockMoveWorkspace(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/materials');
  const sidebar = page.getByRole('complementary', { name: '笔记上下文导航' });
  if (!(await sidebar.isVisible())) await page.getByRole('button', { name: '切换侧栏' }).click();
  const toggle = page.getByRole('button', { name: '展开甲目录' });
  await expect(toggle).toBeVisible();
  const toggleBox = await toggle.boundingBox();
  expect(toggleBox?.width).toBeGreaterThanOrEqual(44);
  expect(toggleBox?.height).toBeGreaterThanOrEqual(44);
  await toggle.click();
  const noteBox = await page.getByRole('complementary', { name: '笔记上下文导航' }).locator('[data-note-id="note-1"]').boundingBox();
  expect(noteBox?.height).toBeGreaterThanOrEqual(44);
});

async function mockMoveWorkspace(page: Page) {
  await mockShellServices(page);
  const folders = [
    { id: 'folder-a', name: '甲目录', parentId: null as string | null },
    { id: 'folder-child', name: '子目录', parentId: 'folder-a' as string | null },
    { id: 'folder-b', name: '乙目录', parentId: null as string | null }
  ];
  const notes = [{
    id: 'note-1', title: '待移动笔记', folderId: 'folder-a' as string | null,
    tagIds: [], internalLinks: [], rawMarkdown: '', contentLoaded: false,
    favorite: false, deleted: false, status: 'draft',
    createdAt: '2026-08-18T08:00:00.000Z', updatedAt: '2026-08-20T08:00:00.000Z'
  }];
  const patchCalls: Array<{ kind: 'folder' | 'note'; id: string; parentId: string | null }> = [];
  let rejectNextMove = false;
  const tree = (parentId: string | null): unknown[] => folders.filter((folder) => folder.parentId === parentId)
    .map((folder) => ({ ...folder, children: tree(folder.id) }));

  await page.route('**/api/knowledge/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    let data: unknown = [];
    if (request.method() === 'PATCH' && rejectNextMove) {
      rejectNextMove = false;
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'ENTRY_NAME_CONFLICT', message: '目标目录已有同名笔记' } }) });
      return;
    }
    if (request.method() === 'PATCH' && path.includes('/folders/')) {
      const id = path.split('/').pop()!;
      const body = request.postDataJSON() as { parentId: string | null };
      const folder = folders.find((item) => item.id === id)!;
      folder.parentId = body.parentId;
      patchCalls.push({ kind: 'folder', id, parentId: body.parentId });
      data = folder;
    } else if (request.method() === 'PATCH' && path.includes('/notes/')) {
      const id = path.split('/').pop()!;
      const body = request.postDataJSON() as { folderId: string | null };
      const note = notes.find((item) => item.id === id)!;
      note.folderId = body.folderId;
      patchCalls.push({ kind: 'note', id, parentId: body.folderId });
      data = note;
    } else if (path.endsWith('/spaces')) {
      data = [{ id: 'space-1', name: '主空间' }];
    } else if (path.endsWith('/folders/tree')) {
      data = tree(null);
    } else if (/\/notes\/[^/]+$/.test(path)) {
      data = notes.find(note => note.id === path.split('/').pop()) ?? null;
    } else if (path.endsWith('/notes')) {
      data = notes.filter((note) => {
        if (url.searchParams.get('folderId') && note.folderId !== url.searchParams.get('folderId')) return false;
        if (url.searchParams.get('deletedOnly') === 'true') return note.deleted;
        return !note.deleted;
      });
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
  });
  return { folders, notes, patchCalls, rejectNextMove: () => { rejectNextMove = true; } };
}
