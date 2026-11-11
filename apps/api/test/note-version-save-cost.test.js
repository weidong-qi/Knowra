import assert from 'node:assert/strict';
import { createInMemoryNoteVersionRepository } from '../src/modules/knowledge/infrastructure/note-version-repository.ts';
import { createInMemoryKnowledgeEvidenceRepository } from '../src/modules/knowledge/infrastructure/knowledge-evidence-repository.ts';

const version = (id, noteId) => ({
  id,
  noteId,
  content: id,
  contentHash: id.padEnd(64, '0'),
  createdAt: '2026-01-01T00:00:00.000Z',
  createdBy: 'user'
});

export const noteVersionSaveCostTests = [
  {
    name: '保存正文只取旧版本 ID，批量标记旧版本证据过期且保留当前版本',
    async run() {
      const versions = createInMemoryNoteVersionRepository({
        records: [version('v1', 'n1'), version('v2', 'n1'), version('v3', 'n2')]
      });
      assert.deepEqual(versions.listIds({ noteId: 'n1' }).sort(), ['v1', 'v2']);
      const evidence = createInMemoryKnowledgeEvidenceRepository({
        records: [
          { id: 'e1', noteVersionId: 'v1', sourceType: 'noteVersion', status: 'valid' },
          { id: 'e2', noteVersionId: 'v2', sourceType: 'noteVersion', status: 'valid' },
          { id: 'e3', noteVersionId: 'v2', sourceType: 'manual', status: 'valid' },
          { id: 'e4', noteVersionId: 'v3', sourceType: 'noteVersion', status: 'valid' }
        ]
      });
      const changed = evidence.markByNoteVersionIds(['v1'], 'stale', 'noteVersion');
      assert.deepEqual(
        changed.map(item => item.id),
        ['e1']
      );
      const rest = evidence.markByNoteVersionIds(['v1', 'v2'], 'stale', 'noteVersion');
      assert.deepEqual(
        rest.map(item => item.id),
        ['e2']
      );
      assert.deepEqual(
        evidence
          .list()
          .filter(item => item.status === 'valid')
          .map(item => item.id),
        ['e3', 'e4']
      );
    }
  }
];
