import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHELL_FILES } from '../scripts/shell-files.mjs';

const source = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src');
const relativeRequires = file =>
  [...fs.readFileSync(path.join(source, file), 'utf8').matchAll(/require\('(\.\/[^']+)'\)/g)].map(match =>
    path.basename(match[1])
  );

test('打包清单包含桌面壳所有相对 require 的模块（漏一个，打包后的应用就会 MODULE_NOT_FOUND）', () => {
  for (const file of SHELL_FILES) assert.equal(fs.existsSync(path.join(source, file)), true, `${file} 存在`);
  for (const file of SHELL_FILES) {
    for (const required of relativeRequires(file)) {
      assert.equal(SHELL_FILES.includes(required), true, `${file} 需要 ${required}，但打包清单里没有`);
    }
  }
  assert.equal(SHELL_FILES.includes('system-notifications.cjs'), true);
});

test('构建脚本使用该清单，没有另写一份文件名列表', () => {
  const build = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts/build.mjs'),
    'utf8'
  );
  assert.match(build, /for \(const name of SHELL_FILES\)/);
  assert.doesNotMatch(build, /'draft-store\.cjs'/);
});

test('本地 PDF 运行时的最终打包依赖不包含 PostgreSQL 客户端', async () => {
  const { build } = await import('esbuild');
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/runtime-entry.mjs', import.meta.url))],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    external: ['@prisma/client', 'sharp'],
    write: false,
    metafile: true
  });
  const imports = Object.values(result.metafile.outputs).flatMap(output => output.imports.map(item => item.path));
  assert.equal(
    imports.some(name => name.startsWith('@prisma/')),
    false,
    'JSON / SQLite 阅读与备份不能触发未随 Mac 包分发的 PostgreSQL 驱动'
  );
});
