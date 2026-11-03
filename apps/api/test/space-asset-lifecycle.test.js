import assert from 'node:assert/strict';
import { createSpaceAssetLifecycle } from '../src/modules/knowledge/application/space-asset-lifecycle.js';
import { createAsyncSpaceAssetLifecycle } from '../src/modules/knowledge/application/postgres-async/space-asset-lifecycle.js';
import { createKnowledgeModule } from '../src/modules/knowledge/index.js';
import { createPostgresKnowledgeModule } from '../src/modules/knowledge/postgres-async-module.js';
import { buildDefaultTagGroups } from '../src/modules/knowledge/domain/default-tag-groups.ts';

const names = [
  'note',
  'folder',
  'tag',
  'tagGroup',
  'knowledgeSpace',
  'contentAnnotation',
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
const stamp = '2026-10-01T00:00:00Z';
function fixture(asyncMode, { populated = true, module = false, failWrite = null } = {}) {
  let state = Object.fromEntries(names.map(name => [name, []]));
  state.knowledgeSpace = ['source', 'target'].map(id => ({ id, userId: 'owner', updatedAt: stamp }));
  state.tagGroup = buildDefaultTagGroups('source');
  if (populated) {
    state.tagGroup.push({ id: 'custom', spaceId: 'source', name: '自定义', isSystem: false });
    state.tag = [
      { id: 'tag', spaceId: 'source', groupId: 'tag-group-source-ordinary' },
      { id: 'custom-tag', spaceId: 'source', groupId: 'custom' }
    ];
    state.folder = [{ id: 'folder', spaceId: 'source', deletedAt: stamp }];
    state.note = [{ id: 'note', spaceId: 'source', deleted: true, internalLinks: [] }];
    state.contentAnnotation = [{ id: 'annotation', spaceId: 'source' }];
    state.analysisScope = [{ id: 'scope', spaceId: 'source', noteId: 'note', deletedAt: stamp }];
  }
  const calls = [];
  let inside = false;
  const repositories = layer =>
    Object.fromEntries(
      names.map(name => {
        const call = (method, args, operation, write = false) => {
          calls.push([layer, name, method, structuredClone(args)]);
          if (asyncMode && !module && inside && layer !== 'transaction') throw new Error('外层仓库泄漏到事务');
          if (write && !inside && !module) throw new Error('写入未进入事务');
          const execute = () => {
            if (write && `${name}.${method}` === failWrite) throw new Error('合成写入失败');
            return structuredClone(operation());
          };
          return asyncMode ? Promise.resolve().then(execute) : execute();
        };
        const save = row => {
          const index = state[name].findIndex(item => item.id === row.id);
          if (index < 0) state[name].push(structuredClone(row));
          else state[name][index] = structuredClone(row);
          return row;
        };
        return [
          `${name}Repository`,
          {
            supportsAsync: asyncMode,
            list: (query = {}) =>
              call('list', [query], () => state[name].filter(row => !query.spaceId || row.spaceId === query.spaceId)),
            findById: id => call('findById', [id], () => state[name].find(row => row.id === id) ?? null),
            save: row => call('save', [row], () => save(row), true),
            create: row => call('create', [row], () => save(row), true),
            delete: id =>
              call(
                'delete',
                [id],
                () => {
                  state[name] = state[name].filter(row => row.id !== id);
                  return null;
                },
                true
              ),
            moveToSpace: (id, spaceId) =>
              call(
                'moveToSpace',
                [id, spaceId],
                () => save({ ...state[name].find(row => row.id === id), spaceId }),
                true
              )
          }
        ];
      })
    );
  const outer = repositories('outer');
  const transaction = repositories('transaction');
  // 此合成事务只验证应用服务正确委托、传播失败；不作为真实 PostgreSQL 回滚证据。
  const runTransaction = operation => {
    const before = structuredClone(state);
    inside = true;
    calls.push(['transaction', 'begin']);
    const commit = result => {
      inside = false;
      calls.push(['transaction', 'commit']);
      return result;
    };
    const rollback = error => {
      state = before;
      inside = false;
      calls.push(['transaction', 'rollback']);
      throw error;
    };
    if (asyncMode)
      return Promise.resolve()
        .then(() => operation(transaction))
        .then(commit, rollback);
    try {
      return commit(operation());
    } catch (error) {
      return rollback(error);
    }
  };
  const service = module
    ? (asyncMode ? createPostgresKnowledgeModule : createKnowledgeModule)({ ...outer, runTransaction })
    : (asyncMode ? createAsyncSpaceAssetLifecycle : createSpaceAssetLifecycle)({ ...outer, runTransaction });
  return { service, calls, state: () => structuredClone(state) };
}
const invoke = async (service, method, ...args) => service[method](...args);

export const spaceAssetLifecycleTests = [
  ...[false, true].flatMap(asyncMode => [
    {
      name: `空间生命周期 ${asyncMode ? '异步' : '同步'}：四个原入口接线保持结果与读取序列`,
      async run() {
        for (const populated of [false, true]) {
          const direct = fixture(asyncMode, { populated });
          const wired = fixture(asyncMode, { populated, module: true });
          const methods = populated
            ? [['previewSpaceMigration', 'source', 'target', 'owner']]
            : [['inspectEmptySpaceDeletion', 'source', 'owner']];
          for (const [method, ...args] of methods) {
            assert.deepEqual(
              await invoke(direct.service, method, ...args),
              await invoke(wired.service, method, ...args)
            );
            assert.deepEqual(direct.calls, wired.calls);
          }
          const before = direct.state();
          const result = populated
            ? await direct.service.migrateSpaceAssets(
                'source',
                {
                  targetSpaceId: 'target',
                  expectedPreviewHash: (await direct.service.previewSpaceMigration('source', 'target', 'owner'))
                    .previewHash
                },
                'owner'
              )
            : await direct.service.deleteEmptySpace('source', { expectedUpdatedAt: stamp }, 'owner');
          const wiredResult = populated
            ? await wired.service.migrateSpaceAssets(
                'source',
                {
                  targetSpaceId: 'target',
                  expectedPreviewHash: (await wired.service.previewSpaceMigration('source', 'target', 'owner'))
                    .previewHash
                },
                'owner'
              )
            : await wired.service.deleteEmptySpace('source', { expectedUpdatedAt: stamp }, 'owner');
          assert.deepEqual(result, wiredResult);
          assert.deepEqual(direct.state(), wired.state());
          const operations = calls => calls.filter(row => row.length === 4).map(([, ...operation]) => operation);
          assert.deepEqual(operations(direct.calls), operations(wired.calls));
          if (populated) {
            const after = direct.state();
            for (const name of ['note', 'folder', 'tag', 'contentAnnotation', 'analysisScope'])
              assert(after[name].every(row => row.spaceId === 'target'));
            assert.equal(after.tag[0].groupId, 'tag-group-target-ordinary');
            assert.equal(after.tag[1].groupId, 'custom');
            assert.deepEqual(after.knowledgeSpace, before.knowledgeSpace);
            assert.deepEqual(
              after.tagGroup.filter(row => row.spaceId === 'source'),
              buildDefaultTagGroups('source')
            );
            const writes = direct.calls.filter(row => ['save', 'create', 'moveToSpace'].includes(row[2]));
            assert.deepEqual(
              writes.map(row => `${row[1]}.${row[2]}`),
              [
                ...Array(4).fill('tagGroup.create'),
                `tagGroup.${asyncMode ? 'moveToSpace' : 'save'}`,
                'tag.save',
                'tag.save',
                'folder.save',
                'note.save',
                'contentAnnotation.save',
                `analysisScope.${asyncMode ? 'moveToSpace' : 'save'}`
              ]
            );
          } else {
            assert.deepEqual(
              direct.calls.filter(row => row[2] === 'delete').map(row => row[1]),
              [...Array(4).fill('tagGroup'), 'knowledgeSpace']
            );
            assert.equal(
              direct.state().knowledgeSpace.some(row => row.id === 'source'),
              false
            );
          }
        }
      }
    },
    {
      name: `空间生命周期 ${asyncMode ? '异步' : '同步'}：owner、过期预检与禁止范围保持零写入`,
      async run() {
        for (const [method, args, code] of [
          ['inspectEmptySpaceDeletion', ['source', 'other'], 'KNOWLEDGE_SPACE_NOT_FOUND'],
          ['previewSpaceMigration', ['source', 'target', 'other'], 'KNOWLEDGE_SPACE_NOT_FOUND'],
          ['deleteEmptySpace', ['source', { expectedUpdatedAt: 'stale' }, 'owner'], 'KNOWLEDGE_SPACE_UPDATE_CONFLICT'],
          [
            'migrateSpaceAssets',
            ['source', { targetSpaceId: 'target', expectedPreviewHash: 'stale' }, 'owner'],
            'SPACE_MIGRATION_PREVIEW_STALE'
          ],
          ['deleteEmptySpace', ['source', { expectedUpdatedAt: stamp }, 'owner'], 'KNOWLEDGE_SPACE_DELETE_BLOCKED']
        ]) {
          const f = fixture(asyncMode);
          const before = f.state();
          const wired = fixture(asyncMode, { module: true });
          const capture = async service => {
            try {
              await invoke(service, method, ...args);
              assert.fail('应拒绝');
            } catch (error) {
              return { code: error.code, statusCode: error.statusCode, message: error.message };
            }
          };
          const error = await capture(f.service);
          assert.equal(error.code, code);
          assert.deepEqual(error, await capture(wired.service));
          assert.deepEqual(
            f.calls.filter(row => row.length === 4).map(([, ...row]) => row),
            wired.calls.filter(row => row.length === 4).map(([, ...row]) => row)
          );
          assert.deepEqual(f.state(), before);
          assert(!f.calls.some(row => ['save', 'create', 'delete', 'moveToSpace'].includes(row[2])));
        }
        const f = fixture(asyncMode);
        const preview = await f.service.previewSpaceMigration('source', 'source', 'owner');
        await assert.rejects(
          invoke(
            f.service,
            'migrateSpaceAssets',
            'source',
            { targetSpaceId: 'source', expectedPreviewHash: preview.previewHash },
            'owner'
          ),
          { code: 'SPACE_MIGRATION_BLOCKED' }
        );
      }
    },
    {
      name: `空间生命周期 ${asyncMode ? '异步' : '同步'}：晚期写入失败原样交给合成事务恢复`,
      async run() {
        for (const populated of [false, true]) {
          const f = fixture(asyncMode, {
            populated,
            failWrite: populated ? `analysisScope.${asyncMode ? 'moveToSpace' : 'save'}` : 'knowledgeSpace.delete'
          });
          const before = f.state();
          const method = populated ? 'migrateSpaceAssets' : 'deleteEmptySpace';
          const args = populated
            ? {
                targetSpaceId: 'target',
                expectedPreviewHash: (await f.service.previewSpaceMigration('source', 'target', 'owner')).previewHash
              }
            : { expectedUpdatedAt: stamp };
          await assert.rejects(invoke(f.service, method, 'source', args, 'owner'), { message: '合成写入失败' });
          assert.deepEqual(f.state(), before);
          assert.deepEqual(f.calls.at(-1), ['transaction', 'rollback']);
        }
      }
    }
  ])
];
