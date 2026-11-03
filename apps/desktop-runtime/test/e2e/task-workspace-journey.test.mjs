import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import sharp from 'sharp';
import { chromium, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startLocalRuntime } from '../../src/runtime-server.mjs';

const adapter = fileURLToPath(new URL('../../src/mcp/adapter.mjs', import.meta.url));
const distRoot = fileURLToPath(new URL('../../../web/dist/', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

// 不替换 HTTP、SQLite、授权、编辑器或 stdio；所有资料均为本测试生成。
// 需先 npm run build:web。受限沙盒不能启动 socket/Chromium 时，不跳过或冒称通过。
test(
  '真实页面与 stdio：创建图文任务、领取协写、退回重做、人工接受、刷新重启及私人边界',
  { timeout: 120000 },
  async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-task-journey-'));
    const options = {
      dataDirectory: directory,
      distRoot,
      syncOptions: { autoSync: false },
      mcpLimits: { perMinute: 100 }
    };
    let runtime, browser, client;
    t.after(async () => {
      await client?.close();
      await browser?.close();
      await runtime?.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });
    runtime = await startLocalRuntime(options);
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(12000);
    const screenshots = fileURLToPath(new URL('../../../../test-results/task-workspace-journey/', import.meta.url));
    fs.mkdirSync(screenshots, { recursive: true });
    // 仅在合成工作区页面调用，绝不捕获配对配置、令牌或设置页。
    const captureWorkspace = async (name, target) => {
      assert(new URL(page.url()).hash.startsWith('#/task-workspaces'));
      await target.scrollIntoViewIfNeeded();
      await expect(target).toBeInViewport({ ratio: 1 });
      await page.screenshot({
        path: path.join(screenshots, `${name}-desktop.png`),
        fullPage: true,
        animations: 'disabled'
      });
      const desktop = page.viewportSize();
      try {
        for (const [size, width, height] of [
          ['narrow', 390, 844],
          ['tablet', 820, 1180],
          ['tablet-landscape', 1024, 768]
        ]) {
          await page.setViewportSize({ width, height });
          // 工作区使用内部滚动容器；必须看到实际图片/进度卡/验收结果，而非只截入口。
          await target.scrollIntoViewIfNeeded();
          if (name === 'board-progress') {
            const board = page.getByLabel('任务看板', { exact: true });
            await expect.poll(() => board.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
            await expect
              .poll(() =>
                board.evaluate(node => {
                  const main = node.closest('main');
                  return main.scrollWidth <= main.clientWidth;
                })
              )
              .toBe(true);
            await expect
              .poll(() => board.evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length))
              .toBe(1);
          }
          await expect(target).toBeInViewport({ ratio: 1 });
          await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          await expect
            .poll(() =>
              target.evaluate(node => {
                const bounds = node.getBoundingClientRect();
                return bounds.left >= 0 && bounds.right <= innerWidth;
              })
            )
            .toBe(true);
          await page.screenshot({
            path: path.join(screenshots, `${name}-${size}.png`),
            fullPage: true,
            animations: 'disabled'
          });
        }
      } finally {
        await page.setViewportSize(desktop);
      }
    };
    await page.goto(runtime.launchUrl);
    const request = async (route, data, extraHeaders = {}) => {
      const response = await page.request.fetch(runtime.origin + route, {
        method: data === undefined ? 'GET' : 'POST',
        ...(data === undefined ? {} : { data }),
        headers: { 'X-Knowra-Dataset': runtime.store.getStatus().datasetId, ...extraHeaders }
      });
      const body = await response.json();
      assert(response.ok(), `${route}: ${response.status()} ${JSON.stringify(body)}`);
      return body.data;
    };
    const createThroughDialog = async (button, name) => {
      await page.getByRole('button', { name: button, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: button, exact: true });
      await dialog.getByRole('textbox', { name: '名称', exact: true }).fill(name);
      await dialog.getByRole('button', { name: '创建', exact: true }).click();
      await expect(dialog).toHaveCount(0);
    };
    const routeIds = () => new URLSearchParams(new URL(page.url()).hash.split('?')[1]);
    const editor = page.locator('[data-editor-ready="true"] .ProseMirror');
    const editorRegion = page.getByRole('region', { name: '协作文档编辑器', exact: true });
    const taskRegion = page.getByRole('region', { name: '任务详情', exact: true });
    const pixels = await sharp({ create: { width: 19, height: 11, channels: 3, background: '#1d7bb0' } })
      .png()
      .toBuffer();

    await page.goto(`${runtime.origin}/#/task-workspaces`);
    await createThroughDialog('创建工作区', '合成端到端工作区');
    await expect(page.getByRole('button', { name: '新建文档', exact: true })).toBeEnabled();
    const workspaceId = routeIds().get('workspace');
    assert(workspaceId);
    await createThroughDialog('新建文档', '合成图文说明');
    await expect(editor).toBeVisible();
    const documentId = routeIds().get('document');
    assert(documentId);
    await editor.fill('请核对蓝色合成图片，并在协作文档写明核对结果。');
    await page
      .getByLabel('上传工作区图片', { exact: true })
      .setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: pixels });
    const image = editorRegion.locator('img[data-editor-image]');
    await expect(image).toHaveAttribute('src', /^blob:/);
    await expect.poll(() => image.evaluate(node => node.complete && node.naturalWidth === 19)).toBe(true);
    await page.getByRole('button', { name: '保存文档', exact: true }).click();
    await expect(editorRegion.getByRole('status')).toContainText('文档版本已保存');
    let document = await request(`/api/task-workspaces/${workspaceId}/documents/${documentId}`);
    assert.equal(document.attachments.length, 1);
    const attachment = document.attachments[0];
    assert.equal(attachment.sha256, hash(pixels));
    const imageUri = `/api/task-workspaces/${workspaceId}/documents/${documentId}/attachments/${attachment.id}/content`;
    assert(document.markdown.includes(imageUri));
    const requirementVersion = document.currentVersionId;
    await page.reload();
    await expect(image).toHaveAttribute('src', `${imageUri}?versionId=${requirementVersion}`);
    await expect.poll(() => image.evaluate(node => node.complete && node.naturalWidth)).toBe(19);

    await captureWorkspace('document-image', image);

    // 恢复不可信的未保存草稿，验证真实 Milkdown DOM 在任何请求发出前屏蔽资源。
    // route 只记录并阻止意外外发；出现一次请求就失败，绝不以 route.fulfill 伪装通过。
    const forbiddenRequests = [];
    await page.route('https://task-workspace-leak.invalid/**', route => {
      forbiddenRequests.push(route.request().url());
      return route.abort();
    });
    const capability = await request('/api/task-workspaces/capabilities');
    const draftKey = `knowra:task-document:${JSON.stringify([capability.datasetId, capability.datasetEpoch, workspaceId, documentId])}`;
    await page.evaluate(
      ({ key, title, baseRevision }) =>
        localStorage.setItem(
          key,
          JSON.stringify({
            title,
            baseRevision,
            markdown:
              '远程图片边界探针\n\n![不可外发](https://task-workspace-leak.invalid/probe.png)\n\n<img src="https://task-workspace-leak.invalid/html.png">'
          })
        ),
      { key: draftKey, title: document.title, baseRevision: document.revision }
    );
    await page.reload();
    await expect(editor).toContainText('远程图片边界探针');
    await expect(editor.locator('img[src^="https:"]')).toHaveCount(0);
    await page.waitForTimeout(250);
    assert.deepEqual(forbiddenRequests, []);
    await page.evaluate(key => localStorage.removeItem(key), draftKey);
    await page.reload();
    await expect(image).toHaveAttribute('src', `${imageUri}?versionId=${requirementVersion}`);

    await createThroughDialog('新建任务', '核对图文并协写');
    const taskId = routeIds().get('task');
    assert(taskId);
    await taskRegion.getByRole('button', { name: '发布需求', exact: true }).click();
    const publish = page.getByRole('dialog', { name: '发布需求', exact: true });
    await publish.getByRole('button', { name: /需求说明文档/ }).click();
    await page.getByRole('option', { name: '合成图文说明', exact: true }).click();
    // 必填星号在 label.textContent 中，但 aria-hidden 不属于用户可访问名称。
    await publish
      .getByRole('textbox', { name: '验收标准（每行一条）', exact: true })
      .fill('图片字节与上传一致\n成果正文包含核对结论');
    await publish.getByRole('textbox', { name: '包含范围', exact: true }).fill('当前工作区');
    await publish.getByRole('textbox', { name: '不包含范围', exact: true }).fill('私人笔记');
    await publish.getByRole('button', { name: '确认发布冻结版本' }).click();
    await expect(publish).toHaveCount(0);
    await expect(taskRegion.getByText('待领取', { exact: true })).toBeVisible();
    const taskPath = `/api/task-workspaces/${workspaceId}/tasks/${taskId}`;
    let task = await request(taskPath);
    assert.equal(task.currentRequirement.description.versionId, requirementVersion);

    // 创建普通合成个人笔记，再通过真实设置 UI 创建 scope:none 的纯任务配对。
    const space = await request('/api/knowledge/spaces/default', {});
    const privateText = `PRIVATE-SYNTHETIC-${randomUUID()}`;
    const privateNote = await request('/api/knowledge/notes', {
      spaceId: space.id,
      title: '合成个人笔记',
      rawMarkdown: privateText
    });
    await page.getByRole('button', { name: '外部 Agent 授权', exact: true }).click();
    await page.getByRole('button', { name: '添加外部客户端', exact: true }).click();
    await page
      .getByRole('dialog', { name: '选择客户端', exact: true })
      .getByRole('button', { name: '使用 Codex', exact: true })
      .click();
    const permissions = page.getByRole('dialog', { name: '选择外部 AI 客户端权限', exact: true });
    await permissions.getByRole('textbox', { name: '客户端名称', exact: true }).fill('合成任务验收 Agent');
    await expect(permissions.getByRole('button', { name: /授权范围/ })).toContainText('不授权普通笔记（仅任务工作区）');
    const checkPermission = async name => {
      const checkbox = permissions.getByRole('checkbox', { name, exact: true });
      await checkbox.locator('xpath=ancestor::label').click();
      await expect(checkbox).toBeChecked();
    };
    const createPairing = permissions.getByRole('button', { name: '创建配对', exact: true });
    await expect(createPairing).toBeDisabled();
    await checkPermission('读取工作区：合成端到端工作区');
    await checkPermission('协写文档：合成端到端工作区');
    await checkPermission('领取与执行任务：合成端到端工作区');
    await checkPermission('读取文档引用的图片：合成端到端工作区');
    await expect(createPairing).toBeDisabled();
    await checkPermission('我了解所选工作区现有及以后新建的文档会发给该客户端及其所属厂商');
    await expect(createPairing).toBeDisabled();
    await checkPermission('我另外同意将这些工作区中文档引用的图片原始内容发送给该客户端及其所属厂商');
    await expect(createPairing).toBeEnabled();
    const pairingResponsePromise = page.waitForResponse(
      response =>
        response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/local-runtime/mcp/pairings'
    );
    await createPairing.click();
    const pairingResponse = await pairingResponsePromise;
    assert.equal(pairingResponse.status(), 201, await pairingResponse.text());
    const pairingRequest = pairingResponse.request();
    assert.equal(pairingRequest.headers()['x-task-workspace-epoch'], capability.datasetEpoch);
    const pairingInput = pairingRequest.postDataJSON();
    assert.deepEqual(pairingInput.scope, { kind: 'none' });
    assert.equal(pairingInput.spaceId, undefined);
    assert.equal(pairingInput.taskWorkspaceConfirmed, true);
    assert.equal(pairingInput.taskImagesConfirmed, true);
    assert.deepEqual(pairingInput.taskWorkspaceGrants, [
      { workspaceId, read: true, writeDocuments: true, executeTasks: true, includeImages: true }
    ]);
    const pairing = (await pairingResponse.json()).data;
    await expect(permissions).toHaveCount(0);
    await page.goto(`${runtime.origin}/#/task-workspaces?workspace=${workspaceId}&task=${taskId}`);
    await expect(taskRegion.getByText('待领取', { exact: true })).toBeVisible();
    const connect = async () => {
      client = new Client({ name: 'synthetic-task-journey', version: '1.0.0' });
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [adapter, '--pairing-file', pairing.pairingFile],
          stderr: 'pipe'
        })
      );
    };
    await connect();
    const call = (name, args) => client.callTool({ name, arguments: args });
    const textCall = async (name, args) => {
      const result = await call(name, args);
      assert(!result.isError, `${name}: ${JSON.stringify(result)}`);
      assert.equal(result.content[0].type, 'text');
      return JSON.parse(result.content[0].text);
    };
    const names = (await client.listTools()).tools.map(tool => tool.name);
    assert(names.includes('tasks_claim'));
    assert(names.includes('task_images_read'));
    for (const forbidden of [
      'tasks_review',
      'tasks_publish',
      'tasks_cancel',
      'notes_read',
      'notes_search',
      'notes_list',
      'knowledge_read',
      'knowledge_search'
    ])
      assert(!names.includes(forbidden));
    for (const [tool, args] of [
      ['notes_read', { noteId: privateNote.id }],
      ['task_documents_read', { workspaceId, documentId: privateNote.id }],
      ['task_documents_list', { workspaceId: randomUUID() }]
    ]) {
      const denied = await call(tool, args);
      assert.equal(denied.isError, true);
      assert(!JSON.stringify(denied).includes(privateText));
    }
    const claimed = await textCall('tasks_claim', {
      operationId: randomUUID(),
      workspaceId,
      taskId,
      expectedRevision: task.revision
    });
    let attempt = claimed.data.attempt;
    await textCall('tasks_progress', {
      operationId: randomUUID(),
      workspaceId,
      taskId,
      attemptId: attempt.id,
      generation: attempt.generation,
      message: '正在核对合成图片字节'
    });
    await page.getByRole('button', { name: '任务看板', exact: true }).click();
    await page.getByRole('button', { name: '刷新看板', exact: true }).click();
    const taskCard = page.getByRole('article', { name: '核对图文并协写任务卡', exact: true });
    await expect(taskCard).toContainText('最新进度：正在核对合成图片字节');
    await expect(taskCard).toContainText('执行客户端：');
    await expect(taskCard.locator('time[datetime]')).toHaveCount(1);
    // 真浏览器验证卡片不继承 pill；手机首屏直接看到执行卡，收纳入口仍可键盘访问。
    await expect
      .poll(() =>
        page
          .getByLabel('任务看板', { exact: true })
          .evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length)
      )
      .toBe(3);
    await expect
      .poll(() => taskCard.getByRole('button').evaluate(node => parseFloat(getComputedStyle(node).borderRadius) < 24))
      .toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => taskCard.evaluate(node => node.getBoundingClientRect().top < 500)).toBe(true);
    await expect(taskCard).toBeInViewport({ ratio: 1 });
    const contexts = [
      page.getByRole('button', { name: /^协作工作区 ·/ }),
      page.getByRole('button', { name: /^协作文档 ·/ })
    ];
    for (const trigger of contexts) {
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      assert((await trigger.boundingBox()).height >= 44);
      for (let repeat = 0; repeat < 2; repeat++) {
        await trigger.click();
        await expect(trigger).toHaveAttribute('aria-expanded', 'true');
        await page.keyboard.press('Escape');
        await expect(trigger).toHaveAttribute('aria-expanded', 'false');
        await expect(trigger).toBeFocused();
      }
    }
    for (let repeat = 0; repeat < 2; repeat++) {
      await contexts[1].click();
      await page.getByRole('button', { name: '合成图文说明', exact: true }).click();
      await expect(contexts[1]).toHaveAttribute('aria-expanded', 'false');
      // 打开文档发生路由切换：沿用 App 的 feature-stage 焦点语义，
      // 不与新内容导航争抢焦点；Escape/取消的触发器恢复在上面单独强断言。
      await expect.poll(() => routeIds().get('document')).toBe(documentId);
      await expect(page.locator('#feature-stage')).toBeFocused();
      await expect(editor).toBeVisible();
      await expect(editorRegion.getByRole('textbox', { name: '文档标题', exact: true })).toHaveValue('合成图文说明');
      await page.getByRole('button', { name: '任务看板', exact: true }).click();
      await expect(taskCard).toBeVisible();
    }
    await contexts[0].click();
    await page.getByRole('button', { name: '合成端到端工作区', exact: true }).click();
    await expect(contexts[0]).toBeFocused();
    await expect(contexts[0]).toHaveAttribute('aria-expanded', 'false');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await captureWorkspace('board-progress', taskCard);
    await taskCard.getByRole('button', { name: '核对图文并协写', exact: true }).click();
    const readImage = async versionId => {
      const result = await call('task_images_read', {
        workspaceId,
        documentId,
        versionId,
        attachmentId: attachment.id
      });
      assert(!result.isError, JSON.stringify(result));
      assert.equal(result.content[0].type, 'image', '必须是 MCP image block，而非包在 text JSON 中');
      assert.equal(result.content[0].mimeType, 'image/png');
      assert.deepEqual(Buffer.from(result.content[0].data, 'base64'), pixels);
      assert.equal(result.content[1].type, 'text');
    };
    await readImage(requirementVersion);
    const edited = await textCall('task_documents_update', {
      operationId: randomUUID(),
      workspaceId,
      documentId,
      expectedRevision: document.revision,
      markdown: `已核对蓝色合成图片，字节一致。\n\n![核对图片](${imageUri})`
    });
    document = edited.data.document;
    const frozen = await textCall('task_documents_read', { workspaceId, documentId, versionId: requirementVersion });
    assert(!JSON.stringify(frozen).includes('已核对蓝色合成图片'));
    const submit = () =>
      textCall('tasks_submit', {
        operationId: randomUUID(),
        workspaceId,
        taskId,
        attemptId: attempt.id,
        generation: attempt.generation,
        summary: '合成 Agent 已核对图文，请人工验收。',
        artifacts: [{ documentId, versionId: document.currentVersionId }]
      });
    assert.equal((await submit()).data.task.status, 'review');
    await page.reload();
    await expect(taskRegion.getByText('待验收', { exact: true })).toBeVisible();
    await taskRegion.getByRole('button', { name: '退回重做', exact: true }).click();
    const returned = page.getByRole('dialog', { name: '退回重做', exact: true });
    await returned.getByRole('textbox', { name: '验收意见', exact: true }).fill('请再次确认冻结图片版本。');
    await returned.getByRole('button', { name: '确认退回当前成果' }).click();
    await expect(returned).toHaveCount(0);
    await expect(taskRegion.getByText('待领取', { exact: true })).toBeVisible();
    task = await request(taskPath);
    const retried = await textCall('tasks_claim', {
      operationId: randomUUID(),
      workspaceId,
      taskId,
      expectedRevision: task.revision
    });
    assert(retried.data.attempt.generation > attempt.generation);
    attempt = retried.data.attempt;
    await readImage(document.currentVersionId);
    await submit();
    await page.reload();
    await taskRegion.getByRole('button', { name: '查看成果 1 的冻结版本' }).click();
    const frozenRegion = page.getByRole('region', { name: '冻结文档版本', exact: true });
    await expect(frozenRegion).toContainText('已核对蓝色合成图片');
    await expect(frozenRegion.getByRole('button', { name: '保存文档' })).toHaveCount(0);
    await page.getByRole('button', { name: '任务看板', exact: true }).click();
    await page.getByRole('button', { name: '核对图文并协写', exact: true }).click();
    await taskRegion.getByRole('button', { name: '接受成果', exact: true }).click();
    const accept = page.getByRole('dialog', { name: '确认接受成果', exact: true });
    await accept.getByRole('textbox', { name: '验收意见', exact: true }).fill('已查看冻结成果，接受。');
    await accept.getByRole('button', { name: '确认接受当前成果' }).click();
    await expect(accept).toHaveCount(0);
    await expect(taskRegion.getByText('已接受', { exact: true })).toBeVisible();
    await captureWorkspace('review-accepted', taskRegion.getByText('已接受成果', { exact: true }));
    task = await request(taskPath);
    assert.equal(task.status, 'accepted');
    assert.equal(task.latestReview.actor.kind, 'user');
    assert.equal(runtime.store.state.notes.length, 1);
    assert.equal(runtime.store.state.attachments.length, 0);
    assert(
      !JSON.stringify(runtime.store.exportSnapshot()).includes('已核对蓝色合成图片'),
      '工作区不进入原笔记同步快照'
    );

    // 完全关闭 stdio 和宿主，再使用同一持久化目录启动；不使用内存状态模拟重启。
    await client.close();
    client = null;
    await runtime.close();
    runtime = null;
    runtime = await startLocalRuntime(options);
    await page.goto(runtime.launchUrl);
    await page.goto(`${runtime.origin}/#/task-workspaces?workspace=${workspaceId}&task=${taskId}`);
    await expect(taskRegion.getByText('已接受', { exact: true })).toBeVisible();
    await taskRegion.getByRole('button', { name: '查看成果 1 的冻结版本' }).click();
    await expect(frozenRegion).toContainText('已核对蓝色合成图片');
    await expect
      .poll(() => frozenRegion.locator('img[data-editor-image]').evaluate(node => node.complete && node.naturalWidth))
      .toBe(19);
    await connect();
    await readImage(document.currentVersionId);
    assert.equal((await request(taskPath)).latestReview.comment, '已查看冻结成果，接受。');
    assert.deepEqual(forbiddenRequests, []);
  }
);
