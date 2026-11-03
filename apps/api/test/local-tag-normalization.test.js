import assert from 'node:assert/strict';
import { validateLocalDataRelations } from '../src/infrastructure/local-data-relations.js';
import { createEmptyLocalState, validatePersistedLocalState } from '../src/infrastructure/local-data-schema.js';
import { buildDefaultTagGroups } from '../src/modules/knowledge/domain/default-tag-groups.ts';

const space = id => ({ id, userId: 'demo', name: id });
const tag = (id, groupId, extra = {}) => ({ id, spaceId: 's', name: id, groupId, ...extra });
const note = (id, tagIds) => ({ id, spaceId: 's', title: id, rawMarkdown: '', tagIds });
const group = (id, selectionMode = 'single') => ({ id, spaceId: 's', name: id, selectionMode });
function fixture() {
  return {
    ...createEmptyLocalState(),
    spaces: [space('s')],
    tagGroups: [group('single'), group('multiple', 'multiple')],
    tags: [tag('a', 'single'), tag('b', 'single'), tag('c', 'multiple')],
    notes: [note('n', ['a', 'c', 'b', 'a', 'missing'])]
  };
}
function outcome(state) {
  try {
    validateLocalDataRelations(state);
    return null;
  } catch (error) {
    return { code: error.code, message: error.message, statusCode: error.statusCode };
  }
}
function compareLegacy(input) {
  const expected = structuredClone(input);
  legacyNormalizeTagSystem(expected);
  const expectedError = outcome(structuredClone(expected));
  const actual = structuredClone(input);
  assert.deepEqual(outcome(actual), expectedError);
  assert.deepEqual(actual, expected);
  return actual;
}

export const localTagNormalizationTests = [
  {
    name: '本地标签归一化保留去重后单选后值、缺失引用清理及原地对象身份',
    run() {
      const state = fixture();
      state.tags.push(tag('legacy', undefined, { color: 'CYAN', isSystem: 1, sortOrder: '0' }));
      state.notes[0].tagIds.push('legacy');
      const refs = [state.tags, state.tagGroups, state.notes, state.tags[0], state.notes[0]];
      assert.equal(validateLocalDataRelations(state), state);
      assert.deepEqual(state.notes[0].tagIds, ['c', 'b', 'legacy']);
      assert.equal(state.tags, refs[0]);
      assert.equal(state.tagGroups, refs[1]);
      assert.equal(state.notes, refs[2]);
      assert.equal(state.tags[0], refs[3]);
      assert.equal(state.notes[0], refs[4]);
      assert.equal(state.tags[3].color, 'blue');
      assert.equal(state.tags[3].sortOrder, 4);
      assert.equal(state.tags[3].groupId, 'tag-group-s-ordinary');
      assert.equal(state.tags[3].isSystem, true);
      const normalized = structuredClone(state);
      validateLocalDataRelations(state);
      assert.deepEqual(state, normalized);
    }
  },
  {
    name: '本地标签归一化每次重建索引并尊重已存在的默认分组',
    run() {
      const state = fixture();
      const customDefault = group('tag-group-s-ordinary', 'single');
      state.tagGroups.push(customDefault);
      state.tags.push(tag('d'), tag('e'));
      state.notes[0].tagIds = ['d', 'e'];
      validateLocalDataRelations(state);
      assert.deepEqual(state.notes[0].tagIds, ['e']);
      assert.equal(
        state.tagGroups.find(item => item.id === customDefault.id),
        customDefault
      );
      customDefault.selectionMode = 'multiple';
      state.tags.push(tag('f'));
      state.notes[0].tagIds = ['d', 'e', 'f'];
      validateLocalDataRelations(state);
      assert.deepEqual(state.notes[0].tagIds, ['d', 'e', 'f']);
      state.tags = state.tags.filter(item => item.id !== 'e');
      validateLocalDataRelations(state);
      assert.deepEqual(state.notes[0].tagIds, ['d', 'f']);
      compareLegacy(state);
    }
  },
  {
    name: '本地标签归一化保留重复ID首项查找和跨引用错误时机',
    run() {
      const duplicateTags = fixture();
      duplicateTags.tags.push(tag('a', 'multiple'));
      assert.deepEqual(compareLegacy(duplicateTags).notes[0].tagIds, ['c', 'b']);
      const duplicateGroups = fixture();
      duplicateGroups.tagGroups.push(group('single', 'multiple'));
      assert.deepEqual(compareLegacy(duplicateGroups).notes[0].tagIds, ['c', 'b']);
      for (const state of [duplicateTags, duplicateGroups]) {
        assert.throws(
          () => validatePersistedLocalState({ schemaVersion: 7, ...state }),
          error => error.code === 'STORAGE_SNAPSHOT_INVALID' && /duplicate/i.test(error.message)
        );
      }
      for (const mutate of [
        state => {
          state.tags[0].groupId = 'absent';
        },
        state => {
          state.tags[0].spaceId = 'other';
        },
        state => {
          state.tagGroups[0].selectionMode = 'invalid';
        },
        state => {
          state.folders.push({ id: 'broken', spaceId: 'absent' });
        },
        state => {
          state.notes[0].spaceId = 'absent';
        }
      ]) {
        const state = fixture();
        mutate(state);
        const actual = compareLegacy(state);
        assert.notEqual(outcome(actual), null);
      }
    }
  },
  {
    name: '本地标签归一化固定种子差分覆盖默认值多空间与重复引用',
    run() {
      let seed = 2197;
      const random = n => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed % n;
      };
      for (let trial = 0; trial < 80; trial++) {
        const state = fixture();
        state.spaces.push(space('other'));
        if (trial % 4 === 0) delete state.tagGroups;
        else if (trial % 3 === 0) state.tagGroups.push(group('single', 'multiple'));
        state.tags = Array.from({ length: 16 }, (_, i) =>
          tag(`t${i}`, trial % 4 === 0 ? undefined : ['single', 'multiple', undefined][random(3)], {
            color: [undefined, null, 'slate', 'CYAN', 'amber', 'custom'][random(6)],
            sortOrder: [undefined, 0, '0', '9', -2][random(5)],
            isSystem: [undefined, false, true, 1][random(4)]
          })
        );
        state.notes = Array.from({ length: 20 }, (_, i) =>
          note(
            `n${i}`,
            Array.from({ length: random(18) }, () => `t${random(20)}`)
          )
        );
        compareLegacy(state);
      }
    }
  },
  {
    name: '本地标签归一化对标签分组的扫描次数不随笔记引用数增长',
    run() {
      const inspect = noteCount => {
        const state = fixture();
        state.tagGroups.forEach(item => {
          item.selectionMode = 'multiple';
        });
        state.tags = Array.from({ length: 80 }, (_, i) => tag(`t${i}`, i % 2 ? 'single' : 'multiple'));
        state.notes = Array.from({ length: noteCount }, (_, i) =>
          note(
            `n${i}`,
            state.tags.map(item => item.id)
          )
        );
        const counts = { tags: 0, groups: 0 };
        for (const [key, collection] of [
          ['tags', state.tags],
          ['groups', state.tagGroups]
        ]) {
          for (const item of collection) {
            const id = item.id;
            Object.defineProperty(item, 'id', {
              enumerable: true,
              get() {
                counts[key]++;
                return id;
              }
            });
          }
        }
        validateLocalDataRelations(state);
        return counts;
      };
      const small = inspect(1),
        large = inspect(100);
      assert.equal(large.tags, small.tags, '不为每个笔记标签重新查找标签表');
      assert.equal(large.groups, small.groups, '不为每个笔记标签重新扫描分组表');
    }
  }
];

