import { knowledgeCreateButton } from './helpers/knowledge-index.mjs';
import { openLocalSync, closeLocalSync } from './helpers/workspace-status.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { createFileDataStore } from '../../../api/src/infrastructure/file-data-store.ts';
import { createAppContext } from '../../../api/src/app.factory.ts';
import { createServer } from '../../../api/src/server.ts';
import { startLocalRuntime } from '../../src/runtime-server.mjs';
import { withPageFailureDiagnostics } from '../fixtures/page-failure-diagnostics.mjs';

// 两个真实 SQLite runtime、生产构建与 Chromium；仅合成资料，不调用 AI。
test('桌面人工训练：目标候选重启审阅、配置考点题目保存确认及两设备 HTTP 回收站恢复', { timeout: 180000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-training-ui-'));
  const cloudStore = createFileDataStore(path.join(root, 'cloud.json'));
  const cloud = createAppContext({
    dataStore: cloudStore,
    storageRootDir: root,
    uploadsDir: path.join(root, 'uploads')
  });
  cloud.modules.knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
  const server = createServer({ appContext: cloud, logger: { error() {} } });
  let a, b, browser;
  t.after(async () => {
    await Promise.allSettled([browser?.close(), a?.close(), b?.close()]);
    if (server.listening) await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const cloudOrigin = `http://127.0.0.1:${server.address().port}`;
  const distRoot = fileURLToPath(new URL('../../../web/dist/', import.meta.url));
  const open = name =>
    startLocalRuntime({ dataDirectory: path.join(root, name), distRoot, syncOptions: { autoSync: false } });
  a = await open('a');
  b = await open('b');
  browser = await chromium.launch({
    ...(process.env.KNOWRA_TEST_BROWSER_CHANNEL ? { channel: process.env.KNOWRA_TEST_BROWSER_CHANNEL } : {}),
    ...(process.env.KNOWRA_TEST_BROWSER_EXECUTABLE
      ? { executablePath: process.env.KNOWRA_TEST_BROWSER_EXECUTABLE }
      : {})
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const second = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  second.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  second.on('pageerror', error => errors.push(error.message));
  const screenshot = async (target, name) => {
    if (!process.env.KNOWRA_E2E_OUTPUT) return;
    fs.mkdirSync(process.env.KNOWRA_E2E_OUTPUT, { recursive: true });
    await target.screenshot({ path: path.join(process.env.KNOWRA_E2E_OUTPUT, name), animations: 'disabled' });
  };
  const post = async (target, runtime, route, data) => {
    const response = await target.request.post(`${runtime.origin}${route}`, { data });
    const body = await response.json();
    assert.equal(response.ok(), true, `HTTP ${response.status()} ${route}: ${JSON.stringify(body)}`);
    return body.data;
  };
  const sync = async (target, runtime) => {
    const status = await post(target, runtime, '/api/local-runtime/sync/retry', {});
    assert.equal(status.error, null, JSON.stringify(status));
    assert.equal(status.entityConflict, null, JSON.stringify(status));
    assert.equal(status.pendingEntities, 0, JSON.stringify(status));
  };
  const training = async (target, runtime, kind = '题目') => {
    await target.goto(`${runtime.origin}/#/training`);
    await target.getByRole('button', { name: kind, exact: true }).click();
    await expect(target.getByText('正在加载训练资产…', { exact: true })).toHaveCount(0);
  };
  const card = (target, title) =>
    target
      .getByRole('region', { name: /^(学习目标|考试配置|考点|题目)列表$/ })
      .getByRole('article')
      .filter({ has: target.getByRole('heading', { name: title, exact: true }) });
  const archiveAndRestore = async (title, collection) => {
    await card(page, title).getByRole('button', { name: '归档', exact: true }).click();
    await expect
      .poll(
        () =>
          Boolean(a.store.state[collection][0].archivedAt) || a.store.state[collection][0].reviewStatus === 'archived'
      )
      .toBe(true);
    await page.getByRole('button', { name: '已归档', exact: true }).click();
    await card(page, title).getByRole('button', { name: '取消归档', exact: true }).click();
    await expect
      .poll(
        () =>
          Boolean(a.store.state[collection][0].archivedAt) || a.store.state[collection][0].reviewStatus === 'archived'
      )
      .toBe(false);
    await page.getByRole('button', { name: '使用中', exact: true }).click();
    await expect(card(page, title)).toBeVisible();
  };
  await withPageFailureDiagnostics(
    page,
    async () => {
      await page.goto(a.launchUrl);
      await page.goto(`${a.origin}/#/knowledge`);
      await knowledgeCreateButton(page).click();
      const knowledgeDialog = page.getByRole('dialog', { name: '新建知识候选', exact: true });
      await knowledgeDialog.getByLabel('标题', { exact: true }).fill('导数与变化率');
      await knowledgeDialog.getByLabel('核心陈述').fill('函数 x² 的导数为 2x，可用于计算瞬时变化率。');
      await knowledgeDialog.getByRole('button', { name: '保存', exact: true }).click();
      await page.getByRole('button', { name: '确认知识', exact: true }).click();
      await expect.poll(() => a.store.state.knowledgeItems[0]?.reviewStatus).toBe('confirmed');
      const knowledge = structuredClone(a.store.state.knowledgeItems[0]);
      await page.getByRole('button', { name: '新建学习目标候选', exact: true }).click();
      const objectiveDialog = page.getByRole('dialog', { name: '新建学习目标候选', exact: true });
      await objectiveDialog.getByLabel('可观察的学习目标').fill('能够计算函数 x² 在指定点的变化率');
      await objectiveDialog.getByRole('button', { name: /动作/ }).click();
      await page.getByRole('option', { name: '计算', exact: true }).click();
      await expect(page.getByRole('option', { name: '计算', exact: true })).toHaveCount(0);
      await objectiveDialog.getByRole('button', { name: /认知层级/ }).click();
      await page.getByRole('option', { name: '应用', exact: true }).click();
      const createRequest = page.waitForRequest(
        request => request.method() === 'POST' && request.url().endsWith('/learning-objectives')
      );
      await screenshot(page, 'training-objective-candidate.png');
      await objectiveDialog.getByRole('button', { name: '保存候选', exact: true }).click();
      assert.deepEqual((await createRequest).postDataJSON().reviewBaseline, {
        knowledgeUpdatedAt: knowledge.updatedAt
      });
      await expect.poll(() => a.store.state.learningObjectives.length).toBe(1);
      let objective = structuredClone(a.store.state.learningObjectives[0]);
      assert.equal(objective.reviewStatus, 'candidate');
      assert.equal(a.store.state.learningObjectives.filter(row => row.reviewStatus === 'confirmed').length, 0);
      await expect(objectiveDialog).toHaveCount(0);
      await page.getByRole('button', { name: '查看并审阅目标', exact: true }).click();
      const candidateEdit = page.getByRole('dialog', { name: '审阅学习目标', exact: true });
      await expect(candidateEdit.getByRole('button', { name: '保存候选', exact: true })).toBeEnabled();
      await candidateEdit.getByLabel('可观察的学习目标').fill('能够计算函数 x² 在指定点的瞬时变化率');
      const concurrentReply = await page.request.patch(
        `${a.origin}/api/knowledge/learning-objectives/${objective.id}`,
        {
          data: {
            objective: '另一窗口已保存的变化率目标',
            reviewBaseline: { knowledgeUpdatedAt: knowledge.updatedAt, objectiveUpdatedAt: objective.updatedAt }
          }
        }
      );
      assert.equal(concurrentReply.status(), 200);
      const concurrentObjective = (await concurrentReply.json()).data;
      const editRequest = page.waitForRequest(
        request => request.method() === 'PATCH' && request.url().endsWith(`/learning-objectives/${objective.id}`)
      );
      const staleReply = page.waitForResponse(
        response =>
          response.request().method() === 'PATCH' && response.url().endsWith(`/learning-objectives/${objective.id}`)
      );
      await candidateEdit.getByRole('button', { name: '保存候选', exact: true }).click();
      assert.deepEqual((await editRequest).postDataJSON().reviewBaseline, {
        knowledgeUpdatedAt: knowledge.updatedAt,
        objectiveUpdatedAt: objective.updatedAt
      });
      assert.equal((await staleReply).status(), 409);
      await expect(candidateEdit.getByRole('alert')).toContainText('输入草稿与原审阅版本已保留');
      await expect(candidateEdit.getByLabel('可观察的学习目标')).toHaveValue('能够计算函数 x² 在指定点的瞬时变化率');
      assert.equal(a.store.state.learningObjectives[0].objective, concurrentObjective.objective);
      await screenshot(page, 'training-objective-conflict.png');
      await candidateEdit.getByRole('button', { name: '重新加载当前版本以核对', exact: true }).click();
      await expect(candidateEdit.getByRole('region', { name: '重新加载的当前版本' })).toContainText(
        concurrentObjective.objective
      );
      await candidateEdit.getByRole('button', { name: '采用当前版本重新审阅', exact: true }).click();
      const acceptedRequest = page.waitForRequest(
        request => request.method() === 'PATCH' && request.url().endsWith(`/learning-objectives/${objective.id}`)
      );
      await candidateEdit.getByRole('button', { name: '保存候选', exact: true }).click();
      assert.deepEqual((await acceptedRequest).postDataJSON().reviewBaseline, {
        knowledgeUpdatedAt: knowledge.updatedAt,
        objectiveUpdatedAt: concurrentObjective.updatedAt
      });
      await expect(candidateEdit).toHaveCount(0);
      objective = structuredClone(a.store.state.learningObjectives[0]);
      await a.close();
      a = await open('a');
      const restartedKnowledge = structuredClone(a.store.state.knowledgeItems.find(row => row.id === knowledge.id));
      const restartedObjective = structuredClone(a.store.state.learningObjectives.find(row => row.id === objective.id));
      assert.equal(restartedKnowledge.updatedAt, knowledge.updatedAt);
      assert.equal(restartedObjective.updatedAt, objective.updatedAt);
      await page.goto(a.launchUrl);
      await page.goto(`${a.origin}/#/knowledge?item=${knowledge.id}`);
      await page.getByRole('button', { name: '查看并审阅目标', exact: true }).click();
      const review = page.getByRole('dialog', { name: '审阅学习目标', exact: true });
      await expect(review.getByRole('button', { name: '确认已审阅目标', exact: true })).toBeEnabled();
      await expect(review.getByLabel('可观察的学习目标')).toHaveValue(restartedObjective.objective);
      await expect(review.getByRole('region', { name: '审阅的父知识' })).toContainText(
        restartedKnowledge.canonicalStatement
      );
      const confirmRequest = page.waitForRequest(
        request => request.method() === 'POST' && request.url().endsWith(`/learning-objectives/${objective.id}/confirm`)
      );
      await screenshot(page, 'training-objective-restarted-review.png');
      await review.getByRole('button', { name: '确认已审阅目标', exact: true }).click();
      assert.deepEqual((await confirmRequest).postDataJSON().reviewBaseline, {
        knowledgeUpdatedAt: restartedKnowledge.updatedAt,
        objectiveUpdatedAt: restartedObjective.updatedAt
      });
      await expect.poll(() => a.store.state.learningObjectives[0]?.reviewStatus).toBe('confirmed');
      // 本地提交先于确认响应；等待审阅结束并释放导航保护后再切换工作域。
      await expect(review).toHaveCount(0);

      await training(page, a, '考试配置');
      await page.getByRole('button', { name: '新建考试配置', exact: true }).click();
      const profileDialog = page.getByRole('dialog', { name: '新建考试配置', exact: true });
      await profileDialog.getByLabel('配置名称').fill('变化率练习');
      await profileDialog.getByLabel('说明', { exact: true }).fill('人工整理的计算练习配置');
      await profileDialog.getByRole('button', { name: '保存', exact: true }).click();
      await expect.poll(() => a.store.state.examProfiles.length).toBe(1);
      await card(page, '变化率练习').getByRole('button', { name: '编辑', exact: true }).click();
      const profileEdit = page.getByRole('dialog', { name: '编辑考试配置', exact: true });
      await profileEdit.getByLabel('说明', { exact: true }).fill('人工核对并修订的计算练习配置');
      await profileEdit.getByRole('button', { name: '保存', exact: true }).click();
      await expect(card(page, '变化率练习')).toContainText('人工核对并修订');
      await archiveAndRestore('变化率练习', 'examProfiles');
      await training(page, a, '考点');
      await page.getByRole('button', { name: '新建考点', exact: true }).click();
      const focusDialog = page.getByRole('dialog', { name: '新建考点', exact: true });
      await focusDialog.getByLabel('考点说明').fill('核对指定点的变化率计算');
      await focusDialog.getByRole('button', { name: '保存', exact: true }).click();
      await card(page, '核对指定点的变化率计算').getByRole('button', { name: '编辑', exact: true }).click();
      const focusEdit = page.getByRole('dialog', { name: '编辑考点', exact: true });
      await focusEdit.getByLabel('考点说明').fill('核对指定点的瞬时变化率计算');
      await focusEdit.getByRole('button', { name: '保存', exact: true }).click();
      await archiveAndRestore('核对指定点的瞬时变化率计算', 'examFocuses');
      await card(page, '核对指定点的瞬时变化率计算').getByRole('button', { name: '确认', exact: true }).click();
      await expect.poll(() => a.store.state.examFocuses[0]?.reviewStatus).toBe('confirmed');

      await training(page, a);
      await page.getByRole('button', { name: '新建题目', exact: true }).click();
      const questionDialog = page.getByRole('dialog', { name: '新建题目', exact: true });
      await questionDialog.getByRole('textbox', { name: '题干', exact: true }).fill('计算函数 x² 在 x=3 处的变化率。');
      await questionDialog.getByLabel('参考答案').fill('导数为 2x，代入 x=3 得变化率为 6。');
      await questionDialog.getByRole('button', { name: '保存', exact: true }).click();
      await expect.poll(() => a.store.state.questions[0]?.reviewStatus).toBe('draft');
      const question = a.store.state.questions[0];
      await card(page, question.stem).getByRole('button', { name: '编辑', exact: true }).click();
      const questionEdit = page.getByRole('dialog', { name: '编辑题目', exact: true });
      await questionEdit.getByLabel('参考答案').fill('导数为 2x，代入 x=3 得瞬时变化率为 6。');
      await questionEdit.getByRole('button', { name: '保存', exact: true }).click();
      await expect(questionEdit).toHaveCount(0);
      await archiveAndRestore(question.stem, 'questions');
      await card(page, question.stem).getByRole('button', { name: '校验', exact: true }).click();
      await expect.poll(() => a.store.state.questions[0]?.reviewStatus).toBe('candidate');
      await card(page, question.stem).getByRole('button', { name: '确认', exact: true }).click();
      await expect.poll(() => a.store.state.questions[0]?.reviewStatus).toBe('confirmed');
      await card(page, question.stem).getByRole('button', { name: '查看详情', exact: true }).click();
      await expect(page.getByRole('region', { name: '参考答案', exact: true })).toContainText('变化率为 6');
      const relationIds = a.store.state.questionObjectives.map(row => row.id);
      const sourceIds = a.store.state.questionSources.map(row => row.id);
      assert.equal(relationIds.length, 1);
      assert.equal(sourceIds.length, 1);
      await screenshot(page, 'training-question-confirmed.png');

      await openLocalSync(page, /本地资料.*连接云端/);
      await page.getByLabel(/云端服务地址/).fill(cloudOrigin);
      await page.getByRole('button', { name: '连接并比较资料', exact: true }).click();
      await expect(page.getByRole('dialog', { name: '云端同步', exact: true })).toContainText('云端已同步');
      await closeLocalSync(page);
      await second.goto(b.launchUrl);
      await post(second, b, '/api/local-runtime/sync/configure', { serverUrl: cloudOrigin });
      await sync(second, b);
      await training(second, b);
      await expect(card(second, question.stem)).toContainText('已确认');
      for (const store of [cloudStore, b.store]) {
        assert.equal(store.state.learningObjectives.find(row => row.id === objective.id).reviewStatus, 'confirmed');
        assert.equal(store.state.examProfiles.length, 1);
        assert.equal(store.state.examFocuses[0].reviewStatus, 'confirmed');
        assert.deepEqual(
          store.state.questionObjectives.map(row => row.id),
          relationIds
        );
        assert.deepEqual(
          store.state.questionSources.map(row => row.id),
          sourceIds
        );
      }
      await card(second, question.stem).getByRole('button', { name: '删除…', exact: true }).click();
      await second
        .getByRole('dialog', { name: '删除题目？', exact: true })
        .getByRole('button', { name: '移入回收站', exact: true })
        .click();
      await sync(second, b);
      await sync(page, a);
      assert(a.store.state.questions[0].deletedAt);
      assert(cloudStore.state.questions[0].deletedAt);
      await training(page, a);
      await page.getByRole('button', { name: '回收站', exact: true }).click();
      // 另一设备的 HTTP 同步由关闭面板后的 10 秒状态查询刷新当前页面。
      await expect(card(page, question.stem)).toContainText('回收站', { timeout: 15000 });
      await expect(card(page, question.stem).getByRole('button', { name: '永久清理…', exact: true })).toBeEnabled();
      await expect(
        page.getByText('永久清理需要连接兼容的云端并完成同步；离线时保留本地原件。', { exact: true })
      ).toBeVisible();
      await screenshot(page, 'training-question-trash.png');
      await card(page, question.stem).getByRole('button', { name: '恢复', exact: true }).click();
      await expect.poll(() => a.store.state.questions[0]?.deletedAt).toBe(null);
      assert.equal(a.store.state.questions[0].reviewStatus, 'draft');
      await sync(page, a);
      await sync(second, b);
      await training(second, b);
      await expect(card(second, question.stem)).toContainText('草稿', { timeout: 15000 });
      assert.equal(cloudStore.state.questions[0].deletedAt, null);
      assert.equal(b.store.state.questions[0].reviewStatus, 'draft');
      assert.deepEqual(
        b.store.state.questionObjectives.map(row => row.id),
        relationIds
      );
      assert.deepEqual(
        b.store.state.questionSources.map(row => row.id),
        sourceIds
      );
      await screenshot(second, 'training-question-restored-device-b.png');
      assert(fs.existsSync(path.join(root, 'a', 'local.sqlite')));
      assert(fs.existsSync(path.join(root, 'b', 'local.sqlite')));
      assert.deepEqual(errors, []);
    },
    () => ({ a: a.store.exportSnapshot(), b: b.store.exportSnapshot(), cloud: cloudStore.exportSnapshot() })
  );
});
