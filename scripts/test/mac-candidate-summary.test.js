import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { candidateSummary } from '../mac-candidate-summary.mjs';

const commit = 'a'.repeat(40);
const artifactUrl = 'https://github.com/weidong-qi/Knowra/actions/runs/123/artifacts/456';
const manifest = () => ({
  archive: '知境·Knowra-Mac-arm64.zip',
  sha256: 'b'.repeat(64),
  buildInfo: {
    schemaVersion: 1,
    version: '2.30.0',
    commit,
    state: 'clean',
    source: 'git',
    builtAt: '2026-11-14T00:00:00.000Z'
  },
  distribution: { channel: 'candidate', signing: 'ad-hoc', notarized: false }
});

test('Mac candidate summary includes exact identity, download and trust boundary', () => {
  const summary = candidateSummary(manifest(), { commit, artifactUrl });
  for (const value of [commit, 'b'.repeat(64), '2.30.0', artifactUrl, '不是稳定 Release', '未经 Apple 公证', '14 天']) {
    assert.ok(summary.includes(value), value);
  }
});

test('Mac candidate summary rejects mismatched identity, malformed hashes and unsafe download links', () => {
  for (const change of [
    value => {
      value.buildInfo.commit = 'c'.repeat(40);
    },
    value => {
      value.buildInfo.state = 'dirty';
    },
    value => {
      value.distribution.notarized = true;
    },
    value => {
      value.archive = 'other.zip';
    },
    value => {
      value.sha256 = 'short';
    }
  ]) {
    const value = manifest();
    change(value);
    assert.throws(() => candidateSummary(value, { commit, artifactUrl }));
  }
  for (const invalid of [
    '',
    'javascript:alert(1)',
    'https://example.com/file',
    `${artifactUrl}?token=secret`,
    `${artifactUrl}#fragment`
  ]) {
    assert.throws(() => candidateSummary(manifest(), { commit, artifactUrl: invalid }));
  }
  assert.throws(() => candidateSummary(manifest(), { commit: undefined, artifactUrl }));
});

test('Mac workflow keeps verification before uncompressed candidate upload and success-only summary', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/mac-build.yml', import.meta.url), 'utf8');
  const upload = workflow.slice(workflow.indexOf('      - name: 保存候选产物'));
  assert.ok(workflow.indexOf('run: npm run test:mac') < workflow.indexOf('id: candidate'));
  assert.match(workflow, /native-image-runtime\.mjs/);
  assert.match(upload, /compression-level: 0/);
  assert.match(upload, /steps\.candidate\.outputs\.artifact-url/);
  assert.match(upload, /run: node scripts\/mac-candidate-summary\.mjs/);
  assert.doesNotMatch(upload, /if: always|continue-on-error/);
  assert.match(workflow, /persist-credentials: false/);
});