// 冻结优化前的归一化规则，供完整关系校验入口做差分；不导出生产内部函数。
function legacyNormalizeTagSystem(state) {
  state.tagGroups ??= [];
  const colors = {
    slate: 'neutral',
    cyan: 'blue',
    amber: 'orange',
    mastery: 'green',
    importance: 'orange',
    purpose: 'blue',
    '#3c68ff': 'blue'
  };
  for (const space of state.spaces) {
    buildDefaultTagGroups(space.id).forEach(group => {
      if (!state.tagGroups.some(current => current.id === group.id)) {
        state.tagGroups.push(group);
      }
    });
  }
  state.tags.forEach((tag, index) => {
    tag.color = colors[String(tag.color ?? 'neutral').toLowerCase()] ?? tag.color ?? 'neutral';
    tag.isSystem = Boolean(tag.isSystem);
    tag.sortOrder = Number(tag.sortOrder) || index + 1;
    if (!tag.groupId) tag.groupId = `tag-group-${tag.spaceId}-ordinary`;
  });
  const tagIds = new Set(state.tags.map(tag => tag.id));
  state.notes.forEach(note => {
    const normalizedIds = [];
    const singleIndexes = new Map();
    [...new Set((note.tagIds ?? []).filter(id => tagIds.has(id)))].forEach(tagId => {
      const tag = state.tags.find(item => item.id === tagId);
      const group = state.tagGroups.find(item => item.id === tag?.groupId);
      if (group?.selectionMode === 'single') {
        const previous = singleIndexes.get(group.id);
        if (previous !== undefined) normalizedIds[previous] = null;
        singleIndexes.set(group.id, normalizedIds.length);
      }
      normalizedIds.push(tagId);
    });
    note.tagIds = normalizedIds.filter(Boolean);
  });
}
