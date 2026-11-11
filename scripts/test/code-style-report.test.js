import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const workflow = readFileSync(new URL('../../.github/workflows/code-style.yml', import.meta.url), 'utf8');
const summaryStep = workflow.split('      - name: Write summary\n')[1].split('        run: |\n')[1];

test('style report retains ESLint and Prettier without a permissive API check', () => {
  assert.match(workflow, /eslint \. --report/);
  assert.match(workflow, /prettier \. --check --report/);
  assert.doesNotMatch(workflow, /checkJs|typecheck:api|api-typecheck|npm ci/);
});

test('style summary still reports both tools when output is missing', { skip: process.platform === 'win32' }, t => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'knowra-style-report-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const summary = path.join(dir, 'summary.md');
  const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', summaryStep.replace(/^ {10}/gm, '')], {
    encoding: 'utf8',
    env: { ...process.env, RUNNER_TEMP: dir, GITHUB_STEP_SUMMARY: summary }
  });
  assert.equal(result.status, 0, result.stderr);
  const report = readFileSync(summary, 'utf8');
  assert.match(report, /### ESLint\n```\n无输出/);
  assert.match(report, /### Prettier\n```\n无输出/);
  assert.doesNotMatch(report, /API|类型错误/);
});
