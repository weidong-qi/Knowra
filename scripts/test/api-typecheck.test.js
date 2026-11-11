import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = file => readFileSync(path.join(root, file), 'utf8');
const api = JSON.parse(read('apps/api/package.json'));
const config = JSON.parse(read('apps/api/tsconfig.json'));
const filesBelow = directory =>
  readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(file) : [file];
  });

test('API has one strict configuration and both public commands use it', () => {
  assert.equal(config.compilerOptions.strict, true);
  assert.equal(config.compilerOptions.noEmit, true);
  assert.equal(config.compilerOptions.erasableSyntaxOnly, true);
  for (const key of ['allowJs', 'checkJs']) assert.equal(Object.hasOwn(config.compilerOptions, key), false);
  assert.deepEqual(config.include, ['src/**/*.ts', 'test/**/*.type-test.ts']);
  assert.equal(config.exclude, undefined);
  assert.equal(config.files, undefined);
  assert.equal(config.extends, undefined);
  assert.equal(existsSync(path.join(root, 'apps/api/tsconfig.migrated.json')), false);
  assert.equal(api.scripts.typecheck, 'tsc -p tsconfig.json');
  assert.equal(api.scripts['typecheck:migrated'], 'npm run typecheck');
  assert.equal(
    JSON.parse(read('package.json')).scripts['typecheck:api'],
    'npm run typecheck -w @study-accelerator/api'
  );
});

test('resolved strict program covers every API source and existing contract type test', () => {
  const resolved = spawnSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['run', 'typecheck', '-w', '@study-accelerator/api', '--', '--showConfig'],
    { cwd: root, encoding: 'utf8' }
  );
  assert.equal(resolved.status, 0, resolved.stderr || resolved.stdout);
  const program = JSON.parse(resolved.stdout.slice(resolved.stdout.indexOf('{')));
  const sources = filesBelow(path.join(root, 'apps/api/src'));
  assert.ok(sources.length > 0);
  assert.deepEqual(
    sources.filter(file => /\.[cm]?jsx?$/.test(file)),
    []
  );
  const expected = [
    ...sources,
    ...filesBelow(path.join(root, 'apps/api/test')).filter(file => file.endsWith('.type-test.ts'))
  ]
    .filter(file => file.endsWith('.ts'))
    .map(file => `./${path.relative(path.join(root, 'apps/api'), file).split(path.sep).join('/')}`)
    .sort();
  assert.deepEqual(program.files.sort(), expected);
  assert.equal(program.compilerOptions.strict, true);
});

test(
  'CI runs the full strict API check as a required, failure-propagating step',
  { skip: process.platform === 'win32' },
  () => {
    const workflow = read('.github/workflows/ci.yml');
    const checks = workflow.slice(workflow.indexOf('  checks:\n'), workflow.indexOf('  suites:\n'));
    const command = checks.match(/- name: Check API TypeScript \(strict\)\n {8}run: ([^\n]+)/)?.[1];
    assert.equal(command, 'npm run typecheck:api');
    assert.doesNotMatch(checks, /continue-on-error|typecheck:migrated|checkJs/);
    assert.match(workflow, /needs: \[checks, suites, isolated-image\]/);
    for (const code of [0, 2, 127]) {
      const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', `npm() { return ${code}; }; ${command}`]);
      assert.equal(result.status, code);
    }
  }
);
