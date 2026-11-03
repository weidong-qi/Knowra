import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';

const commit = 'a'.repeat(40),
  oldCommit = 'b'.repeat(40);
const manifests = ['package.json', 'apps/api/package.json', 'apps/web/package.json'];
const writeJson = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
};

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-build-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const file of manifests) writeJson(path.join(root, file), { version: '2.27.2' });
  fs.mkdirSync(path.join(root, 'scripts'));
  for (const file of ['build-info.mjs', 'release-artifact.mjs', 'cli-entry.mjs']) {
    fs.copyFileSync(path.resolve(import.meta.dirname, '..', file), path.join(root, 'scripts', file));
  }
  fs.writeFileSync(path.join(root, '.gitignore'), '.aliases/\n');
  fs.mkdirSync(path.join(root, '.aliases'));
  fs.symlinkSync(
    path.join(root, 'scripts'),
    path.join(root, '.aliases', 'scripts'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  let fileAlias = true;
  try {
    for (const file of ['build-info.mjs', 'release-artifact.mjs']) {
      fs.symlinkSync(path.join(root, 'scripts', file), path.join(root, '.aliases', file), 'file');
    }
  } catch (error) {
    if (process.platform !== 'win32' || error.code !== 'EPERM') throw error;
    fileAlias = false;
    t.diagnostic('Windows 未授权文件符号链接；普通路径及目录 junction 仍执行。');
  }
  const entries = name => [
    path.join(root, 'scripts', name),
    path.join(root, '.aliases', 'scripts', name),
    ...(fileAlias ? [path.join(root, '.aliases', name)] : [])
  ];
  const run = (entry, args) =>
    spawnSync(process.execPath, [entry, ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, KNOWRA_BUILD_COMMIT: '', KNOWRA_BUILD_STATE: '' }
    });
  return { root, entries, run };
}

test('真实发布 CLI 经普通、目录与文件符号链接入口均拒绝旧 SHA、脏标识', t => {
  const { root, entries, run } = fixture(t);
  const buildInfo = {
    schemaVersion: 1,
    version: '2.27.2',
    commit,
    state: 'clean',
    source: 'git',
    builtAt: '2026-10-02T00:00:00.000Z'
  };
  writeJson(path.join(root, 'apps/web/dist/build-info.json'), buildInfo);
  writeJson(path.join(root, '.knowra-release.json'), { commit, platform: 'linux-x64', nodeMajor: 24, buildInfo });
  for (const entry of entries('release-artifact.mjs')) {
    const valid = run(entry, ['--verify-linux', root, commit]);
    assert.equal(valid.status, 0, valid.stderr);
    const stale = run(entry, ['--verify-linux', root, oldCommit]);
    assert.notEqual(stale.status, 0, `旧 SHA 不得静默跳过：${entry}`);
    assert.match(stale.stderr, /目标提交/);
    const staleWeb = run(entry, ['--verify-web', root, oldCommit]);
    assert.notEqual(staleWeb.status, 0, `旧前端 SHA 不得静默跳过：${entry}`);
    assert.match(staleWeb.stderr, /旧产物/);
    writeJson(path.join(root, 'apps/web/dist/build-info.json'), { ...buildInfo, state: 'dirty' });
    const dirty = run(entry, ['--verify-linux', root, commit]);
    assert.notEqual(dirty.status, 0, `脏前端不得静默跳过：${entry}`);
    assert.match(dirty.stderr, /dirty\/unknown/);
    writeJson(path.join(root, 'apps/web/dist/build-info.json'), buildInfo);
  }
});

test('真实构建 CLI 经普通、目录与文件符号链接入口执行 clean/dirty/unknown 门禁', t => {
  const { root, entries, run } = fixture(t);
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
    '合成CLI构建测试'
  ]);
  const head = git(['rev-parse', 'HEAD']);
  for (const entry of entries('build-info.mjs')) {
    const clean = run(entry, ['--require-clean']);
    assert.equal(clean.status, 0, clean.stderr);
    const cleanInfo = JSON.parse(clean.stdout);
    assert.equal(cleanInfo.commit, head);
    assert.equal(cleanInfo.state, 'clean');
    fs.appendFileSync(path.join(root, 'package.json'), '\n');
    const dirty = run(entry, ['--require-clean']);
    assert.notEqual(dirty.status, 0, `脏树不得静默跳过：${entry}`);
    assert.match(dirty.stderr, /dirty\/unknown/);
    git(['checkout', '--', 'package.json']);
  }
  fs.rmSync(path.join(root, '.git'), { recursive: true, force: true });
  for (const entry of entries('build-info.mjs')) {
    const unknown = run(entry, ['--require-clean']);
    assert.notEqual(unknown.status, 0, `未知状态不得静默跳过：${entry}`);
    assert.match(unknown.stderr, /dirty\/unknown/);
    const visibleUnknown = run(entry, []);
    assert.equal(visibleUnknown.status, 0, visibleUnknown.stderr);
    const unknownInfo = JSON.parse(visibleUnknown.stdout);
    assert.equal(unknownInfo.commit, null);
    assert.equal(unknownInfo.state, 'unknown');
  }
});

test('stdin/eval 导入两个 helper 可用，附加非文件或模块路径参数不执行 CLI', t => {
  const { root } = fixture(t);
  const buildInfo = {
    schemaVersion: 1,
    version: '2.27.2',
    commit,
    state: 'clean',
    source: 'git',
    builtAt: '2026-10-02T00:00:00.000Z'
  };
  writeJson(path.join(root, 'apps/web/dist/build-info.json'), buildInfo);
  const source = `
    import { pathToFileURL } from 'node:url';
    const root = ${JSON.stringify(root)};
    const build = await import(pathToFileURL(root + '/scripts/build-info.mjs'));
    const release = await import(pathToFileURL(root + '/scripts/release-artifact.mjs'));
    const identity = build.assertBuildInfo(build.resolveBuildInfo(root, { env: {} }));
    const web = release.assertWebBuild(root, ${JSON.stringify(commit)});
    console.log(JSON.stringify({ version: identity.version, state: identity.state, webCommit: web.commit }));
  `;
  const variants = [
    { args: ['--input-type=module', '-', '--write-linux', root, commit], input: source },
    { args: ['--input-type=module', '-e', source, 'non-file-entry', '--write-linux', root, commit] },
    { args: ['--input-type=module', '--eval', source, path.join(root, 'scripts/build-info.mjs'), '--require-clean'] },
    {
      args: [
        '--input-type=module',
        `--eval=${source}`,
        path.join(root, 'scripts/release-artifact.mjs'),
        '--write-linux',
        root,
        commit
      ]
    }
  ];
  for (const { args, input } of variants) {
    const result = spawnSync(process.execPath, args, {
      cwd: root,
      input,
      encoding: 'utf8',
      env: { ...process.env, KNOWRA_BUILD_COMMIT: '', KNOWRA_BUILD_STATE: '' }
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { version: '2.27.2', state: 'unknown', webCommit: commit });
    assert.equal(fs.existsSync(path.join(root, '.knowra-release.json')), false, 'helper 导入不得执行写发布清单 CLI');
  }
});
