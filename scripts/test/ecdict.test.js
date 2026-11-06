import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import manifest from '../../apps/web/src/features/dictionary/ecdictManifest.ts';

const directory = fileURLToPath(new URL(`../../apps/web/public/dictionaries/${manifest.version}/`, import.meta.url));
test('ECDICT 离线分片与清单哈希一致，保留许可、中文释义及科学词汇的真实词形映射', () => {
  let total = 0;
  for (const [prefix, metadata] of Object.entries(manifest.shards)) {
    const bytes = fs.readFileSync(path.join(directory, `${prefix}.json.gz`));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), metadata.sha256, prefix);
    const values = JSON.parse(gunzipSync(bytes));
    assert.equal(Object.keys(values).length, metadata.entries);
    total += metadata.entries;
  }
  assert.equal(total, manifest.entryCount);
  assert.match(fs.readFileSync(path.join(directory, 'LICENSE.txt'), 'utf8'), /MIT License/);
  const read = prefix => JSON.parse(gunzipSync(fs.readFileSync(path.join(directory, `${prefix}.json.gz`))));
  assert.equal(read('gr').gradients[3], 'gradient');
  assert.match(read('gr').gradient[1], /梯度/);
  assert.equal(read('mi').minima[3], 'minimum');
  assert.match(read('co').convolution[1], /卷积/);
});
