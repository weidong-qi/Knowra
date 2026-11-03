import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { assertBuildInfo, readReleaseVersion, resolveBuildInfo } from '../build-info.mjs';
import { assertDesktopBuild, assertLinuxRelease, assertMacDistribution, sha256 } from '../release-artifact.mjs';

const commit = 'a'.repeat(40),
  previous = 'b'.repeat(40);
const manifests = ['package.json', 'apps/api/package.json', 'apps/web/package.json'];
const info = {
  schemaVersion: 1,
  version: '2.27.2',
  commit,
  state: 'clean',
  source: 'git',
  builtAt: '2026-10-02T00:00:00.000Z'
};
const expected = { version: info.version, commit, requireClean: true };
const writeJson = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
};
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-build-identity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const file of manifests) writeJson(path.join(root, file), { version: info.version });
  return root;
}

test('Git 构建记录完整 HEAD；tracked/untracked 修改可见且不能由环境伪装 clean', t => {
  const root = fixture(t);
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git(['init', '-q']);
  git(['add', '.']);
  git([
    '-c',
    'user.name=Knowra synthetic',
    '-c',
    'user.email=synthetic@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-qm',
    '合成构建测试'
  ]);
  const clean = resolveBuildInfo(root, { env: {} });
  assert.equal(clean.commit, git(['rev-parse', 'HEAD']));
  assert.equal(clean.state, 'clean');
  assert.equal(clean.source, 'git');
  assertBuildInfo(clean, { requireClean: true });
  const exported = path.join(root, 'exported');
  for (const file of manifests) writeJson(path.join(exported, file), { version: info.version });
  assert.equal(resolveBuildInfo(exported, { env: {} }).source, 'unknown');
  fs.rmSync(exported, { recursive: true });
  assert.throws(() => resolveBuildInfo(root, { env: { KNOWRA_BUILD_COMMIT: previous } }), /HEAD 不一致/);
  fs.writeFileSync(path.join(root, 'new-source.js'), 'export const synthetic = 1;');
  assert.equal(resolveBuildInfo(root, { env: {} }).state, 'dirty');
  fs.rmSync(path.join(root, 'new-source.js'));
  fs.appendFileSync(path.join(root, 'package.json'), '\n');
  assert.equal(resolveBuildInfo(root, { env: {} }).state, 'dirty');
  assert.throws(
    () => resolveBuildInfo(root, { env: { KNOWRA_BUILD_COMMIT: clean.commit, KNOWRA_BUILD_STATE: 'clean' } }),
    /工作树不一致/
  );
  assert.throws(() => assertBuildInfo(resolveBuildInfo(root, { env: {} }), { requireClean: true }), /dirty\/unknown/);
});

test('无 Git 的源码明确未知或使用显式完整 SHA；不能借用父目录仓库身份', t => {
  const root = fixture(t);
  assert.equal(resolveBuildInfo(root, { env: {} }).commit, null);
  assert.equal(resolveBuildInfo(root, { env: {} }).state, 'unknown');
  const external = resolveBuildInfo(root, { env: { KNOWRA_BUILD_COMMIT: commit } });
  assert.equal(external.source, 'external');
  assert.equal(external.state, 'unknown');
  assert.throws(() => assertBuildInfo(external, { requireClean: true }), /dirty\/unknown/);
  assert.equal(
    resolveBuildInfo(root, { env: { KNOWRA_BUILD_COMMIT: commit, KNOWRA_BUILD_STATE: 'clean' } }).state,
    'clean'
  );
  assert.throws(() => resolveBuildInfo(root, { env: { KNOWRA_BUILD_COMMIT: 'a'.repeat(7) } }), /完整/);
  assert.throws(() => resolveBuildInfo(root, { env: { KNOWRA_BUILD_STATE: 'clean' } }), /同时提供/);
  writeJson(path.join(root, 'apps/api/package.json'), { version: '2.27.1' });
  assert.throws(() => resolveBuildInfo(root, { env: {} }), /版本不一致/);
});

test('Mac 包校验拒绝同版本旧 SHA、未知/脏产物、混装前端与损坏ZIP', t => {
  const root = fixture(t),
    app = path.join(root, 'synthetic.app');
  const resources = path.join(app, 'Contents/Resources/app');
  writeJson(path.join(resources, 'package.json'), { version: info.version });
  writeJson(path.join(resources, 'build-info.json'), info);
  writeJson(path.join(resources, 'web/build-info.json'), info);
  const archive = path.join(root, 'synthetic.zip');
  fs.writeFileSync(archive, '合成ZIP校验内容');
  writeJson(`${archive}.build-info.json`, {
    platform: 'darwin-arm64',
    archive: path.basename(archive),
    sha256: sha256(archive),
    buildInfo: info
  });
  assert.equal(assertMacDistribution(archive, app, expected).commit, commit);
  assert.throws(() => assertDesktopBuild(app, { ...expected, commit: previous }), /旧产物/);
  for (const state of ['dirty', 'unknown']) {
    writeJson(path.join(resources, 'build-info.json'), { ...info, state });
    assert.throws(() => assertDesktopBuild(app, expected), /dirty\/unknown/);
  }
  writeJson(path.join(resources, 'build-info.json'), info);
  writeJson(path.join(resources, 'web/build-info.json'), { ...info, commit: previous });
  assert.throws(() => assertDesktopBuild(app, expected), /不一致/);
  writeJson(path.join(resources, 'web/build-info.json'), info);
  fs.appendFileSync(archive, '损坏');
  assert.throws(() => assertMacDistribution(archive, app, expected), /校验和/);
  fs.rmSync(path.join(resources, 'build-info.json'));
  assert.throws(() => assertDesktopBuild(app, expected), /ENOENT/);
});

test('Linux 发布要求清单、前端和正式应用版本对应同一提交', t => {
  const root = fixture(t);
  writeJson(path.join(root, 'apps/web/dist/build-info.json'), info);
  writeJson(path.join(root, '.knowra-release.json'), { commit, platform: 'linux-x64', nodeMajor: 24, buildInfo: info });
  assert.equal(assertLinuxRelease(root, commit).buildInfo.version, info.version);
  for (const replacement of [
    { ...info, commit: previous },
    { ...info, state: 'dirty' },
    { ...info, builtAt: '2026-10-01T00:00:00Z' }
  ]) {
    writeJson(path.join(root, 'apps/web/dist/build-info.json'), replacement);
    assert.throws(() => assertLinuxRelease(root, commit));
  }
  writeJson(path.join(root, 'apps/web/dist/build-info.json'), info);
  writeJson(path.join(root, '.knowra-release.json'), { commit, platform: 'linux-x64', nodeMajor: 24 });
  assert.throws(() => assertLinuxRelease(root, commit), /标识缺失/);
});

test('正式应用和 lockfile 的发布版本保持一致', () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const version = readReleaseVersion(root);
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(lock.version, version);
  for (const entry of ['', 'apps/api', 'apps/web']) assert.equal(lock.packages[entry].version, version);
});
