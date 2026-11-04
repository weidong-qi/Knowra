import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFileDataStore } from '../src/infrastructure/file-data-store.js';
import {
  syntheticProvenanceFixture,
  assertMinimalProvenanceTransport
} from './fixtures/knowledge-artifact-provenance.fixture.js';

function withFixture(run, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-provenance-migration-'));
  const file = path.join(root, 'data.json'),
    fixture = syntheticProvenanceFixture(options);
  const input = {
    schemaVersion: 6,
    ...fixture.state,
    knowledgeExtractionCommits: { version: 1, receipts: [fixture.receipt] }
  };
  fs.writeFileSync(file, JSON.stringify(input));
  try {
    return run({ ...fixture, root, file, input });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

export const knowledgeArtifactProvenancePersistenceTests = [
  {
    name: '05B JSON schema6合法receipt回填摘要并保留编辑，重启及业务快照保持同hash',
    run() {
      withFixture(
        f => {
          f.input.knowledgeItems[0].title = '用户修订';
          f.input.knowledgeItems[0].sourceMode = 'manual';
          fs.writeFileSync(f.file, JSON.stringify(f.input));
          const store = createFileDataStore(f.file);
          assert.deepEqual(store.state.knowledgeArtifactProvenance, [f.provenance]);
          assert.equal(store.state.knowledgeItems[0].title, '用户修订');
          const disk = JSON.parse(fs.readFileSync(f.file, 'utf8'));
          assert.equal(disk.schemaVersion, 8);
          assert.deepEqual(disk.knowledgeExtractionCommits.receipts[0], f.receipt);
          assertMinimalProvenanceTransport(store.exportSnapshot(), f.provenance);
          assertMinimalProvenanceTransport(store.getSyncJournal(), f.provenance);
          assert.deepEqual(createFileDataStore(f.file).state.knowledgeArtifactProvenance, [f.provenance]);
          const copy = createFileDataStore(path.join(f.root, 'copy.json'));
          copy.importSnapshot(store.exportSnapshot());
          assert.deepEqual(copy.state.knowledgeArtifactProvenance, [f.provenance]);
        },
        { alias: true }
      );
    }
  },
  {
    name: '05B JSON坏旧receipt保留隔离且核心编辑可用，坏新版来源不覆盖原文',
    run() {
      withFixture(f => {
        f.input.knowledgeExtractionCommits.receipts[0].receiptHash = 'broken';
        fs.writeFileSync(f.file, JSON.stringify(f.input));
        const store = createFileDataStore(f.file);
        assert(store.knowledgeExtractionCommitStoreError);
        assert.equal(store.state.knowledgeArtifactProvenance[0].state, 'legacy-unavailable');
        store.runTransaction(() => {
          store.state.knowledgeItems[0].title = '普通编辑';
          store.flush();
        });
        const disk = JSON.parse(fs.readFileSync(f.file, 'utf8'));
        assert.equal(disk.knowledgeExtractionCommits.receipts[0].receiptHash, 'broken');
        disk.knowledgeArtifactProvenance[0].schemaVersion = 99;
        const before = JSON.stringify(disk);
        fs.writeFileSync(f.file, before);
        assert.throws(() => createFileDataStore(f.file), { code: 'KNOWLEDGE_ARTIFACT_PROVENANCE_INVALID' });
        assert.equal(fs.readFileSync(f.file, 'utf8'), before);
      });
    }
  },
  {
    name: '05B JSON回填最终写入失败保留旧文件；旧快照无法降级当前来源',
    run() {
      withFixture(f => {
        const before = fs.readFileSync(f.file, 'utf8');
        assert.throws(
          () =>
            createFileDataStore(f.file, {
              writeJson() {
                throw new Error('migration-write-failed');
              }
            }),
          /migration-write-failed/
        );
        assert.equal(fs.readFileSync(f.file, 'utf8'), before);
        const store = createFileDataStore(f.file),
          after = fs.readFileSync(f.file, 'utf8');
        assert.throws(() => store.importSnapshot({ schemaVersion: 6, data: f.state }), {
          code: 'KNOWLEDGE_ARTIFACT_PROVENANCE_CONFLICT'
        });
        assert.equal(fs.readFileSync(f.file, 'utf8'), after);
        assert.deepEqual(store.state.knowledgeArtifactProvenance, [f.provenance]);
      });
    }
  }
];
