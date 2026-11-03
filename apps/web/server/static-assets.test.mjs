import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveAssetPath } from './static-assets.mjs';

test('V4 static server resolves the entry, hashed assets and SPA routes', () => {
  const distRoot = mkdtempSync(path.join(tmpdir(), 'knowra-v4-dist-'));
  try {
    mkdirSync(path.join(distRoot, 'assets'));
    writeFileSync(path.join(distRoot, 'index.html'), '<main>Knowra</main>');
    writeFileSync(path.join(distRoot, 'assets', 'index-abc.js'), 'export {};');
    assert.equal(resolveAssetPath('/', distRoot), path.join(distRoot, 'index.html'));
    assert.equal(resolveAssetPath('/materials/notes/demo', distRoot), path.join(distRoot, 'index.html'));
    assert.equal(resolveAssetPath('/assets/index-abc.js', distRoot), path.join(distRoot, 'assets', 'index-abc.js'));
  } finally {
    rmSync(distRoot, { recursive: true, force: true });
  }
});

test('V4 static server rejects traversal and missing file paths', () => {
  const distRoot = mkdtempSync(path.join(tmpdir(), 'knowra-v4-dist-'));
  try {
    writeFileSync(path.join(distRoot, 'index.html'), '<main>Knowra</main>');
    assert.equal(resolveAssetPath('/../package.json', distRoot), null);
    assert.equal(resolveAssetPath('/%2e%2e/package.json', distRoot), null);
    assert.equal(resolveAssetPath('/assets/missing.js', distRoot), null);
  } finally {
    rmSync(distRoot, { recursive: true, force: true });
  }
});
