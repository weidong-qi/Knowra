import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('V4 boundary checker rejects case-insensitive module stems across extensions', () => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'knowra-v4-casing-'));
  try {
    mkdirSync(path.join(fixtureRoot, 'scripts'), { recursive: true });
    const source = path.join(fixtureRoot, 'apps', 'web', 'src');
    mkdirSync(source, { recursive: true });
    const checkerPath = path.join(fixtureRoot, 'scripts', 'check-v4-boundaries.mjs');
    copyFileSync(path.join(workspaceRoot, 'scripts', 'check-v4-boundaries.mjs'), checkerPath);
    writeFileSync(path.join(source, 'Appearance.tsx'), 'export const View = 1;\n');
    writeFileSync(path.join(source, 'appearance.ts'), 'export const Model = 1;\n');
    const collision = spawnSync(process.execPath, [checkerPath], { encoding: 'utf8' });
    assert.equal(collision.status, 1);
    assert.match(collision.stderr, /Case-insensitive module collision/);
    rmSync(path.join(source, 'appearance.ts'));
    writeFileSync(path.join(source, 'appearanceModel.ts'), 'export const Model = 1;\n');
    const renamed = spawnSync(process.execPath, [checkerPath], { encoding: 'utf8' });
    assert.equal(renamed.status, 0, renamed.stderr);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('V4 boundary checker exits non-zero for an isolated V3 import', () => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'knowra-v4-boundary-'));
  try {
    mkdirSync(path.join(fixtureRoot, 'scripts'), { recursive: true });
    mkdirSync(path.join(fixtureRoot, 'apps', 'web', 'src'), { recursive: true });
    mkdirSync(path.join(fixtureRoot, 'packages', 'web-core', 'src'), { recursive: true });
    const checkerPath = path.join(fixtureRoot, 'scripts', 'check-v4-boundaries.mjs');
    copyFileSync(path.join(workspaceRoot, 'scripts', 'check-v4-boundaries.mjs'), checkerPath);
    writeFileSync(
      path.join(fixtureRoot, 'apps', 'web', 'src', 'violation.ts'),
      "import legacy from '../../web-legacy/src/legacy.js';\nexport default legacy;\n"
    );

    const result = spawnSync(process.execPath, [checkerPath], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /V4 must not import V3 module or asset/);
    assert.match(result.stderr, /apps\/web\/src\/violation\.ts/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('归档边界拒绝 V3 包及资源，同时允许现役前端内部导入', () => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'knowra-web-archive-boundary-'));
  try {
    mkdirSync(path.join(fixtureRoot, 'scripts'), { recursive: true });
    const source = path.join(fixtureRoot, 'apps', 'web', 'src');
    mkdirSync(source, { recursive: true });
    const checkerPath = path.join(fixtureRoot, 'scripts', 'check-v4-boundaries.mjs');
    copyFileSync(path.join(workspaceRoot, 'scripts', 'check-v4-boundaries.mjs'), checkerPath);
    const entry = path.join(source, 'entry.ts');
    for (const specifier of ['@study-accelerator/web-legacy', '../../web-legacy/styles/tokens.css']) {
      writeFileSync(entry, `import '${specifier}';\n`);
      const rejected = spawnSync(process.execPath, [checkerPath], { encoding: 'utf8' });
      assert.equal(rejected.status, 1, rejected.stderr);
      assert.match(rejected.stderr, /must not import V3 module or asset/);
    }
    writeFileSync(entry, "import './current';\n");
    writeFileSync(path.join(source, 'current.ts'), 'export const current = true;\n');
    const accepted = spawnSync(process.execPath, [checkerPath], { encoding: 'utf8' });
    assert.equal(accepted.status, 0, accepted.stderr);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
