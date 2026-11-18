import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assertBuildInfo } from './build-info.mjs';
import { isDirectExecution } from './cli-entry.mjs';
import { ARCHIVE_NAME, assertCandidateDistribution } from '../apps/desktop-shell/scripts/verify-distribution.mjs';

export function candidateSummary(manifest, { commit, artifactUrl }) {
  if (!/^[0-9a-f]{40}$/.test(commit || '')) throw new Error('候选汇总需要本次完整提交 SHA。');
  const info = assertBuildInfo(manifest.buildInfo, { commit, requireClean: true });
  assertCandidateDistribution(manifest);
  if (manifest.archive !== ARCHIVE_NAME || !/^[0-9a-f]{64}$/.test(manifest.sha256 || '')) {
    throw new Error('候选 ZIP 身份清单无效。');
  }
  const url = new URL(artifactUrl);
  if (
    url.origin !== 'https://github.com' ||
    !/^\/[^/]+\/[^/]+\/actions\/runs\/\d+\/artifacts\/\d+$/.test(url.pathname) ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error('候选下载地址不是 GitHub Actions artifact。');
  return [
    '## Mac 候选包',
    '',
    `- 版本：${info.version}`,
    `- 完整提交：\`${info.commit}\`（${info.state}）`,
    `- 构建时间：${info.builtAt}`,
    `- 分发 ZIP SHA-256：\`${manifest.sha256}\``,
    '- 已通过：打包内 PNG/JPEG/WebP 解码、ZIP 解包后的身份/哈希/arm64/签名核验、串行隔离合成数据测试。',
    `- [下载候选 artifact](${url.href})（保留 14 天；可能要求 GitHub 登录）。`,
    '',
    '这是 ad-hoc 签名、未经 Apple 公证的候选包，不是稳定 Release。下载后解开 artifact 外层 ZIP，保留其中分发 ZIP 和同名 .build-info.json；安装前正常退出并导出完整备份。若 macOS 阻止打开，请停止，不绕过系统保护。',
    ''
  ].join('\n');
}

if (isDirectExecution(import.meta.url)) {
  if (!process.env.GITHUB_STEP_SUMMARY) throw new Error('缺少 GitHub 作业汇总路径。');
  const manifest = JSON.parse(
    fs.readFileSync(fileURLToPath(new URL(`../dist/mac/${ARCHIVE_NAME}.build-info.json`, import.meta.url)), 'utf8')
  );
  fs.appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    candidateSummary(manifest, {
      commit: process.env.GITHUB_SHA,
      artifactUrl: process.env.ARTIFACT_URL
    })
  );
}
