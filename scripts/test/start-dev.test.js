import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(testDirectory, '..', '..');
const startDevSource = readFileSync(path.join(workspaceRoot, 'scripts', 'start-dev.mjs'), 'utf8');
const webPackage = JSON.parse(readFileSync(path.join(workspaceRoot, 'apps', 'web', 'package.json'), 'utf8'));

test('dev:all builds web-core and starts Web as the only default frontend', () => {
  const buildIndex = startDevSource.indexOf('await runNodeScript([webCoreCompiler');
  const webStartIndex = startDevSource.indexOf('const webProcess = spawnNode');

  assert.notEqual(buildIndex, -1, 'start-dev must build the shared web-core package');
  assert.notEqual(webStartIndex, -1, 'start-dev must start the Web development server');
  assert.ok(buildIndex < webStartIndex, 'web-core must be built before Web imports its package output');
  assert.doesNotMatch(
    startDevSource,
    /apps\/web-legacy\/src\/main\.js/,
    'legacy V3 must not start from the default dev entry'
  );
  assert.match(startDevSource, /writeRuntimePort\(runtimePortsFile, 'web', webPort\)/);
});

test('Web typecheck refreshes web-core declarations first', () => {
  assert.equal(webPackage.scripts.pretypecheck, 'npm run build -w @study-accelerator/web-core');
});
