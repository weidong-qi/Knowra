import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const phase1PostgresTests = [
  {
    name: 'storage config exposes local-json as the safe default and postgres as an opt-in driver',
    async run() {
      const { createStorageConfig } = await import('../src/config/storage.config.js');
      assert.equal(createStorageConfig({}).persistenceDriver, 'local-json');
      assert.equal(
        createStorageConfig({ PERSISTENCE_DRIVER: 'postgres', DATABASE_URL: 'postgresql://db' }).persistenceDriver,
        'postgres'
      );
      assert.equal(
        createStorageConfig({ PERSISTENCE_DRIVER: 'postgres', DATABASE_URL: 'postgresql://db' }).databaseUrl,
        'postgresql://db'
      );
      assert.throws(() => createStorageConfig({ PERSISTENCE_DRIVER: 'sqlite' }), /Unsupported PERSISTENCE_DRIVER/);
    }
  },
  {
    name: 'Prisma runtime can be tested with an injected client without opening a database connection',
    async run() {
      const { createPrismaRuntime } = await import('../src/infrastructure/prisma-client.js');
      let connected = 0;
      let disconnected = 0;
      const client = {
        async $connect() {
          connected += 1;
        },
        async $disconnect() {
          disconnected += 1;
        }
      };
      const runtime = createPrismaRuntime({ client });
      await runtime.connect();
      await runtime.connect();
      await runtime.disconnect();
      assert.equal(connected, 1);
      assert.equal(disconnected, 1);
    }
  },
  {
    name: 'JSON migration plan preserves ids, soft deletes, tags, hashes and timestamp repairs',
    async run() {
      const { buildJsonMigrationPlan } = await import('../src/infrastructure/migration/json-to-postgres.ts');
      const fallbackTimestamp = '2026-07-27T00:00:00.000Z';
      const result = buildJsonMigrationPlan({
        input: {
          spaces: [{ id: 'space-demo', userId: 'demo', name: 'Default' }],
          folders: [],
          tags: [{ id: 'tag-中文', spaceId: 'space-demo', name: '中文', color: '#fff' }],
          notes: [
            {
              id: 'note-1',
              spaceId: 'space-demo',
              title: 'Deleted',
              rawMarkdown: 'hello [[note-2]]',
              deleted: true,
              tagIds: ['tag-中文']
            }
          ],
          attachments: [],
          contentAnnotations: []
        },
        fallbackTimestamp
      });
      assert.equal(result.canApply, true);
      assert.equal(result.plan.users[0].id, 'demo');
      assert.equal(result.plan.notes[0].deletedAt, fallbackTimestamp);
      assert.deepEqual(result.plan.notes[0].tagIds, ['tag-中文']);
      assert.deepEqual(result.plan.notes[0].internalLinks, ['note-2']);
      assert.equal(
        result.plan.notes[0].contentHash,
        crypto.createHash('sha256').update('hello [[note-2]]').digest('hex')
      );
      assert.equal(result.plan.noteVersions.length, 1);
      assert.equal(result.plan.noteVersions[0].content, 'hello [[note-2]]');
      assert.equal(
        result.report.repairs.some(item => item.code === 'NOTE_CREATED_AT_DEFAULTED'),
        true
      );
    }
  },
  {
    name: 'PostgreSQL app context is opt-in and can be assembled with an injected Prisma client',
    async run() {
      const { createPostgresAppContext } = await import('../src/postgres-app.factory.js');
      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-phase1-context-'));
      let ownerUpserts = 0;
      let provenanceSchemaChecks = 0;
      try {
        const model = () => ({
          async findUnique() {
            return null;
          },
          async findMany() {
            return [];
          },
          async findFirst() {
            return null;
          },
          async upsert() {
            return {};
          },
          async count() {
            return 0;
          },
          async delete() {
            return {};
          },
          async deleteMany() {
            return { count: 0 };
          },
          async create() {
            return {};
          },
          async createMany() {
            return { count: 0 };
          },
          async update() {
            return {};
          }
        });
        const client = {
          user: {
            ...model(),
            async upsert() {
              ownerUpserts += 1;
              return {};
            }
          },
          knowledgeSpace: model(),
          folder: model(),
          tag: model(),
          tagGroup: model(),
          note: model(),
          noteTag: model(),
          attachment: model(),
          pdfAnnotation: model(),
          contentAnnotation: model(),
          noteVersion: model(),
          knowledgeItem: model(),
          knowledgeEvidence: model(),
          knowledgeArtifactProvenance: model(),
          annotationExclusion: model(),
          annotationRevision: model(),
          analysisScopeSnapshot: model(),
          syncJournal: model(),
          learningObjective: model(),
          examProfile: model(),
          examFocus: model(),
          question: model(),
          questionObjective: model(),
          questionSource: model(),
          personalTodo: model(),
          async $connect() {},
          async $disconnect() {},
          async $queryRawUnsafe(sql) {
            if (sql === 'SELECT version FROM knowledge_artifact_provenance_migrations') {
              provenanceSchemaChecks += 1;
              return [{ version: 1 }];
            }
            return [];
          },
          async $executeRawUnsafe() {
            return 0;
          },
          async $transaction(operation) {
            return operation(this);
          }
        };
        const app = await createPostgresAppContext({ client, storageRootDir: tempRoot });
        assert.equal(app.driver, 'postgres');
        assert.equal(typeof app.http.knowledge.createNote, 'function');
        assert.equal(typeof app.http.storage.exportKnowledgeBase, 'function');
        assert.equal(ownerUpserts, 1);
        assert.equal(provenanceSchemaChecks, 1);
        await app.close();
      } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'JSON migration preflight blocks missing attachment files unless explicitly allowed',
    async run() {
      const { buildJsonMigrationPlan } = await import('../src/infrastructure/migration/json-to-postgres.ts');
      const input = {
        spaces: [{ id: 'space-demo', userId: 'demo', name: 'Default' }],
        folders: [],
        tags: [],
        notes: [{ id: 'note-1', spaceId: 'space-demo', title: 'Note', rawMarkdown: 'body' }],
        attachments: [
          {
            id: 'attachment-1',
            noteId: 'note-1',
            fileName: 'missing.txt',
            mimeType: 'text/plain',
            size: 3,
            storagePath: 'storage/uploads/attachment-1-missing.txt'
          }
        ],
        contentAnnotations: []
      };
      const blocked = buildJsonMigrationPlan({ input, storageRootDir: os.tmpdir() });
      assert.equal(blocked.canApply, false);
      assert.equal(blocked.report.errors[0].code, 'ATTACHMENT_FILE_MISSING');
      const allowed = buildJsonMigrationPlan({ input, storageRootDir: os.tmpdir(), allowMissingAttachments: true });
      assert.equal(allowed.canApply, true);
      assert.equal(allowed.report.warnings[0].code, 'ATTACHMENT_FILE_MISSING');
    }
  },
  {
    name: 'JSON migration verifies an attachment file hash before applying metadata',
    async run() {
      const { buildJsonMigrationPlan } = await import('../src/infrastructure/migration/json-to-postgres.ts');
      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-phase1-migration-'));
      try {
        const uploadPath = path.join(tempRoot, 'storage', 'uploads', 'attachment-1-file.txt');
        fs.mkdirSync(path.dirname(uploadPath), { recursive: true });
        fs.writeFileSync(uploadPath, 'abc');
        const result = buildJsonMigrationPlan({
          input: {
            spaces: [{ id: 'space-demo', userId: 'demo', name: 'Default' }],
            folders: [],
            tags: [],
            notes: [{ id: 'note-1', spaceId: 'space-demo', title: 'Note', rawMarkdown: 'body' }],
            attachments: [
              {
                id: 'attachment-1',
                noteId: 'note-1',
                fileName: 'file.txt',
                mimeType: 'text/plain',
                size: 99,
                storagePath: 'storage/uploads/attachment-1-file.txt'
              }
            ],
            contentAnnotations: []
          },
          storageRootDir: tempRoot
        });
        assert.equal(result.canApply, true);
        assert.equal(result.plan.attachments[0].size, 3);
        assert.equal(result.report.attachmentFiles[0].exists, true);
        assert.equal(
          result.report.repairs.some(item => item.code === 'ATTACHMENT_SIZE_REPAIRED'),
          true
        );
      } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'versioned JSON migration wrappers keep strict reference validation',
    async run() {
      const { buildJsonMigrationPlan } = await import('../src/infrastructure/migration/json-to-postgres.ts');
      const result = buildJsonMigrationPlan({
        input: {
          version: 'v1-local-json',
          schemaVersion: 3,
          data: {
            spaces: [{ id: 'space-demo', userId: 'demo', name: 'Default' }],
            folders: [],
            tags: [],
            notes: [
              {
                id: 'note-broken-space',
                spaceId: 'space-missing',
                title: 'Broken',
                rawMarkdown: 'body'
              }
            ],
            attachments: [],
            contentAnnotations: []
          }
        }
      });

      assert.equal(result.canApply, false);
      assert.equal(result.report.errors[0].code, 'STORAGE_SNAPSHOT_INVALID');
    }
  },
  {
    name: 'JSON migration blocks a persisted Note contentHash mismatch',
    async run() {
      const { buildJsonMigrationPlan } = await import('../src/infrastructure/migration/json-to-postgres.ts');
      const result = buildJsonMigrationPlan({
        input: {
          spaces: [{ id: 'space-demo', userId: 'demo', name: 'Default' }],
          folders: [],
          tags: [],
          notes: [
            {
              id: 'note-hash-mismatch',
              spaceId: 'space-demo',
              title: 'Hash mismatch',
              rawMarkdown: 'actual content',
              contentHash: '0'.repeat(64)
            }
          ],
          attachments: [],
          contentAnnotations: []
        }
      });

      assert.equal(result.canApply, false);
      assert.equal(
        result.report.errors.some(item => item.code === 'NOTE_CONTENT_HASH_MISMATCH'),
        true
      );
      assert.equal(
        result.plan.notes[0].contentHash,
        crypto.createHash('sha256').update('actual content').digest('hex')
      );
    }
  },
  {
    name: 'JSON migration blocks insecure HTTP image sources before PostgreSQL apply',
    async run() {
      const { buildJsonMigrationPlan } = await import('../src/infrastructure/migration/json-to-postgres.ts');
      const result = buildJsonMigrationPlan({
        input: {
          spaces: [{ id: 'space-demo', userId: 'demo', name: 'Default' }],
          folders: [],
          tags: [],
          notes: [
            {
              id: 'note-insecure-image',
              spaceId: 'space-demo',
              title: 'Insecure image',
              rawMarkdown: '![diagram](http://example.test/diagram.png)'
            }
          ],
          attachments: [],
          contentAnnotations: []
        }
      });

      assert.equal(result.canApply, false);
      assert.deepEqual(
        result.report.errors.find(error => error.code === 'INSECURE_IMAGE_URL'),
        {
          code: 'INSECURE_IMAGE_URL',
          message: 'Note contains insecure HTTP image sources and must be repaired before migration',
          noteId: 'note-insecure-image',
          count: 1
        }
      );
    }
  },
  {
    name: 'JSON migration can enforce the configured single-owner boundary',
    async run() {
      const { buildJsonMigrationPlan } = await import('../src/infrastructure/migration/json-to-postgres.ts');
      const result = buildJsonMigrationPlan({
        ownerId: 'owner-a',
        input: {
          spaces: [{ id: 'space-b', userId: 'owner-b', name: 'Foreign' }],
          folders: [],
          tags: [],
          notes: [],
          attachments: [],
          contentAnnotations: []
        }
      });

      assert.equal(result.canApply, false);
      assert.equal(
        result.report.errors.some(item => item.code === 'OWNER_BOUNDARY_VIOLATION'),
        true
      );
    }
  },
  {
    name: 'JSON migration preserves the configured owner for an empty knowledge snapshot',
    async run() {
      const { buildJsonMigrationPlan } = await import('../src/infrastructure/migration/json-to-postgres.ts');
      const result = buildJsonMigrationPlan({
        ownerId: 'demo',
        fallbackTimestamp: '2026-07-30T00:00:00.000Z',
        input: {
          spaces: [],
          folders: [],
          tags: [],
          notes: [],
          attachments: [],
          contentAnnotations: []
        }
      });

      assert.equal(result.canApply, true);
      assert.deepEqual(result.plan.users, [
        {
          id: 'demo',
          email: null,
          passwordHash: null,
          nickname: null,
          status: 'active',
          createdAt: '2026-07-30T00:00:00.000Z',
          updatedAt: '2026-07-30T00:00:00.000Z'
        }
      ]);
    }
  },
  {
    name: 'PostgreSQL note repository rejects a lost-update race',
    async run() {
      const { createPostgresNoteRepository } =
        await import('../src/modules/knowledge/infrastructure/postgres/note-repository.ts');
      const existing = {
        id: 'note-race',
        spaceId: 'space-demo',
        folderId: null,
        title: 'Current',
        rawMarkdown: 'current',
        plainText: 'current',
        internalLinks: [],
        contentHash: crypto.createHash('sha256').update('current').digest('hex'),
        status: 'draft',
        sourceType: 'manual',
        favorite: false,
        deletedAt: null,
        createdAt: new Date('2026-07-30T00:00:00.000Z'),
        updatedAt: new Date('2026-07-30T00:01:00.000Z'),
        noteTags: []
      };
      const db = {
        note: {
          async findUnique() {
            return existing;
          },
          async updateMany() {
            return { count: 0 };
          }
        },
        noteTag: {
          async deleteMany() {},
          async createMany() {}
        },
        async $transaction(operation) {
          return operation(this);
        }
      };
      const repository = createPostgresNoteRepository({ db });

      await assert.rejects(
        () =>
          repository.save(
            {
              ...existing,
              createdAt: existing.createdAt.toISOString(),
              updatedAt: '2026-07-30T00:02:00.000Z',
              tagIds: []
            },
            {
              expectedUpdatedAt: '2026-07-30T00:00:00.000Z'
            }
          ),
        error => error.code === 'NOTE_UPDATE_CONFLICT' && error.statusCode === 409
      );
    }
  },
  {
    name: 'PostgreSQL error wrapper preserves domain errors and maps transaction retries',
    async run() {
      const { withPostgresErrors } = await import('../src/infrastructure/postgres-errors.ts');
      const domainError = new Error('domain conflict');
      domainError.code = 'NOTE_HAS_QUESTION_SOURCE';
      domainError.statusCode = 409;
      await assert.rejects(
        () =>
          withPostgresErrors(async () => {
            throw domainError;
          }),
        error => error === domainError
      );

      await assert.rejects(
        () =>
          withPostgresErrors(async () => {
            const retryError = new Error('serialization failure');
            retryError.code = 'P2034';
            throw retryError;
          }),
        error => error.code === 'DATABASE_CONCURRENT_UPDATE' && error.statusCode === 409
      );
    }
  },
  {
    name: 'PostgreSQL recycle-bin cleanup preflights every formal evidence reference before deleting',
    async run() {
      const { createAsyncNoteService } =
        await import('../src/modules/knowledge/application/postgres-async/note-service.js');
      const notes = [
        {
          id: 'note-unreferenced',
          spaceId: 'space-demo',
          deleted: true
        },
        {
          id: 'note-protected',
          spaceId: 'space-demo',
          deleted: true
        }
      ];
      let deleteCalls = 0;
      const service = createAsyncNoteService({
        repository: {
          async list() {
            return notes;
          },
          async deleteWhere() {
            deleteCalls += 1;
            return notes;
          }
        },
        async onBeforePermanentDelete(noteId) {
          if (noteId === 'note-protected') {
            const error = new Error('protected');
            error.code = 'NOTE_HAS_KNOWLEDGE_EVIDENCE';
            error.statusCode = 409;
            throw error;
          }
        }
      });

      await assert.rejects(
        () => service.emptyRecycleBin('space-demo'),
        error => error.code === 'NOTE_HAS_KNOWLEDGE_EVIDENCE' && error.statusCode === 409
      );
      assert.equal(deleteCalls, 0);
    }
  },
  {
    name: 'maintenance gate drains active work and blocks later operations during maintenance',
    async run() {
      const { createMaintenanceGate } = await import('../src/infrastructure/maintenance-gate.ts');
      const gate = createMaintenanceGate();
      const events = [];
      let releaseActive;
      const active = gate.runOperation(async () => {
        events.push('active:start');
        await new Promise(resolve => {
          releaseActive = resolve;
        });
        events.push('active:end');
      });
      await Promise.resolve();
      const maintenance = gate.runMaintenance(async () => {
        events.push('maintenance');
      });
      const later = gate.runOperation(async () => {
        events.push('later');
      });
      await Promise.resolve();
      assert.deepEqual(events, ['active:start']);

      releaseActive();
      await Promise.all([active, maintenance, later]);
      assert.deepEqual(events, ['active:start', 'active:end', 'maintenance', 'later']);
    }
  },
  {
    name: 'maintenance gate serializes multiple maintenance waiters after draining active work',
    async run() {
      const { createMaintenanceGate } = await import('../src/infrastructure/maintenance-gate.ts');
      const gate = createMaintenanceGate();
      const events = [];
      let releaseActive;
      let releaseFirstMaintenance;
      let markFirstMaintenanceStarted;
      const firstMaintenanceStarted = new Promise(resolve => {
        markFirstMaintenanceStarted = resolve;
      });
      const active = gate.runOperation(async () => {
        events.push('active:start');
        await new Promise(resolve => {
          releaseActive = resolve;
        });
        events.push('active:end');
      });
      await Promise.resolve();
      const firstMaintenance = gate.runMaintenance(async () => {
        events.push('maintenance:1:start');
        markFirstMaintenanceStarted();
        await new Promise(resolve => {
          releaseFirstMaintenance = resolve;
        });
        events.push('maintenance:1:end');
      });
      const secondMaintenance = gate.runMaintenance(async () => {
        events.push('maintenance:2');
      });
      const later = gate.runOperation(async () => {
        events.push('later');
      });

      releaseActive();
      await firstMaintenanceStarted;
      await Promise.resolve();
      assert.deepEqual(events, ['active:start', 'active:end', 'maintenance:1:start']);

      releaseFirstMaintenance();
      await Promise.all([active, firstMaintenance, secondMaintenance, later]);
      assert.deepEqual(events, [
        'active:start',
        'active:end',
        'maintenance:1:start',
        'maintenance:1:end',
        'maintenance:2',
        'later'
      ]);
    }
  },
  {
    name: 'PostgreSQL advisory lock separates shared reads from exclusive mutations',
    async run() {
      const { createPostgresAdvisoryLock } = await import('../src/infrastructure/postgres-advisory-lock.ts');
      const lockCalls = [];
      const client = {
        async $transaction(operation, options) {
          assert.equal(options.isolationLevel, 'Serializable');
          return operation({
            async $queryRawUnsafe(sql, namespace, resource) {
              lockCalls.push({ sql, namespace, resource });
            }
          });
        }
      };
      const lock = createPostgresAdvisoryLock(client);

      assert.equal(await lock.runShared(() => 'read'), 'read');
      assert.equal(await lock.runExclusive(() => 'write'), 'write');
      assert.match(lockCalls[0].sql, /pg_advisory_xact_lock_shared/);
      assert.match(lockCalls[1].sql, /pg_advisory_xact_lock\(/);
      assert.match(lockCalls[0].sql, /\$1::integer, \$2::integer/);
      assert.match(lockCalls[1].sql, /\$1::integer, \$2::integer/);
      assert.equal(lockCalls[0].namespace, lockCalls[1].namespace);
      assert.equal(lockCalls[0].resource, lockCalls[1].resource);
    }
  },
  {
    name: 'JSON migration apply holds the exclusive PostgreSQL advisory lock',
    async run() {
      const { applyJsonMigration, buildJsonMigrationPlan } =
        await import('../src/infrastructure/migration/json-to-postgres.ts');
      const prepared = buildJsonMigrationPlan({
        ownerId: 'demo',
        input: {
          spaces: [{ id: 'space-demo', userId: 'demo', name: 'Default' }],
          folders: [],
          tags: [],
          notes: [],
          attachments: [],
          contentAnnotations: []
        }
      });
      const events = [];
      const client = {
        async $transaction(operation, options) {
          assert.equal(options.isolationLevel, 'Serializable');
          return operation({
            async $queryRawUnsafe(sql) {
              events.push(sql);
            },
            user: {
              async createMany({ data }) {
                events.push(`users:${data.length}`);
              }
            },
            knowledgeSpace: {
              async createMany({ data }) {
                events.push(`spaces:${data.length}`);
              }
            },
            tagGroup: {
              async createMany({ data }) {
                events.push(`groups:${data.length}`);
              }
            },
            knowledgeArtifactProvenance: {
              async findMany() {
                return [];
              }
            }
          });
        }
      };

      const report = await applyJsonMigration({
        client,
        plan: prepared.plan,
        report: prepared.report,
        requireEmptyTarget: false
      });
      assert.equal(report.status, 'applied');
      assert.match(events[0], /pg_advisory_xact_lock\(/);
      assert.deepEqual(events.slice(1), ['users:1', 'spaces:1', `groups:${prepared.plan.tagGroups.length}`]);
    }
  },
  {
    name: 'PostgreSQL app context refuses a database containing a foreign owner',
    async run() {
      const { createPostgresAppContext } = await import('../src/postgres-app.factory.js');
      let disconnectCalls = 0;
      const client = {
        user: {
          async upsert() {
            return {};
          }
        },
        knowledgeSpace: {
          async findMany() {
            return [{ id: 'space-owner-b', userId: 'owner-b' }];
          }
        },
        async $connect() {},
        async $disconnect() {
          disconnectCalls += 1;
        }
      };

      await assert.rejects(
        () =>
          createPostgresAppContext({
            client,
            ownerId: 'owner-a'
          }),
        error => error.code === 'OWNER_BOUNDARY_VIOLATION' && error.statusCode === 409
      );
      assert.equal(disconnectCalls, 1);
    }
  },
  {
    name: 'single-owner boundary rejects mixed local knowledge spaces',
    async run() {
      const { resolveSingleOwnerId } = await import('../src/infrastructure/owner-boundary.ts');

      assert.throws(
        () =>
          resolveSingleOwnerId({
            spaces: [
              { id: 'space-a', userId: 'owner-a' },
              { id: 'space-b', userId: 'owner-b' }
            ]
          }),
        error => error.code === 'OWNER_BOUNDARY_VIOLATION'
      );
    }
  },
  {
    name: 'JSON migration blocks absolute, traversal and symbolic-link attachment paths even when missing files are allowed',
    async run() {
      const { buildJsonMigrationPlan } = await import('../src/infrastructure/migration/json-to-postgres.ts');
      const tempContainer = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-phase1-path-safety-'));
      const storageRootDir = path.join(tempContainer, 'workspace');
      const uploadsDir = path.join(storageRootDir, 'storage', 'uploads');
      const outsidePath = path.join(tempContainer, 'outside-secret.txt');
      fs.mkdirSync(uploadsDir, { recursive: true });
      fs.writeFileSync(outsidePath, 'migration must not read this');

      const buildInput = attachment => ({
        spaces: [{ id: 'space-demo', userId: 'demo', name: 'Default' }],
        folders: [],
        tags: [],
        notes: [
          {
            id: 'note-1',
            spaceId: 'space-demo',
            title: 'Note',
            rawMarkdown: 'body'
          }
        ],
        attachments: [
          {
            id: 'attachment-unsafe',
            noteId: 'note-1',
            fileName: 'secret.txt',
            mimeType: 'text/plain',
            size: 0,
            ...attachment
          }
        ],
        contentAnnotations: []
      });

      try {
        const absolute = buildJsonMigrationPlan({
          input: buildInput({ storagePath: outsidePath }),
          storageRootDir,
          allowMissingAttachments: true
        });
        assert.equal(absolute.canApply, false);
        assert.equal(
          absolute.report.errors.some(item => item.code === 'ATTACHMENT_PATH_UNSAFE'),
          true
        );

        const traversal = buildJsonMigrationPlan({
          input: buildInput({ storagePath: '../outside-secret.txt' }),
          storageRootDir,
          allowMissingAttachments: true
        });
        assert.equal(traversal.canApply, false);
        assert.equal(
          traversal.report.errors.some(item => item.code === 'ATTACHMENT_PATH_UNSAFE'),
          true
        );

        const symlinkPath = path.join(uploadsDir, 'attachment-unsafe-secret.txt');
        try {
          fs.symlinkSync(outsidePath, symlinkPath);
        } catch (error) {
          if (error.code === 'EPERM' || error.code === 'EACCES') {
            return;
          }
          throw error;
        }
        const symlink = buildJsonMigrationPlan({
          input: buildInput({
            storagePath: 'storage/uploads/attachment-unsafe-secret.txt'
          }),
          storageRootDir,
          allowMissingAttachments: true
        });
        assert.equal(symlink.canApply, false);
        assert.equal(
          symlink.report.errors.some(item => item.code === 'ATTACHMENT_PATH_SYMLINK'),
          true
        );
        assert.equal(fs.readFileSync(outsidePath, 'utf8'), 'migration must not read this');
      } finally {
        fs.rmSync(tempContainer, { recursive: true, force: true });
      }
    }
  }
];
