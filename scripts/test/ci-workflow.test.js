import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { suites, runSuite, requireSuccessfulJobs } from '../ci.mjs';

const read = file => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const workflow = read('.github/workflows/ci.yml');
const successful = () =>
  Object.fromEntries(['checks', 'suites', 'isolated-image'].map(name => [name, { result: 'success' }]));

test('CI partitions every npm test entry exactly once and keeps Chromium in addition', () => {
  const original = JSON.parse(read('package.json'))
    .scripts.test.split(' && ')
    .map(command => {
      assert.match(command, /^npm run [\w:-]+$/);
      return command.slice('npm run '.length);
    });
  assert.deepEqual(
    Object.entries(suites)
      .filter(([name]) => name !== 'chromium')
      .flatMap(([, commands]) => commands),
    original
  );
  assert.equal(new Set(original).size, original.length);
  assert.deepEqual(suites.chromium, [
    'test:e2e -w @study-accelerator/desktop-runtime',
    'test:e2e -w @study-accelerator/web-v4 -- --config playwright.mobile-evidence.config.ts editor-draft-recovery.spec.ts',
    'test:e2e -w @study-accelerator/web-v4 -- --config playwright.mobile-evidence.config.ts editor-knowra-marks.spec.ts'
  ]);
  const matrix = workflow
    .match(/suite: \[([^\]]+)\]/)[1]
    .split(',')
    .map(value => value.trim());
  assert.deepEqual(matrix, Object.keys(suites));
  assert.match(workflow, /fail-fast: false/);
});

test('Chromium gate collects both editor recovery scenarios and propagates their failure', () => {
  const calls = [];
  assert.throws(
    () =>
      runSuite('chromium', (command, args) => {
        calls.push(args);
        return { status: calls.length === 2 ? 1 : 0 };
      }),
    /editor-draft-recovery\.spec\.ts/
  );
  assert.deepEqual(
    calls,
    suites.chromium.slice(0, 2).map(command => ['run', ...command.split(' ')])
  );

  // 使用真实 Playwright 收集器，防止命令已登记但 testMatch 白名单漏掉文件。
  const result = spawnSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['run', ...suites.chromium[1].split(' '), '--list', '--reporter=json'],
    { cwd: new URL('../../', import.meta.url), encoding: 'utf8', env: process.env }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout.slice(result.stdout.indexOf('{')));
  assert.deepEqual(report.errors, []);
  const specs = report.suites.flatMap(suite => suite.specs);
  assert.equal(specs.length, 2);
  for (const spec of specs) {
    assert.equal(spec.file, 'editor-draft-recovery.spec.ts');
    assert.equal(spec.tests.length, 1);
    assert.equal(spec.tests[0].expectedStatus, 'passed');
  }
});

test('Chromium gate collects Knowra copy/save/reload scenarios and propagates their failure', () => {
  const calls = [];
  assert.throws(
    () =>
      runSuite('chromium', (_command, args) => {
        calls.push(args);
        return { status: calls.length === 3 ? 1 : 0 };
      }),
    /editor-knowra-marks\.spec\.ts/
  );
  assert.deepEqual(
    calls,
    suites.chromium.map(command => ['run', ...command.split(' ')])
  );
  const result = spawnSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['run', ...suites.chromium[2].split(' '), '--list', '--reporter=json'],
    { cwd: new URL('../../', import.meta.url), encoding: 'utf8', env: process.env }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout.slice(result.stdout.indexOf('{')));
  assert.deepEqual(report.errors, []);
  const specs = report.suites.flatMap(suite => suite.specs);
  assert.equal(specs.length, 6);
  for (const spec of specs) {
    assert.equal(spec.file, 'editor-knowra-marks.spec.ts');
    assert.equal(spec.tests.length, 1);
    assert.equal(spec.tests[0].expectedStatus, 'passed');
  }
});

