import { expect } from '@playwright/test';

/** 空库也显示新建入口；初始化和新建操作始终按工具栏语义定位。 */
export function knowledgeCreateButton(page) {
  return page
    .getByRole('toolbar', { name: '知识库工具栏', exact: true })
    .getByRole('button', { name: '新建知识候选', exact: true });
}

/** 状态已迁入筛选弹层；核对选中态并关闭弹层后才能操作背景列表。 */
export async function selectKnowledgeStatus(page, name) {
  await page
    .getByRole('toolbar', { name: '知识库工具栏', exact: true })
    .getByRole('button', { name: '筛选', exact: true })
    .click();
  const menu = page.getByRole('menu', { name: '知识状态', exact: true });
  const option = menu.getByRole('menuitemradio', { name });
  await option.click();
  await expect(option).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
}

/** 详情操作已收进更多菜单；仍通过真实可访问控件执行。 */
export async function clickKnowledgeAction(page, name) {
  await page.getByRole('button', { name: '知识详情更多操作', exact: true }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}
export async function openKnowledgeSources(page) {
  await page.getByRole('tab', { name: '来源', exact: true }).click();
}
