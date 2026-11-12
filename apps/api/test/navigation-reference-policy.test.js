import assert from 'node:assert/strict';
import { createNavigationReferencePolicy } from '../src/modules/knowledge/application/navigation-reference-policy.ts';
import { createAsyncNavigationReferencePolicy } from '../src/modules/knowledge/application/postgres-async/navigation-reference-policy.ts';
import { createKnowledgeModule } from '../src/modules/knowledge/index.ts';
import { createPostgresKnowledgeModule } from '../src/modules/knowledge/postgres-async-module.ts';

function fixture(asyncMode = false, enforceReferences = true) {
  const records = {
    space: [{ id: 's' }],
    folder: [
      { id: 'f', spaceId: 's' },
      { id: 'foreign', spaceId: 'other' }
    ],
    tag: [
      { id: 'a', spaceId: 's', groupId: 'single' },
      { id: 'b', spaceId: 's', groupId: 'single' },
      { id: 'c', spaceId: 's', groupId: 'multi' },
      { id: 'foreign', spaceId: 'other' }
    ],
    group: [
      { id: 'single', spaceId: 's', selectionMode: 'single' },
      { id: 'multi', spaceId: 's', selectionMode: 'multiple' },
      { id: 'foreign', spaceId: 'other' }
    ]
  };
  Object.values(records).forEach(items => {
    items.forEach(Object.freeze);
    Object.freeze(items);
  });
  const calls = [];
  const read = (name, arg, operation) => {
    calls.push([name, arg]);
    if (!asyncMode) return operation();
    return Promise.resolve().then(() => {
      calls.push([`${name}:resolved`]);
      return operation();
    });
  };
  const repository = (name, items) => ({
    supportsAsync: asyncMode,
    findById: id => read(`${name}.findById`, id, () => items.find(item => item.id === id)),
    findByIds: ids => read(`${name}.findByIds`, [...ids], () => items.filter(item => ids.includes(item.id)))
  });
  const repositories = {
    knowledgeSpaceRepository: repository('space', records.space),
    folderRepository: repository('folder', records.folder),
    tagRepository: repository('tag', records.tag),
    tagGroupRepository: repository('group', records.group)
  };
  const policy = (asyncMode ? createAsyncNavigationReferencePolicy : createNavigationReferencePolicy)({
    ...repositories,
    enforceReferences
  });
  return { policy, calls, repositories };
}
const error = (code, message) => ({ code, statusCode: 422, message });
const errors = {
  space: error('NOTE_SPACE_NOT_FOUND', 'The referenced knowledge space does not exist'),
  folder: error('NOTE_FOLDER_NOT_FOUND', 'The referenced folder does not exist'),
  folderSpace: error('NOTE_FOLDER_SPACE_MISMATCH', 'The referenced folder belongs to another knowledge space'),
  tag: error('NOTE_TAG_NOT_FOUND', 'A referenced tag does not exist'),
  tagSpace: error('NOTE_TAG_SPACE_MISMATCH', 'A referenced tag belongs to another knowledge space'),
  group: error('TAG_GROUP_NOT_FOUND', 'The referenced tag group does not exist'),
  groupSpace: error('TAG_GROUP_SPACE_MISMATCH', 'The referenced tag group belongs to another knowledge space'),
  single: error('TAG_GROUP_SINGLE_SELECTION', 'Only one tag may be selected from this group')
};
const repositoryNames = [
  'note',
  'folder',
  'tag',
  'tagGroup',
  'knowledgeSpace',
  'contentAnnotation',
  'pdfAnnotation',
  'annotationExclusion',
  'annotationRevision',
  'analysisScope',
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

export const navigationReferencePolicyTests = [
  {
    name: '导航引用策略：本地关闭引用校验仍检查标签组并规范化单选标签',
    run() {
      const { policy, calls } = fixture(false, false);
      policy.assertSpaceReference('absent', 'NOTE');
      policy.assertNoteReferences(
        Object.freeze({ spaceId: 'absent', folderId: 'absent', tagIds: Object.freeze(['absent']) })
      );
      assert.deepEqual(calls, []);
      assert.throws(() => policy.assertTagGroupReference('absent', 's'), errors.group);
      assert.throws(() => policy.assertTagGroupReference('foreign', 's'), errors.groupSpace);
      assert.deepEqual(policy.normalizeTagIds(Object.freeze(['a', 'c', 'b', 'a', 'absent'])), ['c', 'b', 'absent']);
    }
  },
  {
    name: '导航引用策略：同步与异步保留错误消息、优先级和短路读取',
    async run() {
      const cases = [
        [{ spaceId: 'absent', folderId: 'absent', tagIds: ['absent'] }, errors.space, ['space.findById']],
        [
          { spaceId: 's', folderId: 'absent', tagIds: ['absent'] },
          errors.folder,
          ['space.findById', 'folder.findById']
        ],
        [
          { spaceId: 's', folderId: 'foreign', tagIds: ['absent'] },
          errors.folderSpace,
          ['space.findById', 'folder.findById']
        ],
        [{ spaceId: 's', tagIds: ['absent', 'foreign'] }, errors.tag, ['space.findById', 'tag.findById']],
        [{ spaceId: 's', tagIds: ['foreign', 'absent'] }, errors.tagSpace, ['space.findById', 'tag.findById']]
      ];
      for (const asyncMode of [false, true]) {
        for (const [input, expected, reads] of cases) {
          const { policy, calls } = fixture(asyncMode);
          const frozen = Object.freeze({ ...input, tagIds: Object.freeze([...input.tagIds]) });
          if (asyncMode) await assert.rejects(policy.assertNoteReferences(frozen), expected);
          else assert.throws(() => policy.assertNoteReferences(frozen), expected);
          const expectedReads = reads.map(name => (asyncMode ? name.replace('tag.findById', 'tag.findByIds') : name));
          assert.deepEqual(
            calls.filter(([name]) => !name.endsWith(':resolved')).map(([name]) => name),
            expectedReads
          );
          if (asyncMode) {
            for (let i = 0; i < calls.length; i += 2) assert.equal(calls[i + 1][0], `${calls[i][0]}:resolved`);
          }
        }
        const { policy, calls } = fixture(asyncMode);
        await policy.assertTagGroupReference(null, 's');
        assert.deepEqual(calls, []);
        for (const [id, expected] of [
          ['absent', errors.group],
          ['foreign', errors.groupSpace]
        ]) {
          if (asyncMode) await assert.rejects(policy.assertTagGroupReference(id, 's'), expected);
          else assert.throws(() => policy.assertTagGroupReference(id, 's'), expected);
        }
        await policy.assertTagGroupReference('single', 's');
      }
    }
  },
  {
    name: '导航引用策略：保留本地单选校验与 PG 批读原始标签数组的差异',
    async run() {
      const input = Object.freeze({ spaceId: 's', folderId: 'f', tagIds: Object.freeze(['a', 'b', 'a']) });
      const local = fixture();
      assert.throws(() => local.policy.assertNoteReferences(input), errors.single);
      assert.deepEqual(
        local.calls.map(([name]) => name),
        [
          'space.findById',
          'folder.findById',
          'tag.findById',
          'tag.findById',
          'tag.findById',
          'tag.findById',
          'tag.findById',
          'tag.findById',
          'group.findById'
        ]
      );
      const pg = fixture(true);
      await pg.policy.assertNoteReferences(input);
      assert.deepEqual(pg.calls, [
        ['space.findById', 's'],
        ['space.findById:resolved'],
        ['folder.findById', 'f'],
        ['folder.findById:resolved'],
        ['tag.findByIds', ['a', 'b', 'a']],
        ['tag.findByIds:resolved']
      ]);
      pg.calls.length = 0;
      await pg.policy.assertNoteReferences({ spaceId: 's' });
      assert.deepEqual(pg.calls.slice(-2), [['tag.findByIds', []], ['tag.findByIds:resolved']]);
    }
  },
  {
    name: '导航引用策略：规范化只保留去重后单选末项且不改变输入或读取顺序',
    async run() {
      const input = Object.freeze(['a', 'c', 'b', 'a', 'absent', '', 'foreign']);
      for (const asyncMode of [false, true]) {
        const { policy, calls } = fixture(asyncMode);
        assert.deepEqual(await policy.normalizeTagIds(input), ['c', 'b', 'absent', 'foreign']);
        assert.deepEqual(input, ['a', 'c', 'b', 'a', 'absent', '', 'foreign']);
        if (asyncMode)
          assert.deepEqual(calls, [
            ['tag.findByIds', ['a', 'c', 'b', 'absent', '', 'foreign']],
            ['tag.findByIds:resolved'],
            ['group.findById', 'single'],
            ['group.findById:resolved'],
            ['group.findById', 'multi'],
            ['group.findById:resolved'],
            ['group.findById', 'single'],
            ['group.findById:resolved']
          ]);
        else
          assert.deepEqual(calls, [
            ['tag.findById', 'a'],
            ['group.findById', 'single'],
            ['tag.findById', 'c'],
            ['group.findById', 'multi'],
            ['tag.findById', 'b'],
            ['group.findById', 'single'],
            ['tag.findById', 'absent'],
            ['tag.findById', ''],
            ['tag.findById', 'foreign']
          ]);
        assert.deepEqual(await policy.normalizeTagIds(Object.freeze([])), []);
      }
    }
  },
  {
    name: '导航引用策略：真实本地模块接线保留宽松创建、标签组守卫及批量单选规范化',
    run() {
      const module = createKnowledgeModule();
      module.tagGroupService.createTagGroup({ id: 'single', spaceId: 's', name: '单选', selectionMode: 'single' });
      for (const id of ['a', 'b']) module.tagService.createTag({ id, spaceId: 's', name: id, groupId: 'single' });
      assert.throws(
        () => module.tagService.createTag({ id: 'bad', spaceId: 's', name: '错误', groupId: 'absent' }),
        errors.group
      );
      const note = module.noteService.createNote({
        id: 'n',
        spaceId: 's',
        title: '合成',
        rawMarkdown: '',
        tagIds: ['absent']
      });
      assert.deepEqual(note.tagIds, ['absent']);
      module.noteService.updateTagsForNotes(['n'], ['a', 'b', 'a']);
      assert.deepEqual(module.noteService.getNote('n').tagIds, ['absent', 'b']);
      const strict = createKnowledgeModule({ enforceReferences: true });
      assert.throws(
        () => strict.noteService.createNote({ spaceId: 'absent', title: '合成', rawMarkdown: '' }),
        errors.space
      );
    }
  },
  {
    name: '导航引用策略：真实 PG 模块注入异步策略并在校验失败时阻止写入',
    async run() {
      const { repositories, calls } = fixture(true);
      let writes = 0;
      const module = createPostgresKnowledgeModule({
        ...Object.fromEntries(repositoryNames.map(name => [`${name}Repository`, { supportsAsync: true }])),
        ...repositories,
        noteRepository: {
          supportsAsync: true,
          async findById() {
            return null;
          },
          async save() {
            writes++;
          }
        }
      });
      await assert.rejects(
        module.noteService.createNote({ id: 'n', spaceId: 's', title: '合成', rawMarkdown: '', tagIds: ['foreign'] }),
        errors.tagSpace
      );
      assert.deepEqual(calls, [
        ['space.findById', 's'],
        ['space.findById:resolved'],
        ['tag.findByIds', ['foreign']],
        ['tag.findByIds:resolved']
      ]);
      assert.equal(writes, 0);
      await assert.rejects(
        module.tagService.createTag({ id: 'bad', spaceId: 's', name: '错误', groupId: 'absent' }),
        errors.group
      );
    }
  }
];
