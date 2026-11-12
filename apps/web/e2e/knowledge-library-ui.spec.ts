import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLocalRuntime } from '../../desktop-runtime/src/runtime-server.mjs';

for (const width of [1440, 390])
  for (const mode of ['light', 'dark'] as const) {
    test(`知识库完整工作区：${width}px ${mode}，真实 SQLite 与笔记库外观对照`, async ({ page }, info) => {
      test.setTimeout(120000);
      page.setDefaultTimeout(10000);
      await page.setViewportSize({ width, height: 1000 });
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-library-ui-'));
      const runtime = await startLocalRuntime({
        dataDirectory: root,
        distRoot: fileURLToPath(new URL('../dist/', import.meta.url)),
        logger: { error() {}, warn() {}, info() {} },
        syncOptions: { autoSync: false }
      });
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route =>
        new URL(route.request().url()).origin === runtime.origin ? route.continue() : route.abort()
      );
      const post = async (url: string, data: unknown) => {
        const response = await page.request.post(`${runtime.origin}${url}`, { data });
        expect(response.ok(), await response.text()).toBeTruthy();
        return (await response.json()).data;
      };
      const openSidebar = async () => {
        const nav = page.getByRole('navigation', { name: '知识库视图' });
        if (!(await nav.isVisible())) await page.getByRole('button', { name: '切换知识库侧栏' }).click();
        return nav;
      };
      try {
        await page.goto(runtime.launchUrl);
        const space = await post('/api/knowledge/spaces/default', {});
        await post('/api/knowledge/notes', {
          spaceId: space.id,
          title: '合成笔记参考',
          rawMarkdown: '仅供外观验收，不读取用户资料。'
        });
        for (const [id, title] of [
          ['ui-linked', '合成卷积知识'],
          ['ui-free', '合成长标题知识点与公式 $x^2 + y^2$ 的独立阅读验收']
        ]) {
          await post('/api/knowledge/items', {
            id,
            title,
            canonicalStatement: '合成核心陈述：卷积操作用于提取局部特征。',
            knowledgeType: 'concept',
            sourceMode: 'manual'
          });
        }
        await post('/api/knowledge/concepts/commands', {
          command: {
            type: 'createConcept',
            id: 'ui-cnn',
            expectedRevision: 0,
            operationId: 'ui-create-cnn',
            name: '卷积神经网络',
            aliases: ['CNN'],
            itemIds: ['ui-linked'],
            role: 'subject'
          }
        });
        await page.evaluate(
          mode => localStorage.setItem('knowra:notes-index-appearance:v1', JSON.stringify({ mode })),
          mode
        );
        await page.goto(`${runtime.origin}/#/materials`);
        await page.reload();
        await expect(page.getByRole('button', { name: /合成笔记参考/ }).first()).toBeVisible();
        await page.screenshot({
          path: info.outputPath(`notes-reference-${width}-${mode}.png`),
          animations: 'disabled'
        });
        await page.goto(`${runtime.origin}/#/knowledge`);
        await expect(
          page.getByRole('region', { name: '知识列表内容' }).getByRole('button', { name: /合成卷积知识/ })
        ).toBeVisible();
        const displayOptions = page.getByRole('button', { name: '显示选项（布局、分组、排序、属性）', exact: true });
        await displayOptions.click();
        await page.getByRole('button', { name: '卡片', exact: true }).click();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('list', { name: '知识卡片视图' }).first()).toBeVisible();
        await page.screenshot({
          path: info.outputPath(`knowledge-cards-${width}-${mode}.png`),
          animations: 'disabled'
        });
        await displayOptions.click();
        await page.getByRole('button', { name: '列表', exact: true }).click();
        await page.keyboard.press('Escape');
        const navigation = await openSidebar();
        await navigation.getByRole('button', { name: /^未归入概念/ }).click();
        await expect(page).toHaveURL(/scope=ungrouped/);
        const list = page.getByRole('region', { name: '知识列表内容' });
        await expect(list.getByRole('button', { name: /合成长标题/ })).toBeVisible();
        await expect(list.getByRole('button', { name: /合成卷积知识/ })).toHaveCount(0);
        const search = page.getByRole('searchbox', { name: '搜索知识' });
        await search.locator('..').click();
        await search.pressSequentially('独立阅读');
        await expect(search).toBeFocused();
        await expect(search).toHaveValue('独立阅读');
        await expect(page).toHaveURL(/q=/);
        await list.getByRole('button', { name: /合成长标题/ }).click();
        await expect(page.getByRole('article', { name: '知识详情' })).toContainText('合成核心陈述');
        await page.getByRole('tab', { name: '来源', exact: true }).click();
        await expect(page.getByRole('region', { name: '知识来源' })).toContainText('手动创建');
        await page.getByRole('tab', { name: '学习目标', exact: true }).click();
        await expect(page.getByRole('region', { name: '关联学习目标' })).toBeVisible();
        await page.getByRole('tab', { name: '内容', exact: true }).click();
        await page.screenshot({
          path: info.outputPath(`knowledge-detail-${width}-${mode}.png`),
          animations: 'disabled'
        });
        await page.getByRole('button', { name: '关闭详情', exact: true }).click();
        await (await openSidebar()).getByRole('button', { name: /^候选/ }).click();
        await list.getByRole('button', { name: /合成卷积知识/ }).click();
        await page.getByRole('button', { name: '卷积神经网络 · 主体', exact: true }).click();
        await expect(page.getByRole('article', { name: '概念详情' })).toContainText('主体 1');
        await expect(page.getByRole('region', { name: '概念列表内容', includeHidden: true })).toBeAttached();
        await page.screenshot({ path: info.outputPath(`concept-detail-${width}-${mode}.png`), animations: 'disabled' });
        await page.goBack();
        await expect(page).toHaveURL(/knowledge\?scope=candidate&item=ui-linked/);
        await expect(page.getByRole('article', { name: '知识详情' })).toContainText('合成卷积知识');
        await page.getByRole('button', { name: '关闭详情', exact: true }).click();
        await (await openSidebar()).getByRole('button', { name: /^全部概念/ }).click();
        await page.getByRole('button', { name: '概念显示选项', exact: true }).click();
        await page.getByRole('button', { name: '卡片', exact: true }).click();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('list', { name: '概念卡片视图' })).toBeVisible();
        await page.getByRole('toolbar', { name: '概念工具栏' }).getByRole('button', { name: '新建概念' }).click();
        const editor = page.getByRole('dialog', { name: '新建概念', exact: true });
        await editor.getByRole('textbox', { name: '概念名称' }).fill('未保存的合成概念');
        await editor.getByRole('button', { name: '取消', exact: true }).click();
        const discard = page.getByRole('dialog', { name: '放弃未保存的概念修改？' });
        await expect(discard).toBeVisible();
        await discard.getByRole('button', { name: '继续编辑' }).click();
        await expect(editor.getByRole('textbox', { name: '概念名称' })).toHaveValue('未保存的合成概念');
        await editor.getByRole('button', { name: '保存概念' }).click();
        await expect(editor).toHaveCount(0);
        await expect(page.getByRole('article', { name: '概念详情' })).toContainText('未保存的合成概念');
        await page.getByRole('button', { name: '关闭详情', exact: true }).click();
        await (await openSidebar()).getByRole('button', { name: '概念图（原型）', exact: true }).click();
        await expect(page.getByRole('heading', { name: '概念图（原型）', exact: true })).toBeVisible();
        const graphSearch = page.getByRole('searchbox', { name: '搜索图中概念' });
        await graphSearch.locator('..').click();
        await graphSearch.fill('张量');
        await expect(page).toHaveURL(/knowledge\/graph\?q=/);
        await page
          .getByRole('region', { name: '图中概念搜索结果' })
          .getByRole('button', { name: '张量', exact: true })
          .click();
        await expect(page.getByRole('region', { name: '详情', exact: true })).toContainText('张量');
        await expect(page.getByRole('button', { name: '增量确认演示（实验）' })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
        expect(errors).toEqual([]);
      } catch (error) {
        await page.screenshot({ path: info.outputPath('failure.png'), animations: 'disabled' });
        throw error;
      } finally {
        await page.close();
        await runtime.close();
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }
