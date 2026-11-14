import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
      .filter(([name]) => !['chromium', 'desktop-e2e-1', 'desktop-e2e-2'].includes(name))
      .flatMap(([, commands]) => commands),
    original
  );
  assert.equal(new Set(original).size, original.length);
  assert.deepEqual(suites.chromium, [
    'test:e2e -w @study-accelerator/web -- --config playwright.mobile-evidence.config.ts editor-draft-recovery.spec.ts',
    'test:e2e -w @study-accelerator/web -- --config playwright.mobile-evidence.config.ts editor-knowra-marks.spec.ts',
    'test:e2e -w @study-accelerator/web -- --config playwright.sync-recovery.config.ts',
    'test:e2e -w @study-accelerator/web -- --config playwright.mobile-evidence.config.ts v5-global-appearance.spec.ts',
    'test:e2e -w @study-accelerator/web -- --config playwright.knowledge-concepts.config.ts'
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
        return { status: calls.length === 1 ? 1 : 0 };
      }),
    /editor-draft-recovery\.spec\.ts/
  );
  assert.deepEqual(
    calls,
    suites.chromium.slice(0, 1).map(command => ['run', ...command.split(' ')])
  );

  // 使用真实 Playwright 收集器，防止命令已登记但 testMatch 白名单漏掉文件。
  const result = spawnSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['run', ...suites.chromium[0].split(' '), '--list', '--reporter=json'],
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
        return { status: calls.length === 2 ? 1 : 0 };
      }),
    /editor-knowra-marks\.spec\.ts/
  );
  assert.deepEqual(
    calls,
    suites.chromium.slice(0, 2).map(command => ['run', ...command.split(' ')])
  );
  const result = spawnSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['run', ...suites.chromium[1].split(' '), '--list', '--reporter=json'],
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

test('Chromium gate collects explicit sync recovery and propagates its failure', async () => {
  const calls = [];
  assert.throws(
    () =>
      runSuite('chromium', (_command, args) => {
        calls.push(args);
        return { status: calls.length === 3 ? 1 : 0 };
      }),
    /playwright\.sync-recovery\.config\.ts/
  );
  assert.deepEqual(
    calls,
    suites.chromium.slice(0, 3).map(command => ['run', ...command.split(' ')])
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
  assert.equal(specs.length, 3);
  assert.equal(report.config.workers, 1);
  assert.equal(report.config.projects.length, 1);
  assert.equal(report.config.projects[0].retries, 0);
  // JSON reporter 不序列化 use；直接加载同一配置核对浏览器和隐私门禁。
  const { default: recoveryConfig } = await import('../../apps/web/playwright.sync-recovery.config.ts');
  assert.equal(recoveryConfig.projects[0].use.channel, 'chrome');
  assert.equal(recoveryConfig.use.launchOptions.chromiumSandbox, true);
  assert.equal(recoveryConfig.use.trace, 'off');
  assert.equal(recoveryConfig.use.video, 'off');
  assert.equal(recoveryConfig.use.screenshot, 'off');
  for (const spec of specs) {
    assert.equal(spec.file, 'sync-safety-recovery.spec.ts');
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
    "KNOWRA_SYNC_TEST_ALLOW_WRITES: '1'",
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
    'task-workspace-journey-${{ github.sha }}-${{ matrix.suite }}'
  ])
    assert.ok(matrixJob.includes(contract), contract);
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

test('desktop E2E shards preserve the entire glob and serial execution with separate runners', () => {
  const runtime = JSON.parse(read('apps/desktop-runtime/package.json'));
  for (const shard of [1, 2]) {
    const script = runtime.scripts[`test:e2e:shard-${shard}`];
    assert.equal(script.replace(` --test-shard=${shard}/2`, ''), runtime.scripts['test:e2e']);
    assert.equal(script, `node --test --test-concurrency=1 --test-shard=${shard}/2 test/e2e/*.test.mjs`);
    assert.deepEqual(suites[`desktop-e2e-${shard}`], [`test:e2e:shard-${shard} -w @study-accelerator/desktop-runtime`]);
    const calls = [];
    runSuite(`desktop-e2e-${shard}`, (_command, args) => {
      calls.push(args);
      return { status: 0 };
    });
    assert.equal(calls.length, 1);
    assert.throws(() => runSuite(`desktop-e2e-${shard}`, () => ({ status: 1 })));
  }
  assert.match(workflow, /if: matrix.suite == 'chromium' \|\| startsWith\(matrix.suite, 'desktop-e2e-'\)/);
  const screenshots = workflow.slice(
    workflow.indexOf('      - name: Save synthetic task workspace screenshots'),
    workflow.indexOf('      - name: Save synthetic editor recovery evidence')
  );
  assert.match(screenshots, /if: always\(\) && startsWith\(matrix.suite, 'desktop-e2e-'\)/);
  assert.match(screenshots, /name: task-workspace-journey-\$\{\{ github.sha \}\}-\$\{\{ matrix.suite \}\}/);
});

test('Python teaching example runs independently only on relevant paths or manual request', () => {
  const python = read('.github/workflows/python-tests.yml');
  assert.doesNotMatch(workflow, /python-tests:|setup-python|test_calculator/);
  assert.match(python, /workflow_dispatch:/);
  assert.match(python, /pull_request:/);
  assert.match(python, /branches: \[main\]/);
  for (const path of [
    'calculator.py',
    'test_calculator.py',
    'requirements.txt',
    '.github/workflows/python-tests.yml'
  ]) {
    assert.equal(python.split(`- '${path}'`).length - 1, 2, path);
  }
  assert.match(python, /python -m pytest -v test_calculator.py/);
  assert.match(python, /persist-credentials: false/);
  assert.match(python, /cancel-in-progress: true/);
  assert.doesNotMatch(python, /continue-on-error|pull_request_target|secrets\./);
});

test('Node E2E sharding covers every current test file exactly once using empty synthetic fixtures', () => {
  // 只复制文件名并运行空测试，不导入真实 E2E、启动浏览器或连接数据库。
  const names = readdirSync(new URL('../../apps/desktop-runtime/test/e2e/', import.meta.url))
    .filter(name => name.endsWith('.test.mjs'))
    .sort();
  assert.ok(names.length >= 2);
  const directory = mkdtempSync(path.join(os.tmpdir(), 'knowra-ci-shards-'));
  try {
    const fixtures = path.join(directory, 'test/e2e');
    mkdirSync(fixtures, { recursive: true });
    for (const name of names) {
      writeFileSync(
        path.join(fixtures, name),
        `import test from 'node:test'; test(${JSON.stringify(`fixture:${name}`)}, () => {});\n`
      );
    }
    const scripts = JSON.parse(read('apps/desktop-runtime/package.json')).scripts;
    const seen = [];
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    for (const shard of [1, 2]) {
      const args = scripts[`test:e2e:shard-${shard}`].split(' ').slice(1, -1);
      const result = spawnSync(
        process.execPath,
        [...args, '--test-reporter=tap', ...names.map(name => path.join(fixtures, name))],
        {
          cwd: directory,
          encoding: 'utf8',
          env
        }
      );
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const actual = [...result.stdout.matchAll(/^# Subtest: fixture:(.+)$/gm)].map(match => match[1]);
      assert.ok(actual.length > 0, result.stdout);
      seen.push(...actual);
    }
    assert.equal(new Set(seen).size, seen.length);
    assert.deepEqual(seen.sort(), names);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
