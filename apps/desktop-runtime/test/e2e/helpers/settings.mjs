import { expect } from '@playwright/test';

/** 设置默认显示工作区；进入或刷新设置后，从真实分类导航打开模型和外部客户端配置。 */
export async function selectModelSettings(page) {
  await page
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: /^模型接入/ })
    .click();
  await expect(page.getByRole('heading', { name: '模型接入', exact: true })).toBeVisible();
}