test('CI aggregation accepts success only and rejects missing, extra, skipped or cancelled jobs', () => {
  requireSuccessfulJobs(successful());
  for (const name of Object.keys(successful())) {
    for (const result of ['failure', 'cancelled', 'skipped', 'pending', undefined]) {
      const needs = successful();
      needs[name].result = result;
      assert.throws(() => requireSuccessfulJobs(needs));
    }
    const needs = successful();
    delete needs[name];
    assert.throws(() => requireSuccessfulJobs(needs));
  }
  for (const value of [null, [], {}, { ...successful(), unexpected: { result: 'success' } }]) {
    assert.throws(() => requireSuccessfulJobs(value));
  }
  const gate = workflow.slice(workflow.indexOf('  verify:\n'));
  assert.match(gate, /name: Node 24 · build and test/);
  assert.match(gate, /if: always\(\)/);
  assert.match(gate, /needs: \[checks, suites, isolated-image\]/);
  assert.match(gate, /NEEDS_JSON: \$\{\{ toJSON\(needs\) \}\}/);
  assert.ok(gate.indexOf('node scripts/ci.mjs gate') < gate.indexOf('package-ci-release.sh'));
  assert.doesNotMatch(gate, /continue-on-error|if: always\(\)[\s\S]*if: always\(\)/);
});

test('suite runner preserves commands, stops on failure and rejects invalid suites', () => {
  const calls = [];
  runSuite('web', (command, args) => {
    calls.push([command, args]);
    return { status: 0 };
  });
  assert.deepEqual(
    calls.map(([, args]) => args),
    suites.web.map(name => ['run', name])
  );
  let count = 0;
  assert.throws(() =>
    runSuite('web', () => {
      count++;
      return { status: 1 };
    })
  );
  assert.equal(count, 1);
  assert.throws(() => runSuite('api', () => ({ status: null, signal: 'SIGTERM' })));
  assert.throws(() => runSuite('api', () => ({ error: new Error('spawn failed') })));
  for (const name of ['unknown', '__proto__', undefined]) assert.throws(() => runSuite(name));
  const result = spawnSync(process.execPath, ['scripts/ci.mjs', 'gate'], {
    env: { ...process.env, NEEDS_JSON: '{bad' }
  });
  assert.notEqual(result.status, 0);
});

test('all split suites retain database, production identity, serial runtime and fork-safe guards', () => {
  const matrixJob = workflow.slice(workflow.indexOf('  suites:\n'), workflow.indexOf('  verify:\n'));
  for (const contract of [
    'image: postgres:17',
    'KNOWRA_SYNC_TEST_DATABASE_URL:',
    'npm ci --ignore-scripts',
    'npm run prisma:generate',
    'npm run prisma:migrate:deploy',
    'NODE_ENV=production npm run build:web',
    '--verify-web "$GITHUB_WORKSPACE" "$GITHUB_SHA"',
    "-name '*.map'",
    'npx playwright install --with-deps chromium',
    'google-chrome --version',
    'editor-draft-recovery-${{ github.sha }}',
    'node scripts/ci.mjs suite "$CI_SUITE"',
    'task-workspace-journey-${{ github.sha }}'
  ])
    assert.ok(matrixJob.includes(contract), contract);
  assert.match(matrixJob, /KNOWRA_SYNC_TEST_ALLOW_WRITES: ['"]1['"]/);
  const runtime = JSON.parse(read('apps/desktop-runtime/package.json'));
  assert.match(runtime.scripts.test, /--test-concurrency=1/);
  assert.match(runtime.scripts['test:e2e'], /--test-concurrency=1/);
  assert.match(workflow, /permissions:\n {2}contents: read/);
  assert.doesNotMatch(workflow, /pull_request_target|secrets\.|continue-on-error/);
});

test('main pushes and PRs remain automatic; branch candidates have manual fallback', () => {
  for (const file of ['.github/workflows/ci.yml', '.github/workflows/mac-build.yml']) {
    const text = read(file);
    assert.match(text, / {2}pull_request:/);
    assert.match(text, / {2}workflow_dispatch:/);
    assert.match(text, / {2}push:\n {4}branches:(?:\n {6}- main| \[main\])/);
    assert.doesNotMatch(text, /codex\/\*\*/);
  }
  assert.match(workflow, /\[\[ "\$EVENT_NAME" == "push" && -n "\$BEFORE_SHA"/);
  assert.match(workflow, /git diff-tree --check --root/);
  const release = workflow.slice(workflow.indexOf('      - name: Install release dependencies'));
  assert.equal(
    (release.match(/if: github.event_name == 'push' \|\| github.event_name == 'workflow_dispatch'/g) || []).length,
    4
  );
});
