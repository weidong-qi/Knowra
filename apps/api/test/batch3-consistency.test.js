import assert from 'node:assert/strict';
import { createKnowledgeModule } from '../src/modules/knowledge/index.js';
import { createAsyncNoteService } from '../src/modules/knowledge/application/postgres-async/note-service.js';
import { createAsyncSearchService } from '../src/modules/knowledge/application/postgres-async/search-service.js';
import { createAsyncKnowledgeSpaceService } from '../src/modules/knowledge/application/postgres-async/space-service.js';
import { createPostgresTagGroupRepository } from '../src/modules/knowledge/infrastructure/postgres/tag-group-repository.ts';
import { buildNoteWhere } from '../src/modules/knowledge/infrastructure/postgres/repository-utils.js';

export const batch3ConsistencyTests = [
  {
    name: 'recycle-bin restore keeps sibling names unique and repeated restore is idempotent',
    async run() {
      const module = createKnowledgeModule();
      module.noteService.createNote({
        id: 'deleted-note',
        spaceId: 'space',
        folderId: null,
        title: '同名资料',
        rawMarkdown: 'old'
      });
      module.noteService.deleteNote('deleted-note');
      module.noteService.createNote({
        id: 'active-note',
        spaceId: 'space',
        folderId: null,
        title: '同名资料',
        rawMarkdown: 'new'
      });
      assert.throws(
        () => module.noteService.restoreNote('deleted-note'),
        error => error.code === 'SIBLING_NAME_CONFLICT' && error.statusCode === 409
      );
      assert.equal(module.noteService.getNote('deleted-note', { includeDeleted: true }).deleted, true);

      module.noteService.createNote({
        id: 'folder-note',
        spaceId: 'space',
        folderId: null,
        title: '目录冲突',
        rawMarkdown: ''
      });
      module.noteService.deleteNote('folder-note');
      module.folderService.createFolder({ id: 'folder', spaceId: 'space', parentId: null, name: '目录冲突' });
      assert.throws(
        () => module.noteService.restoreNote('folder-note'),
        error => error.code === 'SIBLING_NAME_CONFLICT'
      );

      module.noteService.createNote({
        id: 'idempotent',
        spaceId: 'space',
        folderId: null,
        title: '可恢复',
        rawMarkdown: ''
      });
      module.noteService.deleteNote('idempotent');
      const restored = module.noteService.restoreNote('idempotent');
      assert.strictEqual(module.noteService.restoreNote('idempotent'), restored);
    }
  },
  {
    name: 'PostgreSQL-style restore validates sibling names before changing deleted state',
    async run() {
      const records = [note('deleted', '冲突名称', true), note('active', '冲突名称', false)];
      const repository = asyncNoteRepository(records);
      const service = createAsyncNoteService({
        repository,
        validateSiblingNameConflict: async ({ title, currentNoteId }) => {
          if (records.some(item => !item.deleted && item.id !== currentNoteId && item.title === title)) {
            const error = new Error('conflict');
            error.code = 'SIBLING_NAME_CONFLICT';
            error.statusCode = 409;
            throw error;
          }
        },
        runTransaction: operation => operation({ noteRepository: repository })
      });
      await assert.rejects(service.restoreNote('deleted'), { code: 'SIBLING_NAME_CONFLICT' });
      assert.equal(records.find(item => item.id === 'deleted').deleted, true);
    }
  },
  {
    name: 'tag group creation is create-only and PostgreSQL repository never upserts',
    async run() {
      const module = createKnowledgeModule();
      module.tagGroupService.createTagGroup({
        id: 'group',
        spaceId: 'space',
        name: '原分组',
        selectionMode: 'multiple'
      });
      assert.throws(
        () =>
          module.tagGroupService.createTagGroup({
            id: 'group',
            spaceId: 'space',
            name: '覆盖分组',
            selectionMode: 'single'
          }),
        error => error.code === 'TAG_GROUP_ID_CONFLICT' && error.statusCode === 409
      );
      assert.equal(module.tagGroupService.listTagGroups()[0].name, '原分组');
      assert.equal(module.tagGroupService.listTagGroups()[0].selectionMode, 'multiple');

      let createCalls = 0;
      const repository = createPostgresTagGroupRepository({
        db: {
          tagGroup: {
            async create({ data }) {
              createCalls += 1;
              return data;
            },
            async upsert() {
              throw new Error('create must not upsert');
            }
          }
        }
      });
      await repository.create({
        id: 'pg-group',
        spaceId: 'space',
        code: null,
        name: 'PG',
        selectionMode: 'multiple',
        isSystem: false,
        sortOrder: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      assert.equal(createCalls, 1);
    }
  },
  {
    name: 'text search preserves all and any multi-tag filters for both repositories',
    async run() {
      const module = createKnowledgeModule();
      module.tagService.createTag({ id: 'a', spaceId: 'space', name: 'A' });
      module.tagService.createTag({ id: 'b', spaceId: 'space', name: 'B' });
      module.noteService.createNote({
        id: 'both',
        spaceId: 'space',
        title: '共同关键词 双标签',
        rawMarkdown: '',
        tagIds: ['a', 'b']
      });
      module.noteService.createNote({
        id: 'only-a',
        spaceId: 'space',
        title: '共同关键词 标签 A',
        rawMarkdown: '',
        tagIds: ['a']
      });
      module.noteService.createNote({
        id: 'only-b',
        spaceId: 'space',
        title: '共同关键词 标签 B',
        rawMarkdown: '',
        tagIds: ['b']
      });
      module.noteService.createNote({
        id: 'favorite-deleted',
        spaceId: 'space',
        title: '共同关键词 已删除',
        rawMarkdown: '',
        tagIds: ['a', 'b'],
        favorite: true
      });
      module.noteService.deleteNote('favorite-deleted');
      assert.deepEqual(
        module.searchService
          .searchNotes({ query: '关键词', spaceId: 'space', tagIds: 'a,b', match: 'all' })
          .map(item => item.id),
        ['both']
      );
      assert.deepEqual(
        new Set(
          module.searchService
            .searchNotes({ query: '关键词', spaceId: 'space', tagIds: 'a,b', match: 'any' })
            .map(item => item.id)
        ),
        new Set(['both', 'only-a', 'only-b'])
      );
      assert.deepEqual(buildNoteWhere({ tagIds: 'a,b', match: 'all' }).AND, [
        { noteTags: { some: { tagId: 'a' } } },
        { noteTags: { some: { tagId: 'b' } } }
      ]);
      assert.deepEqual(buildNoteWhere({ tagIds: ['a', 'b'], tagMatch: 'any' }).noteTags, {
        some: { tagId: { in: ['a', 'b'] } }
      });
      assert.deepEqual(
        module.searchService
          .searchNotes({ query: '关键词', spaceId: 'space', tagIds: ['a', 'b'], tagMatch: 'all', deletedOnly: true })
          .map(item => item.id),
        ['favorite-deleted']
      );
      assert.deepEqual(
        module.searchService
          .searchNotes({
            query: '关键词',
            spaceId: 'space',
            tagIds: ['a', 'b'],
            tagMatch: 'any',
            sortBy: 'title',
            order: 'asc',
            offset: 1,
            limit: 1
          })
          .map(item => item.id),
        ['only-a']
      );
      assert.deepEqual(module.searchService.searchNotes({ query: '   ', spaceId: 'space', tagIds: ['a'] }), []);

      const forwarded = [];
      const asyncSearch = createAsyncSearchService({
        listNotes: async options => {
          forwarded.push(options);
          return [note('pg-both', '共同关键词 PG', false), note('pg-second', '共同关键词 第二条', false)];
        }
      });
      assert.deepEqual(
        (
          await asyncSearch.searchNotes({
            query: '关键词',
            spaceId: 'space',
            tagIds: ['a', 'b'],
            match: 'any',
            favoriteOnly: true,
            offset: 1,
            limit: 1
          })
        ).map(item => item.id),
        ['pg-second']
      );
      assert.deepEqual(forwarded, [
        {
          spaceId: 'space',
          folderId: null,
          tagId: null,
          tagIds: ['a', 'b'],
          tagMatch: 'any',
          sortBy: undefined,
          order: undefined,
          includeDeleted: undefined,
          deletedOnly: undefined,
          favoriteOnly: true
        }
      ]);
    }
  },
  {
    name: 'default space creates four system groups atomically and idempotently',
    async run() {
      const localSpaces = new Map();
      const localGroups = new Map();
      let failLocalGroup = true;
      const localSpaceRepository = syncMapRepository(localSpaces);
      const localTagGroupRepository = syncMapRepository(localGroups, () => {
        if (failLocalGroup && localGroups.size === 1) throw new Error('injected local group failure');
      });
      const localModule = createKnowledgeModule({
        knowledgeSpaceRepository: localSpaceRepository,
        tagGroupRepository: localTagGroupRepository,
        runTransaction(operation) {
          const previousSpaces = new Map(localSpaces);
          const previousGroups = new Map(localGroups);
          try {
            return operation();
          } catch (error) {
            replaceMap(localSpaces, previousSpaces);
            replaceMap(localGroups, previousGroups);
            throw error;
          }
        }
      });
      assert.throws(
        () => localModule.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'local-owner' }),
        /injected local group failure/
      );
      assert.equal(localSpaces.size, 0);
      assert.equal(localGroups.size, 0);
      failLocalGroup = false;
      localModule.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'local-owner' });
      localModule.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'local-owner' });
      assert.equal(localSpaces.size, 1);
      assert.equal(localGroups.size, 4);

      const spaces = new Map();
      const groups = new Map();
      let failGroup = true;
      const spaceRepository = asyncMapRepository(spaces);
      const tagGroupRepository = asyncMapRepository(groups, () => {
        if (failGroup && groups.size === 1) throw new Error('injected group failure');
      });
      const runTransaction = async operation => {
        const previousSpaces = new Map(spaces);
        const previousGroups = new Map(groups);
        try {
          return await operation({ knowledgeSpaceRepository: spaceRepository, tagGroupRepository });
        } catch (error) {
          replaceMap(spaces, previousSpaces);
          replaceMap(groups, previousGroups);
          throw error;
        }
      };
      const service = createAsyncKnowledgeSpaceService({
        repository: spaceRepository,
        tagGroupRepository,
        runTransaction
      });
      await assert.rejects(service.createDefaultKnowledgeSpace({ userId: 'owner' }), /injected group failure/);
      assert.equal(spaces.size, 0);
      assert.equal(groups.size, 0);
      failGroup = false;
      const space = await service.createDefaultKnowledgeSpace({ userId: 'owner' });
      assert.equal(space.id, 'space-owner');
      assert.equal(groups.size, 4);
      assert.deepEqual(
        [...groups.values()].map(group => group.code),
        ['ordinary', 'mastery', 'importance', 'purpose']
      );
      await service.createDefaultKnowledgeSpace({ userId: 'owner' });
      assert.equal(groups.size, 4);
    }
  }
];

