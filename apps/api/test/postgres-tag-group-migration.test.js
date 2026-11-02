import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildJsonMigrationPlan,
  applyJsonMigration,
  assertEmptyTarget
} from '../src/infrastructure/migration/json-to-postgres.js';
import { createPostgresSnapshotService } from '../src/infrastructure/postgres-snapshot-service.js';
import { createLocalAttachmentFileManager } from '../src/infrastructure/local-attachment-file-manager.ts';
import { validateLocalSnapshot } from '../src/infrastructure/local-data-schema.js';

const source = () => ({
  folders: [],
  attachments: [],
  contentAnnotations: [],
  spaces: [{ id: 's', userId: 'demo', name: 'Space' }],
  tagGroups: [
    {
      id: 'custom',
      spaceId: 's',
      name: '自定义组',
      code: null,
      selectionMode: 'single',
      isSystem: false,
      sortOrder: 12,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z'
    }
  ],
  tags: [{ id: 'tag', spaceId: 's', name: '标签', groupId: 'custom' }],
  notes: [{ id: 'note', spaceId: 's', title: '正文', rawMarkdown: 'text', tagIds: ['tag'] }]
});
const models = [
  'user',
  'knowledgeSpace',
  'folder',
  'tagGroup',
  'tag',
  'note',
  'noteTag',
  'attachment',
  'contentAnnotation',
  'annotationExclusion',
  'annotationRevision',
  'analysisScopeSnapshot',
  'noteVersion',
  'knowledgeItem',
  'knowledgeEvidence',
  'knowledgeArtifactProvenance',
  'learningObjective',
  'examProfile',
  'examFocus',
  'question',
  'questionObjective',
  'questionSource'
];

// Contract double enforces the group foreign-key ordering and transaction rollback.
// This is deliberately not represented as a real PostgreSQL integration test.
function database() {
  let rows = Object.fromEntries(models.map(model => [model, []]));
  let failTags = false;
  const client = Object.fromEntries(
    models.map(model => [
      model,
      {
        async findMany() {
          return structuredClone(rows[model]);
        },
        async count() {
          return rows[model].length;
        },
        async deleteMany() {
          if (model === 'tagGroup') assert.equal(rows.tag.length, 0);
          if (model === 'knowledgeSpace') assert.equal(rows.tagGroup.length, 0);
          rows[model] = [];
        },
        async createMany({ data }) {
          if (model === 'tag' && failTags) throw new Error('injected tag failure');
          if (model === 'tag') data.forEach(tag => assert.ok(rows.tagGroup.some(group => group.id === tag.groupId)));
          rows[model].push(...structuredClone(data));
        }
      }
    ])
  );
  client.$transaction = async operation => {
    const before = structuredClone(rows);
    try {
      return await operation(client);
    } catch (error) {
      rows = before;
      throw error;
    }
  };
  return {
    client,
    rows: () => rows,
    failTags: () => {
      failTags = true;
    }
  };
}

export const postgresTagGroupMigrationTests = [
  {
    name: 'PostgreSQL group migration preserves custom and legacy system groups and detects occupied group targets',
    async run() {
      const prepared = buildJsonMigrationPlan({ input: source() });
      assert.equal(prepared.canApply, true);
      assert.equal(prepared.plan.tagGroups.length, 5);
      assert.equal(prepared.report.counts.tagGroups, 5);
      const db = database();
      await applyJsonMigration({ client: db.client, ...prepared });
      const custom = db.rows().tagGroup.find(group => group.id === 'custom');
      assert.equal(custom.selectionMode, 'single');
      assert.equal(custom.sortOrder, 12);
      assert.equal(custom.updatedAt.toISOString(), '2026-02-01T00:00:00.000Z');
      const legacy = buildJsonMigrationPlan({
        input: {
          ...source(),
          notes: [],
          tagGroups: [],
          spaces: source().spaces,
          tags: [{ id: 'old', spaceId: 's', name: '旧标签' }]
        }
      });
      assert.equal(legacy.canApply, true);
      assert.ok(legacy.plan.tagGroups.some(group => group.id === legacy.plan.tags[0].groupId));
      const occupied = database();
      occupied.rows().tagGroup.push(custom);
      await assert.rejects(
        assertEmptyTarget(occupied.client),
        error => error.code === 'MIGRATION_TARGET_NOT_EMPTY' && error.message.includes('tagGroup')
      );
      const invalid = source();
      invalid.tagGroups.push({ ...invalid.tagGroups[0], id: 'duplicate' });
      assert.equal(buildJsonMigrationPlan({ input: invalid }).canApply, false);
    }
  },
  {
    name: 'PostgreSQL snapshot import/export retains group references and rolls back replacement failures',
    async run() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-pg-groups-'));
      try {
        const db = database();
        const prepared = buildJsonMigrationPlan({ input: source() });
        await applyJsonMigration({ client: db.client, ...prepared });
        const repositoryModels = {
          knowledgeSpace: 'knowledgeSpace',
          folder: 'folder',
          tag: 'tag',
          tagGroup: 'tagGroup',
          note: 'note',
          noteVersion: 'noteVersion',
          contentAnnotation: 'contentAnnotation',
          knowledgeItem: 'knowledgeItem',
          knowledgeEvidence: 'knowledgeEvidence',
          knowledgeArtifactProvenance: 'knowledgeArtifactProvenance',
          learningObjective: 'learningObjective',
          examProfile: 'examProfile',
          examFocus: 'examFocus',
          question: 'question',
          questionObjective: 'questionObjective',
          questionSource: 'questionSource'
        };
        const repositories = Object.fromEntries(
          Object.entries(repositoryModels).map(([name, model]) => [
            `${name}Repository`,
            {
              async list() {
                return JSON.parse(JSON.stringify(db.rows()[model])).map(row =>
                  model === 'note'
                    ? {
                        ...row,
                        tagIds: db
                          .rows()
                          .noteTag.filter(link => link.noteId === row.id)
                          .map(link => link.tagId),
                        deleted: false
                      }
                    : row
                );
              },
              async listByQuestionIds() {
                return [];
              }
            }
          ])
        );
        const storage = createPostgresSnapshotService({
          client: db.client,
          repositories,
          storageRootDir: dir,
          attachmentStore: {
            fileManager: createLocalAttachmentFileManager({
              storageRootDir: dir,
              uploadsDir: path.join(dir, 'uploads')
            }),
            async listAttachments() {
              return [];
            },
            async exportAttachmentsSnapshot() {
              return [];
            }
          }
        });
        const exported = await storage.exportKnowledgeBase();
        assert.equal(validateLocalSnapshot(exported).data.tagGroups.length, 5);
        db.rows().tagGroup.push({ ...db.rows().tagGroup[0], id: 'stale', name: '被替换的分组' });
        const imported = await storage.importKnowledgeBase(exported);
        assert.deepEqual(imported.data.tagGroups, exported.data.tagGroups);
        assert.deepEqual(imported.data.tags, exported.data.tags);
        const before = structuredClone(db.rows());
        db.failTags();
        await assert.rejects(storage.importKnowledgeBase(exported), /injected tag failure/);
        assert.deepEqual(db.rows(), before);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  }
];
