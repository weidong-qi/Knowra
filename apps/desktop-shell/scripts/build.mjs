import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { packager } from '@electron/packager';
import { execFileSync } from 'node:child_process';
import { readBuildInfo, resolveBuildInfo } from '../../../scripts/build-info.mjs';
import { stageNativeImageRuntime, verifyNativeImageRuntime } from './native-image-runtime.mjs';
import { SHELL_FILES } from './shell-files.mjs';
import { CANDIDATE_DISTRIBUTION } from './verify-distribution.mjs';
import { assertDesktopBuild, sha256 } from '../../../scripts/release-artifact.mjs';

// 纯构建只读取已提交图标；需要更新图标时显式运行 create-icon.mjs，审查并提交后再构建。
if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw new Error('Mac APP 构建需要 Apple Silicon macOS。');

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const expected = resolveBuildInfo(repo);
const buildInfo = readBuildInfo(path.join(repo, 'apps/web/dist/build-info.json'), {
  version: expected.version,
  commit: expected.commit,
  state: expected.state
});
const staging = path.join(repo, 'dist/mac-staging');
const output = path.join(repo, 'dist/mac');
fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });
for (const name of SHELL_FILES)
  fs.copyFileSync(path.join(repo, 'apps/desktop-shell/src', name), path.join(staging, name));
await build({
  entryPoints: [path.join(repo, 'apps/desktop-shell/src/runtime-entry.mjs')],
  outfile: path.join(staging, 'runtime.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  external: ['@prisma/client', 'sharp'],
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);"
  }
});
for (const name of ['worker-child', 'provider-child']) {
  await build({
    entryPoints: [path.join(repo, 'apps/api/src/modules/ai', `${name}.js`)],
    outfile: path.join(staging, `${name}.js`),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);"
    }
  });
}
// 外部 AI 客户端（MCP）的 stdio 适配器：打成单文件（含官方 SDK），放在 runtime.mjs 旁边。
await build({
  entryPoints: [path.join(repo, 'apps/desktop-runtime/src/mcp/adapter.mjs')],
  outfile: path.join(staging, 'mcp-adapter.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);"
  }
});
fs.cpSync(path.join(repo, 'apps/web/dist'), path.join(staging, 'web'), { recursive: true });
const version = buildInfo.version;
fs.writeFileSync(path.join(staging, 'build-info.json'), `${JSON.stringify(buildInfo, null, 2)}\n`);
fs.writeFileSync(
  path.join(staging, 'package.json'),
  JSON.stringify({
    name: 'knowra-desktop',
    productName: '知境·Knowra',
    version,
    main: 'main.cjs',
    description: '知境·Knowra 个人离线知识工作台',
    author: 'Knowra',
    private: true
  })
);
stageNativeImageRuntime({ repo, staging, platform: 'darwin', arch: 'arm64' });
await verifyNativeImageRuntime(staging);
const apps = await packager({
  electronZipDir: process.env.KNOWRA_ELECTRON_ZIP_DIR,
  dir: staging,
  out: output,
  name: '知境·Knowra',
  icon: path.join(repo, 'apps/desktop-shell/assets/Knowra.icns'),
  executableName: 'Knowra',
  appBundleId: 'com.knowra.personal',
  appVersion: version,
  buildVersion: `${version}.1`,
  platform: 'darwin',
  arch: 'arm64',
  electronVersion: JSON.parse(fs.readFileSync(path.join(repo, 'node_modules/electron/package.json'))).version,
  overwrite: true,
  asar: false,
  prune: false,
  darwinDarkModeSupport: true,
  extendInfo: {
    NSHumanReadableCopyright: 'Knowra 个人使用版',
    KnowraBuildCommit: buildInfo.commit || 'unknown',
    KnowraBuildState: buildInfo.state,
    KnowraBuiltAt: buildInfo.builtAt
  }
});
for (const directory of apps) {
  const application = path.join(directory, '知境·Knowra.app');
  assertDesktopBuild(application, { version, commit: buildInfo.commit, state: buildInfo.state });
  const iconName = execFileSync(
    '/usr/libexec/PlistBuddy',
    ['-c', 'Print :CFBundleIconFile', path.join(application, 'Contents/Info.plist')],
    { encoding: 'utf8' }
  ).trim();
  const packagedIcon = path.join(application, 'Contents/Resources', iconName);
  if (
    !fs.existsSync(packagedIcon) ||
    !fs.readFileSync(packagedIcon).equals(fs.readFileSync(path.join(repo, 'apps/desktop-shell/assets/Knowra.icns')))
  ) {
    throw new Error('打包图标与新版 Knowra.icns 不一致，拒绝发布 Mac APP。');
  }
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', application], { stdio: 'inherit' });
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', application], { stdio: 'inherit' });
  const archive = path.join(output, '知境·Knowra-Mac-arm64.zip');
  fs.rmSync(archive, { force: true });
  execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', application, archive]);
  fs.writeFileSync(
    `${archive}.build-info.json`,
    `${JSON.stringify({ platform: 'darwin-arm64', distribution: CANDIDATE_DISTRIBUTION, archive: path.basename(archive), sha256: sha256(archive), buildInfo }, null, 2)}\n`
  );
  console.log(`应用已生成：${application}\n压缩包：${archive}`);
}