function note(id, title, deleted) {
  const timestamp = new Date().toISOString();
  return {
    id,
    spaceId: 'space',
    folderId: null,
    title,
    rawMarkdown: '',
    plainText: '',
    internalLinks: [],
    tagIds: [],
    favorite: false,
    deleted,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function asyncNoteRepository(records) {
  return {
    async findById(id) {
      return records.find(item => item.id === id) ?? null;
    },
    async save(value) {
      const index = records.findIndex(item => item.id === value.id);
      if (index < 0) records.push(value);
      else records[index] = value;
      return value;
    },
    async list() {
      return [...records];
    },
    supportsAsync: true
  };
}

function asyncMapRepository(records, beforeCreate = null) {
  return {
    async findById(id) {
      return records.get(id) ?? null;
    },
    async save(value) {
      records.set(value.id, value);
      return value;
    },
    async create(value) {
      beforeCreate?.(value);
      records.set(value.id, value);
      return value;
    },
    async list() {
      return [...records.values()];
    },
    supportsAsync: true
  };
}

function syncMapRepository(records, beforeCreate = null) {
  return {
    findById(id) {
      return records.get(id) ?? null;
    },
    save(value) {
      records.set(value.id, value);
      return value;
    },
    create(value) {
      beforeCreate?.(value);
      records.set(value.id, value);
      return value;
    },
    list() {
      return [...records.values()];
    }
  };
}

function replaceMap(target, source) {
  target.clear();
  for (const [key, value] of source) target.set(key, value);
}
