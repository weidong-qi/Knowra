import { describe, expect, it } from 'vitest';
import { countTagUsage } from './tagUsage';

describe('标签使用计数', () => {
  it('只统计存活笔记，每篇的重复标签只记一次，未知标签不创建记录', () => {
    expect(countTagUsage([{ id: 'used' }, { id: 'unused' }], [
      { deleted: false, tagIds: ['used', 'used', 'unknown'] },
      { deleted: true, tagIds: ['used'] },
      { deleted: false, tagIds: ['used'] }
    ])).toEqual({ used: 2, unused: 0 });
  });
  it('对特殊键与空输入保持旧 Object.fromEntries 语义', () => {
    const tags = [{ id: '__proto__' }, { id: 'constructor' }, { id: 'constructor' }];
    const notes = [{ deleted: false, tagIds: ['__proto__', 'constructor', 'constructor'] }];
    const old = Object.fromEntries(tags.map(tag => [tag.id, notes.filter(note => !note.deleted && note.tagIds.includes(tag.id)).length]));
    expect(countTagUsage(tags, notes)).toEqual(old);
    expect(countTagUsage([], notes)).toEqual({});
    expect(countTagUsage(tags, [])).toEqual(Object.fromEntries(tags.map(tag => [tag.id, 0])));
  });
});

// 冻结三入口的旧规则：侧栏／管理页返回 Map，检查器返回普通记录。
function legacyMap(tags: { id: string }[], notes: { deleted: boolean; tagIds: string[] }[]) {
  return new Map(tags.map(tag => [tag.id, notes.filter(note => !note.deleted && note.tagIds.includes(tag.id)).length]));
}

describe('旧三入口差分与线性扫描', () => {
  it('混合重复 ID、特殊键、未知标签和输入顺序与旧规则一致且不修改输入', () => {
    const ids = ['unused', '2', '__proto__', 'constructor', 'toString', 'used', '0', 'unknown'];
    for (let seed = 0; seed < 100; seed++) {
      const tags = Array.from({ length: seed % 13 }, (_, index) => ({ id: ids[(index * 3 + seed) % 7] }));
      const notes = Array.from({ length: seed % 19 }, (_, index) => ({
        deleted: (index + seed) % 4 === 0,
        tagIds: Array.from({ length: index % 9 }, (_, offset) => ids[(offset * 2 + index + seed) % ids.length])
      }));
      const snapshot = structuredClone({ tags, notes });
      tags.forEach(Object.freeze);
      notes.forEach(note => { Object.freeze(note.tagIds); Object.freeze(note); });
      Object.freeze(tags); Object.freeze(notes);
      const old = legacyMap(tags, notes);
      const result = countTagUsage(tags, notes);
      expect(result).toEqual(Object.fromEntries(old));
      expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
      expect(Object.keys(result)).toEqual(Object.keys(Object.fromEntries(old)));
      // 管理页仍对独立标签 ID 统计未使用数，不随重复标签记录增加。
      expect(Object.values(result).filter(count => count === 0).length).toBe([...old.values()].filter(count => count === 0).length);
      expect(tags.slice().sort((a, b) => result[b.id] - result[a.id])).toEqual(tags.slice().sort((a, b) => old.get(b.id)! - old.get(a.id)!));
      for (const tag of tags) {
        expect(Object.hasOwn(result, tag.id)).toBe(true);
        expect(typeof result[tag.id]).toBe('number');
      }
      expect({ tags, notes }).toEqual(snapshot);
    }
  });

  it('标签增多不会重复读取每条笔记或扫描其标签', () => {
    const tags = Array.from({ length: 300 }, (_, index) => ({ id: `tag-${index}` }));
    let deletedReads = 0;
    let tagIdsReads = 0;
    let tagVisits = 0;
    const notes = Array.from({ length: 1000 }, (_, index) => {
      const ids = [`tag-${index % tags.length}`, `tag-${index % tags.length}`, 'unknown'];
      const iterator = ids[Symbol.iterator].bind(ids);
      ids[Symbol.iterator] = function* () { for (const id of iterator()) { tagVisits++; yield id; } return undefined; };
      return {
        get deleted() { deletedReads++; return index % 4 === 0; },
        get tagIds() { tagIdsReads++; return ids; }
      };
    });
    const result = countTagUsage(tags, notes);
    expect(deletedReads).toBe(1000);
    expect(tagIdsReads).toBe(750);
    expect(tagVisits).toBe(2250);
    expect(Object.values(result).reduce((sum, count) => sum + count, 0)).toBe(750);
    deletedReads = 0; tagIdsReads = 0; tagVisits = 0;
    expect(Object.fromEntries(legacyMap(tags, notes))).toEqual(result);
    expect(deletedReads).toBe(300000);
    expect(tagIdsReads).toBe(225000);
  });
});
