import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isDirectExecution } from './cli-entry.mjs';

const commitPattern = /^[0-9a-f]{40}$/;
const manifests = ['package.json', 'apps/api/package.json', 'apps/web/package.json'];

export function readReleaseVersion(root) {
  const versions = manifests.map(file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')).version);
  if (!versions.every(version => version === versions[0])) throw new Error('正式应用版本不一致，构建已停止。');
  return versions[0];
}

export function resolveBuildInfo(root, { env = process.env, now = new Date() } = {}) {
  const version = readReleaseVersion(root);
  const supplied = env.KNOWRA_BUILD_COMMIT?.trim();
  const suppliedState = env.KNOWRA_BUILD_STATE?.trim();
  if (supplied && !commitPattern.test(supplied)) throw new Error('KNOWRA_BUILD_COMMIT 必须是完整的40位小写提交 SHA。');
  if (suppliedState && !['clean', 'dirty', 'unknown'].includes(suppliedState))
    throw new Error('KNOWRA_BUILD_STATE 必须为 clean、dirty 或 unknown。');
  if (suppliedState && !supplied) throw new Error('指定构建状态时必须同时提供完整提交 SHA。');
  let commit = null,
    state = 'unknown',
    source = 'unknown';
  // 导出的源码目录可能位于另一个仓库内，不能误用父目录的 Git HEAD。
  if (fs.existsSync(path.join(root, '.git'))) {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    state = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], {
      cwd: root,
      encoding: 'utf8'
    }).trim()
      ? 'dirty'
      : 'clean';
    source = 'git';
    if (supplied && supplied !== commit) throw new Error('显式构建 SHA 与当前 Git HEAD 不一致。');
    if (suppliedState && suppliedState !== state) throw new Error('显式构建状态与当前工作树不一致。');
  } else if (supplied) {
    commit = supplied;
    state = suppliedState || 'unknown';
    source = 'external';
  }
  return { schemaVersion: 1, version, commit, state, source, builtAt: now.toISOString() };
}

export function assertBuildInfo(info, { version, commit, state, requireClean = false } = {}) {
  if (
    !info ||
    info.schemaVersion !== 1 ||
    typeof info.version !== 'string' ||
    !(info.commit === null || (typeof info.commit === 'string' && commitPattern.test(info.commit))) ||
    !['clean', 'dirty', 'unknown'].includes(info.state) ||
    !['git', 'external', 'unknown'].includes(info.source) ||
    typeof info.builtAt !== 'string' ||
    !Number.isFinite(Date.parse(info.builtAt)) ||
    (info.source === 'unknown' && (info.commit !== null || info.state !== 'unknown')) ||
    (info.source !== 'unknown' && info.commit === null)
  )
    throw new Error('构建标识缺失或无效，拒绝发布。');
  if (
    (version !== undefined && info.version !== version) ||
    (commit !== undefined && info.commit !== commit) ||
    (state !== undefined && info.state !== state)
  )
    throw new Error('构建标识与目标版本、提交或工作树状态不符，拒绝使用旧产物。');
  if (requireClean && (!info.commit || info.state !== 'clean'))
    throw new Error('正式发布需要完整 SHA 和 clean 构建，dirty/unknown 产物不可安装或发布。');
  return info;
}

export function readBuildInfo(file, expected) {
  return assertBuildInfo(JSON.parse(fs.readFileSync(file, 'utf8')), expected);
}

if (isDirectExecution(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const info = assertBuildInfo(resolveBuildInfo(root), { requireClean: process.argv.includes('--require-clean') });
  console.log(JSON.stringify(info, null, 2));
}
