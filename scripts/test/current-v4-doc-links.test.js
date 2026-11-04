import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const currentEntryDocuments = [
  'deploy/isolated-test/README.md',
  'deploy/README.md',
  'docs/已归档/任务盘点与验收索引.md',
  'docs/离线编辑与同步/同步世代重建与删除事实保护.md',
  'docs/离线编辑与同步/2026-10-01-当前阶段恢复中断补验.md',
  'docs/资产生命周期任务/README.md',
  'docs/资产生命周期任务/资产生命周期差距与实施方案.md',
  'docs/审查/README.md',
  'docs/审查/2026-10-12-质量审查收尾总结.md',
  'docs/审查/21-修复计划与进度.md',
  'docs/附件功能/附件闭环实现与验收.md',
  'docs/已归档/附件功能/2026-10-01-附件闭环收口.md',
  'docs/已归档/README.md',
  'docs/项目结构导航.md',
  'apps/web/design-qa.md',
  'docs/前端/README.md',
  'docs/已归档/前端/README.md',
  'docs/已归档/前端/V4/README.md',
  'docs/已归档/前端/V4/04-分阶段实施任务书.md',
  'docs/已归档/前端/V4/V4-00.5/印格/V4-00.5-印格视觉冻结规范.md',
  'docs/已归档/前端/印格/正式迁移/README.md'
];

test('当前任务与归档入口文档只引用存在的本地目标', () => {
  const missing = [];
  for (const relativeFile of currentEntryDocuments) {
    const file = path.join(workspaceRoot, relativeFile);
    const markdown = readFileSync(file, 'utf8');
    for (const match of markdown.matchAll(/!?(?:\[[^\]]*\])\(([^)]+)\)/g)) {
      let target = match[1].trim().replace(/^<|>$/g, '');
      if (/^(?:https?:|mailto:|#)/.test(target)) continue;
      target = decodeURIComponent(target.split('#')[0]);
      if (!existsSync(path.resolve(path.dirname(file), target))) {
        missing.push(`${relativeFile} -> ${target}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

// 只约束现役速查表，不对历史源码、设计证据或整个仓库做路径快照。
function section(markdown, heading) {
  const prefix = `## ${heading}\n`;
  assert.equal(markdown.split(prefix).length, 2, `应有唯一章节：${heading}`);
  return markdown.split(prefix)[1].split(/\n## /)[0];
}

function currentNavigationProblems(markdown) {
  const current = section(markdown, '当前职责导航');
  const entries = section(markdown, '常见改动入口');
  const problems = [];
  for (const match of `${current}\n${entries}`.matchAll(/`((?:apps|packages|scripts|deploy|\.github)\/[^`]+)`/g)) {
    const target = match[1];
    if (target.startsWith('apps/web-legacy/')) problems.push(`退役入口：${target}`);
    if (!existsSync(path.join(workspaceRoot, target))) problems.push(`缺失入口：${target}`);
  }
  // 锁定少数容易误导到旧前端的职责族，不锁每个内部文件名。
  for (const [need, owner] of [
    ['修改前端 API 调用', 'packages/web-core/src/api/'],
    ['修改全局 Meta/Ctrl+K 搜索快捷键', 'apps/web/src/shell/'],
    ['修改编辑器快捷键/输入行为', 'apps/web/src/features/editor/'],
    ['修改视觉 token', 'apps/web/src/styles/']
  ]) {
    const row = entries.split('\n').find(line => line.startsWith(`| ${need} |`));
    if (!row?.includes(`\`${owner}`)) problems.push(`职责入口缺失：${need} → ${owner}`);
  }
  return problems;
}

const structureNavigation = readFileSync(path.join(workspaceRoot, 'docs/项目结构导航.md'), 'utf8');

test('当前职责和常见改动入口指向存在的现役实现，而非保留的V3源码', () => {
  assert.deepEqual(currentNavigationProblems(structureNavigation), []);
  const legacy = section(structureNavigation, 'V3 历史源码导航（非现役）');
  assert.match(legacy, /V3 已退役/);
  assert.match(legacy, /apps\/web-legacy\/src/);
});

test('语义门禁拒绝真实存在的退役路径、错误职责和缺失路径', () => {
  const currentPath = 'apps/web/src/styles/tokens.css';
  const legacyPath = 'apps/web-legacy/styles/tokens.css';
  assert.equal(existsSync(path.join(workspaceRoot, legacyPath)), true);
  const retired = structureNavigation.replaceAll(currentPath, legacyPath);
  assert.ok(currentNavigationProblems(retired).includes(`退役入口：${legacyPath}`));
  assert.ok(currentNavigationProblems(retired).some(problem => problem.startsWith('职责入口缺失：修改视觉 token')));

  const wrongOwner = structureNavigation.replaceAll(currentPath, 'apps/web/src/shell/AppShell.tsx');
  assert.ok(currentNavigationProblems(wrongOwner).some(problem => problem.startsWith('职责入口缺失：修改视觉 token')));
  const missingPath = 'apps/web/src/styles/__missing_navigation_target__.css';
  const missing = structureNavigation.replaceAll(currentPath, missingPath);
  assert.ok(currentNavigationProblems(missing).includes(`缺失入口：${missingPath}`));
});
