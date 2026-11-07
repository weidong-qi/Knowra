import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const workflow = readFileSync(new URL('../../.github/workflows/code-style.yml', import.meta.url), 'utf8');
const apiStep = workflow
  .split('      - name: API checkJs\n')[1]
  .split('        run: |\n')[1]
  .split('      - name: Write summary\n')[0];
const summaryStep = workflow.split('      - name: Write summary\n')[1].split('        run: |\n')[1];
const unindent = script => script.replace(/^ {10}/gm, '');

for (const [name, code, stdout, stderr, expected] of [
  ['clean check', '0', '', '', /0 个类型错误（退出码 0）/],
  ['type diagnostics', '2', 'src/main.js(1,1): error TS2339: test', '', /1 个类型错误（退出码 2）/],
  ['compiler launch failure', '127', '', 'tsc: command not found', /检查未完成.*127/],
  ['stderr diagnostics', '2', '', 'error TS18003: No inputs were found', /1 个类型错误（退出码 2）/]
]) {
  test(`API report preserves ${name}`, { skip: process.platform === 'win32' }, t => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'knowra-style-report-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const summary = path.join(dir, 'summary.md');
    const result = spawnSync(
      'bash',
      [
        '-e',
        '-o',
        'pipefail',
        '-c',
        `
      npm() {
        if [ "$2" = "prisma:generate" ]; then return 0; fi
        printf '%s\\n' "$TEST_STDOUT"
        printf '%s\\n' "$TEST_STDERR" >&2
        return "$TEST_EXIT"
      }
      ${unindent(apiStep)}
      ${unindent(summaryStep)}
    `
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          RUNNER_TEMP: dir,
          GITHUB_STEP_SUMMARY: summary,
          TEST_EXIT: code,
          TEST_STDOUT: stdout,
          TEST_STDERR: stderr
        }
      }
    );
    assert.equal(result.status, 0, result.stderr);
    const report = readFileSync(summary, 'utf8');
    assert.match(report, expected);
    if (code === '127') assert.doesNotMatch(report, /0 个类型错误/);
    if (stderr) assert.match(readFileSync(path.join(dir, 'api-typecheck.txt'), 'utf8'), new RegExp(stderr));
  });
}
