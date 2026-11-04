import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { assertBuildInfo, readBuildInfo, readReleaseVersion } from './build-info.mjs';
import { isDirectExecution } from './cli-entry.mjs';

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const equalIdentity = (left, right) => {
  for (const key of ['schemaVersion', 'version', 'commit', 'state', 'source', 'builtAt']) {
    if (left[key] !== right[key]) throw new Error(`产物构建标识不一致（${key}），拒绝发布。`);
  }
};

export function assertWebBuild(root, commit) {
  return readBuildInfo(path.join(root, 'apps/web/dist/build-info.json'), {
    version: readReleaseVersion(root),
    commit,
    requireClean: true
  });
}

export function assertDesktopBuild(application, expected) {
  const resources = path.join(application, 'Contents/Resources/app');
  const info = readBuildInfo(path.join(resources, 'build-info.json'), expected);
  if (readJson(path.join(resources, 'package.json')).version !== info.version)
    throw new Error('APP 清单版本与构建标识不符。');
  equalIdentity(info, readBuildInfo(path.join(resources, 'web/build-info.json')));
  return info;
}

export function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function assertMacDistribution(archive, application, expected) {
  const info = assertDesktopBuild(application, expected);
  const manifest = readJson(`${archive}.build-info.json`);
  assertBuildInfo(manifest.buildInfo, expected);
  equalIdentity(info, manifest.buildInfo);
  if (
    manifest.platform !== 'darwin-arm64' ||
    manifest.archive !== path.basename(archive) ||
    manifest.sha256 !== sha256(archive)
  )
    throw new Error('Mac 分发包校验和或构建标识不符。');
  return info;
}

export function assertLinuxRelease(root, commit) {
  const manifest = readJson(path.join(root, '.knowra-release.json'));
  if (manifest.commit !== commit || manifest.platform !== 'linux-x64' || manifest.nodeMajor !== 24)
    throw new Error('Linux 发布清单与目标提交或运行平台不符。');
  assertBuildInfo(manifest.buildInfo, { version: readReleaseVersion(root), commit, requireClean: true });
  equalIdentity(manifest.buildInfo, assertWebBuild(root, commit));
  return manifest;
}

if (isDirectExecution(import.meta.url)) {
  const [action, root, commit] = process.argv.slice(2);
  if (action === '--verify-web') assertWebBuild(root, commit);
  else if (action === '--verify-linux') assertLinuxRelease(root, commit);
  else if (action === '--write-linux') {
    const buildInfo = assertWebBuild(root, commit);
    fs.writeFileSync(
      path.join(root, '.knowra-release.json'),
      `${JSON.stringify({ commit, platform: 'linux-x64', nodeMajor: 24, buildInfo }, null, 2)}\n`
    );
  } else throw new Error('未知的发布产物校验命令。');
}
