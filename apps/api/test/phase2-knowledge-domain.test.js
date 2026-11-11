import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { ContentAnnotation } from '../src/modules/knowledge/domain/content-annotation.ts';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function asAsyncRepository(repository) {
  return new Proxy(
    { supportsAsync: true },
    {
      get(target, property) {
        if (Object.hasOwn(target, property)) return target[property];
        const value = repository[property];
        return typeof value === 'function' ? async (...args) => value.apply(repository, args) : value;
      }
    }
  );
}

export const phase2KnowledgeDomainTests = [
  {
    name: '版本历史分页只返回摘要，游标稳定且当前正文按内容匹配',
    async run() {
      const { createInMemoryNoteVersionRepository } =
        await import('../src/modules/knowledge/infrastructure/note-version-repository.ts');
      const { createNoteVersionService, createAsyncNoteVersionService } =
        await import('../src/modules/knowledge/application/note-version-service.ts');
      const records = ['a', 'b', 'c'].map(id => ({
        id,
        noteId: 'note-page',
        content: id,
        contentHash: hash(id),
        createdAt: '2026-09-20T01:02:03.000Z',
        createdBy: 'user'
      }));
      const repository = createInMemoryNoteVersionRepository({ records });
      for (const service of [
        createNoteVersionService({ repository }),
        createAsyncNoteVersionService({ repository: asAsyncRepository(repository) })
      ]) {
        const current = { id: 'note-page', rawMarkdown: 'a' };
        const first = await service.listVersionPage(current, { limit: '2' });
        assert.deepEqual(
          first.items.map(item => item.id),
          ['c', 'b']
        );
        assert.equal(first.total, 3);
        assert.equal(first.currentVersionId, 'a');
        assert(first.items.every(item => !Object.hasOwn(item, 'content')));
        repository.save({
          id: 'new',
          noteId: 'note-page',
          content: 'new',
          contentHash: hash('new'),
          createdAt: '2026-09-21T01:02:03.000Z',
          createdBy: 'user'
        });
        const second = await service.listVersionPage(current, { limit: 2, cursor: first.nextCursor });
        assert.deepEqual(
          second.items.map(item => item.id),
          ['a']
        );
        assert.equal(second.nextCursor, null);
        assert.throws(() => service.listVersionPage(current, { limit: 101 }), /1 到 100/);
        assert.throws(() => service.listVersionPage(current, { cursor: 'invalid' }), /游标无效/);
        await assert.rejects(async () => service.getVersion('a', 'other-note'), /not found/);
        records.splice(
          records.findIndex(item => item.id === 'new'),
          1
        );
      }
    }
  },
  {
    name: 'PostgreSQL 版本分页在数据库层限制条数且不读取历史正文',
    async run() {
      const { createPostgresNoteVersionRepository } =
        await import('../src/modules/knowledge/infrastructure/postgres/note-version-repository.ts');
      let query;
      const repository = createPostgresNoteVersionRepository({
        db: {
          noteVersion: {
            async findMany(input) {
              query = input;
              return [
                {
                  id: 'v',
                  noteId: 'note',
                  contentHash: hash('正文'),
                  createdAt: new Date('2026-09-20T01:00:00Z'),
                  createdBy: 'user'
                }
              ];
            },
            async count() {
              return 1;
            },
            async findUnique(input) {
              assert.deepEqual(input.select, { id: true });
              return { id: 'v' };
            }
          }
        }
      });
      const result = await repository.listPage({
        noteId: 'note',
        limit: 20,
        currentContentHash: hash('正文'),
        after: { id: 'cursor', createdAt: '2026-09-21T01:00:00Z' }
      });
      assert.equal(query.take, 21);
      assert(!Object.hasOwn(query.select, 'content'));
      assert.equal(query.where.OR.length, 2);
      assert.equal(result.items[0].createdAt, '2026-09-20T01:00:00.000Z');
      assert.equal(result.currentVersionId, 'v');
    }
  },

  {
    name: 'JSON 迁移会保留 NoteVersion、KnowledgeItem 与 KnowledgeEvidence 关系',
    async run() {
      const { buildJsonMigrationPlan } = await import('../src/infrastructure/migration/json-to-postgres.ts');
      const content = '迁移来源';
      const versionId = 'version-phase2-migration';
      const itemId = 'item-phase2-migration';
      const result = buildJsonMigrationPlan({
        input: {
          spaces: [{ id: 'space-phase2-migration', userId: 'demo', name: '迁移空间' }],
          folders: [],
          tags: [],
          notes: [
            { id: 'note-phase2-migration', spaceId: 'space-phase2-migration', title: '迁移笔记', rawMarkdown: content }
          ],
          noteVersions: [
            { id: versionId, noteId: 'note-phase2-migration', content, contentHash: hash(content), createdBy: 'user' }
          ],
          knowledgeItems: [
            { id: itemId, title: '迁移知识', canonicalStatement: '迁移后仍可回溯', sourceMode: 'selection' }
          ],
          knowledgeEvidence: [
            {
              id: 'evidence-phase2-migration',
              knowledgeItemId: itemId,
              sourceType: 'noteVersion',
              noteVersionId: versionId
            }
          ],
          attachments: [],
          contentAnnotations: []
        }
      });

      assert.equal(result.canApply, true);
      assert.equal(result.plan.noteVersions[0].id, versionId);
      assert.equal(result.plan.knowledgeItems[0].reviewStatus, 'candidate');
      assert.equal(result.plan.knowledgeEvidence[0].noteId, 'note-phase2-migration');
    }
  },
  {
    name: 'Note 保存会创建不可变且按内容哈希去重的 NoteVersion',
    async run() {
      const { createKnowledgeModule } = await import('../src/modules/knowledge/index.js');
      const knowledge = createKnowledgeModule();
      const note = knowledge.noteService.createNote({
        id: 'note-phase2-version',
        spaceId: 'space-demo',
        title: '版本测试',
        rawMarkdown: '# 第一版'
      });

      let versions = knowledge.noteVersionService.listVersions({ noteId: note.id });
      assert.equal(versions.length, 1);
      assert.equal(versions[0].contentHash, hash('# 第一版'));

      knowledge.noteService.updateNote(note.id, { title: '标题更新' });
      assert.equal(knowledge.noteVersionService.listVersions({ noteId: note.id }).length, 1);

      knowledge.noteService.updateNote(note.id, { rawMarkdown: '# 第二版' });
      versions = knowledge.noteVersionService.listVersions({ noteId: note.id });
      assert.equal(versions.length, 2);

      knowledge.noteService.updateNote(note.id, { rawMarkdown: '# 第一版' });
      assert.equal(knowledge.noteVersionService.listVersions({ noteId: note.id }).length, 2);
    }
  },
  {
    name: 'KnowledgeItem 只有满足来源与内容门槛后才能确认',
    async run() {
      const { createKnowledgeModule } = await import('../src/modules/knowledge/index.js');
      const knowledge = createKnowledgeModule();
      const note = knowledge.noteService.createNote({
        id: 'note-phase2-evidence',
        spaceId: 'space-demo',
        title: '证据测试',
        rawMarkdown: '可验证的知识内容'
      });
      const version = knowledge.noteVersionService.listVersions({ noteId: note.id })[0];

      assert.throws(
        () => knowledge.knowledgeItemService.createCandidate({ sourceMode: 'selection' }),
        error => error.code === 'KNOWLEDGE_EVIDENCE_REQUIRED'
      );

      const created = knowledge.knowledgeItemService.createCandidate({
        title: '证据约束',
        canonicalStatement: '知识单元必须可以回溯到来源',
        sourceMode: 'selection',
        evidence: [
          {
            sourceType: 'noteVersion',
            noteVersionId: version.id,
            quoteText: '可验证的知识内容'
          }
        ]
      });
      assert.equal(created.item.reviewStatus, 'candidate');
      assert.equal(created.evidence[0].noteId, note.id);
      assert.equal(knowledge.knowledgeItemService.listItems({ noteId: note.id })[0].evidenceStatus, 'valid');
      assert.equal(
        knowledge.knowledgeItemService.listItems({ noteId: note.id })[0].evidenceSummary[0].noteVersionId,
        version.id
      );
      assert.equal(knowledge.knowledgeItemService.confirmItem(created.item.id).reviewStatus, 'confirmed');

      const changed = knowledge.knowledgeItemService.updateItem(created.item.id, { title: '证据约束（修订）' });
      assert.equal(changed.reviewStatus, 'needsRevision');
    }
  },
  {
    name: '笔记删除会使知识证据失效并阻止带正式证据的永久删除',
    async run() {
      const { createKnowledgeModule } = await import('../src/modules/knowledge/index.js');
      const knowledge = createKnowledgeModule();
      const note = knowledge.noteService.createNote({
        id: 'note-phase2-delete',
        spaceId: 'space-demo',
        title: '删除保护',
        rawMarkdown: '正式来源'
      });
      const version = knowledge.noteVersionService.listVersions({ noteId: note.id })[0];
      const created = knowledge.knowledgeItemService.createCandidate({
        title: '来源保护',
        canonicalStatement: '来源删除后不能继续作为有效证据',
        sourceMode: 'selection',
        evidence: [{ sourceType: 'noteVersion', noteVersionId: version.id }]
      });

      knowledge.noteService.deleteNote(note.id);
      assert.equal(knowledge.knowledgeItemService.listEvidence(created.item.id)[0].status, 'invalid');
      assert.throws(
        () => knowledge.noteService.permanentlyDeleteNote(note.id),
        error => error.code === 'NOTE_HAS_KNOWLEDGE_EVIDENCE'
      );
    }
  },
  {
    name: '手工来源知识单元可以在没有笔记证据时确认',
    async run() {
      const { createKnowledgeModule } = await import('../src/modules/knowledge/index.js');
      const knowledge = createKnowledgeModule();
      const created = knowledge.knowledgeItemService.createCandidate({
        title: '手工知识',
        canonicalStatement: '这是用户明确录入的知识单元',
        sourceMode: 'manual'
      });

      assert.equal(knowledge.knowledgeItemService.confirmItem(created.item.id).reviewStatus, 'confirmed');
    }
  },
  {
    name: 'KnowledgeItem create 拒绝重复客户端 ID 且不会覆盖原资产',
    async run() {
      const { createKnowledgeModule } = await import('../src/modules/knowledge/index.js');
      const knowledge = createKnowledgeModule();
      knowledge.knowledgeItemService.createCandidate({
        id: 'phase32-duplicate-item',
        title: '原始知识单元',
        canonicalStatement: '原始内容',
        sourceMode: 'manual'
      });

      assert.throws(
        () =>
          knowledge.knowledgeItemService.createCandidate({
            id: 'phase32-duplicate-item',
            title: '覆盖内容',
            canonicalStatement: '不应写入',
            sourceMode: 'manual'
          }),
        error => error.code === 'KNOWLEDGE_ITEM_ID_CONFLICT' && error.statusCode === 409
      );
      assert.equal(knowledge.knowledgeItemService.getItem('phase32-duplicate-item').title, '原始知识单元');
    }
  },
  {
    name: 'Note 同内容保存不会把正式 KnowledgeEvidence 标记为 stale',
    async run() {
      const { createKnowledgeModule } = await import('../src/modules/knowledge/index.js');
      const knowledge = createKnowledgeModule();
      const note = knowledge.noteService.createNote({
        id: 'phase32-note-noop',
        spaceId: 'phase32-space-noop',
        title: '幂等保存',
        rawMarkdown: '内容保持不变'
      });
      const version = knowledge.noteVersionService.listVersions({ noteId: note.id })[0];
      const created = knowledge.knowledgeItemService.createCandidate({
        id: 'phase32-item-noop',
        title: '幂等来源',
        canonicalStatement: '同内容保存不应使来源失效',
        sourceMode: 'selection',
        evidence: [
          {
            id: 'phase32-evidence-noop',
            sourceType: 'noteVersion',
            noteVersionId: version.id
          }
        ]
      });
      knowledge.knowledgeItemService.confirmItem(created.item.id);

      knowledge.noteService.updateNote(note.id, {
        rawMarkdown: '内容保持不变'
      });

      assert.equal(knowledge.knowledgeItemService.listEvidence(created.item.id)[0].status, 'valid');
      assert.equal(knowledge.knowledgeItemService.getItem(created.item.id).reviewStatus, 'confirmed');
      assert.equal(knowledge.noteVersionService.listVersions({ noteId: note.id }).length, 1);
    }
  },
  {
    name: 'KnowledgeEvidence 将来源定位健康与阅读标记生命周期分离',
    async run() {
      const { createKnowledgeModule } = await import('../src/modules/knowledge/index.js');
      const knowledge = createKnowledgeModule();
      const note = knowledge.noteService.createNote({
        id: 'phase32-evidence-health-note',
        spaceId: 'phase32-evidence-health-space',
        title: '证据健康',
        rawMarkdown: '第一版内容'
      });
      const oldVersion = knowledge.noteVersionService.listVersions({
        noteId: note.id
      })[0];
      knowledge.noteService.updateNote(note.id, {
        rawMarkdown: '第二版内容'
      });
      const currentVersion = knowledge.noteVersionService.listVersions({
        noteId: note.id
      })[0];

      const staleItem = knowledge.knowledgeItemService.createCandidate({
        id: 'phase32-evidence-stale-item',
        title: '旧版本证据',
        canonicalStatement: '旧版本不能作为当前有效证据',
        sourceMode: 'selection',
        evidence: [
          {
            id: 'phase32-evidence-stale',
            sourceType: 'noteVersion',
            noteVersionId: oldVersion.id
          }
        ]
      });
      assert.equal(staleItem.evidence[0].status, 'stale');
      assert.throws(
        () => knowledge.knowledgeItemService.confirmItem(staleItem.item.id),
        error => error.code === 'KNOWLEDGE_ITEM_SOURCE_REQUIRED'
      );

      // 库里残留的旧格式行（v1）仍可归档；归档后的重点不能作为有效证据。
      const annotation = knowledge.repositories.contentAnnotationRepository.save(
        new ContentAnnotation({
          id: 'phase32-evidence-annotation',
          spaceId: note.spaceId,
          noteId: note.id,
          noteVersionId: currentVersion.id,
          quoteText: '第二版',
          fromPosition: 0,
          toPosition: 3,
          anchorFingerprint: 'phase32-evidence-annotation',
          noteContentHash: hash('第二版内容'),
          idempotencyKey: 'phase32-evidence-annotation',
          schemaVersion: 1
        })
      );
      knowledge.contentAnnotationService.archiveAnnotation(annotation.id);
      assert.throws(
        () =>
          knowledge.knowledgeItemService.createCandidate({
            id: 'phase32-evidence-annotation-item',
            title: '归档标注证据',
            canonicalStatement: '归档标注不能作为有效证据',
            sourceMode: 'annotation',
            evidence: [
              {
                id: 'phase32-evidence-annotation-invalid',
                sourceType: 'annotation',
                annotationId: annotation.id
              }
            ]
          }),
        error => error.code === 'ANNOTATION_NOT_ACTIVE'
      );

      knowledge.noteService.deleteNote(note.id);
      const deletedNoteItem = knowledge.knowledgeItemService.createCandidate({
        id: 'phase32-evidence-deleted-note-item',
        title: '删除笔记证据',
        canonicalStatement: '删除笔记不能生成有效证据',
        sourceMode: 'selection',
        evidence: [
          {
            id: 'phase32-evidence-deleted-note',
            sourceType: 'noteVersion',
            noteVersionId: currentVersion.id
          }
        ]
      });
      assert.equal(deletedNoteItem.evidence[0].status, 'invalid');
    }
  },
  {
    name: 'Phase2 PostgreSQL async KnowledgeEvidence 保持相同健康推导与重复 ID 语义',
    async run() {
      const { createAsyncKnowledgeItemService } =
        await import('../src/modules/knowledge/application/postgres-async/knowledge-domain-service.js');
      const { createInMemoryKnowledgeItemRepository } =
        await import('../src/modules/knowledge/infrastructure/knowledge-item-repository.js');
      const { createInMemoryKnowledgeEvidenceRepository } =
        await import('../src/modules/knowledge/infrastructure/knowledge-evidence-repository.js');
      const notes = [
        {
          id: 'phase32-async-evidence-note',
          rawMarkdown: '第二版',
          deleted: false
        }
      ];
      const versions = new Map([
        [
          'phase32-async-old-version',
          {
            id: 'phase32-async-old-version',
            noteId: notes[0].id,
            content: '第一版',
            contentHash: hash('第一版')
          }
        ],
        [
          'phase32-async-current-version',
          {
            id: 'phase32-async-current-version',
            noteId: notes[0].id,
            content: '第二版',
            contentHash: hash('第二版')
          }
        ]
      ]);
      const service = createAsyncKnowledgeItemService({
        repository: asAsyncRepository(createInMemoryKnowledgeItemRepository()),
        evidenceRepository: asAsyncRepository(createInMemoryKnowledgeEvidenceRepository()),
        noteVersionRepository: {
          async findById(id) {
            return versions.get(id) ?? null;
          }
        },
        annotationRepository: {
          async findById() {
            return null;
          }
        },
        noteRepository: {
          async findById(id) {
            return notes.find(note => note.id === id) ?? null;
          }
        }
      });

      const stale = await service.createCandidate({
        id: 'phase32-async-evidence-item',
        title: '异步旧版本',
        canonicalStatement: '异步路径也不能信任旧版本',
        sourceMode: 'selection',
        evidence: [
          {
            id: 'phase32-async-evidence-stale',
            sourceType: 'noteVersion',
            noteVersionId: 'phase32-async-old-version'
          }
        ]
      });
      assert.equal(stale.evidence[0].status, 'stale');
      await assert.rejects(
        () => service.confirmItem(stale.item.id),
        error => error.code === 'KNOWLEDGE_ITEM_SOURCE_REQUIRED'
      );
      await assert.rejects(
        () =>
          service.createCandidate({
            id: stale.item.id,
            title: '不应覆盖',
            canonicalStatement: '不应覆盖',
            sourceMode: 'manual'
          }),
        error => error.code === 'KNOWLEDGE_ITEM_ID_CONFLICT' && error.statusCode === 409
      );

      notes[0].deleted = true;
      const invalid = await service.createCandidate({
        id: 'phase32-async-deleted-note-item',
        title: '异步删除笔记',
        canonicalStatement: '删除笔记不得生成有效证据',
        sourceMode: 'selection',
        evidence: [
          {
            id: 'phase32-async-evidence-invalid',
            sourceType: 'noteVersion',
            noteVersionId: 'phase32-async-current-version'
          }
        ]
      });
      assert.equal(invalid.evidence[0].status, 'invalid');
    }
  },
  {
    name: 'Phase2 local snapshot 拒绝伪造的 NoteVersion contentHash',
    async run() {
      const { LOCAL_DATA_SCHEMA_VERSION, LOCAL_SNAPSHOT_VERSION, createEmptyLocalState, validateLocalSnapshot } =
        await import('../src/infrastructure/local-data-schema.js');
      const state = createEmptyLocalState();
      state.spaces.push({
        id: 'phase32-hash-space',
        userId: 'phase32-user',
        name: '哈希校验'
      });
      state.notes.push({
        id: 'phase32-hash-note',
        spaceId: 'phase32-hash-space',
        title: '哈希来源',
        rawMarkdown: '真实内容'
      });
      state.noteVersions.push({
        id: 'phase32-hash-version',
        noteId: 'phase32-hash-note',
        content: '真实内容',
        contentHash: hash('伪造内容'),
        createdBy: 'user'
      });

      assert.throws(
        () =>
          validateLocalSnapshot({
            version: LOCAL_SNAPSHOT_VERSION,
            schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
            data: state
          }),
        error => error.code === 'STORAGE_SNAPSHOT_INVALID' && error.message.includes('contentHash does not match')
      );
    }
  }
];
