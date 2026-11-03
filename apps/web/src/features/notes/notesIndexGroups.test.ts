import type { Folder, Note } from '@study-accelerator/web-core';
import { describe, expect, it } from 'vitest';
import { groupIndexItems, paginateIndexGroups } from './notesIndexGroups';
import { filterIndexItems, normalizeNoteStatus, updatedDayAge } from './notesIndexFilters';
import { DEFAULT_DISPLAY_PROPERTIES, nextSort, sortNotes, type IndexItem } from './notesIndexPresentation';

const now = new Date(2026, 9, 12, 12);
const date = (day: number) => new Date(2026, 9, day, 10).toISOString();
function note(id: string, overrides: Partial<Note> = {}): Note {
  return { id, title: id, folderId: null, tagIds: [], internalLinks: [], rawMarkdown: '', contentLoaded: false, favorite: false, deleted: false, updatedAt: date(12), ...overrides };
}
const item = (id: string, overrides: Partial<Note> = {}): IndexItem => ({ kind: 'note', note: note(id, overrides) });
const folder: Folder = { id: 'f', name: '研究', parentId: null, children: [] };
const folderItem: IndexItem = { kind: 'folder', folder };
const ids = (items: IndexItem[]) => items.map(entry => entry.kind === 'note' ? entry.note.id : entry.folder.id);

describe('笔记索引分组', () => {
  it('不分组保持所有条目原始顺序且不修改输入', () => {
    const input = Object.freeze([item('b'), folderItem, item('a')]);
    expect(groupIndexItems(input, { group: 'none' })).toEqual([{ id: 'all', label: '', items: input }]);
    expect(groupIndexItems([], { group: 'updated', now })).toEqual([]);
  });
  it('时间分组按本地日历边界排序，组内保留原始排序', () => {
    const input = [item('old', { updatedAt: date(-19) }), item('yesterday', { updatedAt: date(11) }), item('today-b'), item('week-edge', { updatedAt: date(5) }), item('month-edge', { updatedAt: date(-18) }), item('today-a'), folderItem];
    const groups = groupIndexItems(input, { group: 'updated', now });
    expect(groups.map(group => group.label)).toEqual(['文件夹', '今天', '昨天', '近 7 天', '近 30 天', '更早']);
    expect(ids(groups[1].items)).toEqual(['today-b', 'today-a']);
    expect(ids(groups[3].items)).toEqual(['week-edge']);
    expect(ids(groups[4].items)).toEqual(['month-edge']);
  });
  it('缺少、无效、未来日期归入未知时间，不伪造日期', () => {
    const groups = groupIndexItems([item('missing', { updatedAt: undefined }), item('bad', { updatedAt: 'invalid' }), item('future', { updatedAt: date(13) })], { group: 'updated', now });
    expect(groups.map(group => group.label)).toEqual(['未知时间']);
    expect(ids(groups[0].items)).toEqual(['missing', 'bad', 'future']);
  });
  it('文件夹分组用真实名字，不将同名目录合并，未知目录仍保留', () => {
    const groups = groupIndexItems([item('one', { folderId: 'f' }), item('two', { folderId: 'g' }), item('lost', { folderId: 'missing' }), item('unfiled'), folderItem], { group: 'folder', foldersById: { f: folder, g: { ...folder, id: 'g' } } });
    expect(groups.map(group => group.label)).toEqual(['文件夹', '研究', '研究', '未知文件夹', '未归档']);
    expect(new Set(groups.map(group => group.id)).size).toBe(5);
  });
  it('状态别名合并、自定义状态保留，缺省遵循草稿语义', () => {
    const groups = groupIndexItems([item('custom', { status: '待复习' }), item('done', { status: 'done' }), item('active', { status: 'in_progress' }), item('empty'), item('completed', { status: 'completed' }), item('odd', { status: 'constructor' })], { group: 'status' });
    expect(groups.map(group => group.label)).toEqual(['草稿', '进行中', '已完成', '待复习', 'constructor']);
    expect(ids(groups[2].items)).toEqual(['done', 'completed']);
    expect(normalizeNoteStatus(123)).toBe('unknown');
  });
});

describe('已加载项目筛选', () => {
  it('无条件保留文件夹与笔记，状态多选为或关系并规范别名', () => {
    const input = [folderItem, item('draft'), item('active', { status: 'in-progress' }), item('done', { status: 'done' })];
    expect(filterIndexItems(input, { statuses: [], updatedWithin: null }, now)).toEqual(input);
    expect(ids(filterIndexItems(input, { statuses: ['draft', 'active'], updatedWithin: null }, now))).toEqual(['draft', 'active']);
  });
  it('状态和时间为且关系，仅过滤传入数据，日期含日历边界', () => {
    const input = [folderItem, item('today'), item('yesterday', { updatedAt: date(11) }), item('edge', { updatedAt: date(5) }), item('outside', { updatedAt: date(4) }), item('other', { status: 'active' })];
    expect(ids(filterIndexItems(input, { statuses: ['draft'], updatedWithin: '7d' }, now))).toEqual(['today', 'yesterday', 'edge']);
    expect(ids(filterIndexItems(input, { statuses: [], updatedWithin: 'today' }, now))).toEqual(['today', 'other']);
    expect(ids(filterIndexItems([item('edge', { updatedAt: date(-18) }), item('old', { updatedAt: date(-19) })], { statuses: [], updatedWithin: '30d' }, now))).toEqual(['edge']);
  });
  it('无效和未来日期不会通过时间过滤，无时间条件不丢失项目', () => {
    const input = [item('missing', { updatedAt: undefined }), item('invalid', { updatedAt: 'invalid' }), item('future', { updatedAt: date(13) })];
    expect(filterIndexItems(input, { statuses: [], updatedWithin: '30d' }, now)).toEqual([]);
    expect(filterIndexItems(input, { statuses: ['draft'], updatedWithin: null }, now)).toHaveLength(3);
    expect(updatedDayAge(date(12), NaN)).toBeNull();
  });
  it('夏令时前后按日历判断昨天', () => {
    // 使用本地日历构造；各执行时区均可稳定验证，而不依赖 24 小时时长。
    const current = new Date(2026, 2, 9, 0, 1);
    expect(updatedDayAge(new Date(2026, 2, 8, 23, 59).toISOString(), current)).toBe(1);
  });
});

describe('展示偏好与排序', () => {
  it('完整排序循环包含名称降序，所有属性默认显示', () => {
    expect(['updated-desc', 'updated-asc', 'name-asc', 'name-desc'].map(sort => nextSort(sort as Parameters<typeof nextSort>[0]))).toEqual(['updated-asc', 'name-asc', 'name-desc', 'updated-desc']);
    expect(DEFAULT_DISPLAY_PROPERTIES).toEqual({ summary: true, tags: true, status: true, location: true, updated: true });
  });
  it('名称升降序不修改输入', () => {
    const input = [note('B'), note('A'), note('C')];
    expect(sortNotes(input, 'name-desc').map(note => note.id)).toEqual(['C', 'B', 'A']);
    expect(sortNotes(input, 'name-asc').map(note => note.id)).toEqual(['A', 'B', 'C']);
    expect(input.map(note => note.id)).toEqual(['B', 'A', 'C']);
  });
  it('日期无效的项目在升降序都置后，相同日期稳定', () => {
    const input = [note('unknown', { updatedAt: undefined }), note('a'), note('b'), note('older', { updatedAt: date(10) }), note('bad', { updatedAt: 'invalid' })];
    expect(sortNotes(input, 'updated-desc').map(note => note.id)).toEqual(['a', 'b', 'older', 'unknown', 'bad']);
    expect(sortNotes(input, 'updated-asc').map(note => note.id)).toEqual(['older', 'a', 'b', 'unknown', 'bad']);
  });
});


describe('完整分组压缩后分页', () => {
  const mixed = Array.from({ length: 40 }, (_, index) => item(`note-${index}`, { status: index % 2 ? 'active' : 'draft' }));
  const groups = groupIndexItems(mixed, { group: 'status' });

  it('先展开分组顺序再分页，不把交错状态分散到每一页', () => {
    const first = paginateIndexGroups(groups, { page: 0, pageSize: 20, collapsed: new Set() });
    const second = paginateIndexGroups(groups, { page: 1, pageSize: 20, collapsed: new Set() });
    expect(first.groups.map(group => group.id)).toEqual(['status:draft']);
    expect(second.groups.map(group => group.id)).toEqual(['status:active']);
    expect(ids(first.items)).toEqual(mixed.filter((_, index) => index % 2 === 0).map(entry => entry.kind === 'note' ? entry.note.id : ''));
    expect(first.pageCount).toBe(2);
    expect(first.totalVisibleSlots).toBe(40);
  });

  it('跨组页保留每组完整计数，不把切片长度当作组总数', () => {
    const result = paginateIndexGroups(groups, { page: 1, pageSize: 15, collapsed: new Set() });
    expect(result.groups.map(group => [group.id, group.items.length, group.total])).toEqual([
      ['status:draft', 5, 20], ['status:active', 10, 20]
    ]);
    expect(result.items).toHaveLength(15);
    expect(groups[0].items).toHaveLength(20);
    expect(groups[0].total).toBeUndefined();
  });

  it('折叠组只占一个标题槽位，其余条目跨原页边界归并', () => {
    const result = paginateIndexGroups(groups, { page: 0, pageSize: 20, collapsed: new Set(['status:draft']) });
    expect(result.groups.map(group => [group.id, group.items.length, group.total])).toEqual([
      ['status:draft', 0, 20], ['status:active', 19, 20]
    ]);
    expect(result.totalVisibleSlots).toBe(21);
    expect(result.items).toHaveLength(19);
    const last = paginateIndexGroups(groups, { page: 1, pageSize: 20, collapsed: new Set(['status:draft']) });
    expect(ids(last.items)).toEqual(['note-39']);
    expect(last.groups.map(group => group.id)).toEqual(['status:active']);
  });

  it('全部折叠后钳制旧末页并保留所有标题，展开items为空', () => {
    const result = paginateIndexGroups(groups, { page: 9, pageSize: 20, collapsed: new Set(['status:draft', 'status:active']) });
    expect(result.currentPage).toBe(0);
    expect(result.pageCount).toBe(1);
    expect(result.totalVisibleSlots).toBe(2);
    expect(result.groups.map(group => group.label)).toEqual(['草稿', '进行中']);
    expect(result.items).toEqual([]);
  });

  it('无分组不增加标题槽位，也不接受过期的all折叠键', () => {
    const result = paginateIndexGroups(groupIndexItems(mixed, { group: 'none' }), { page: 1, pageSize: 20, collapsed: new Set(['all']) });
    expect(ids(result.items)).toEqual(mixed.slice(20).map(entry => entry.kind === 'note' ? entry.note.id : ''));
    expect(result.totalVisibleSlots).toBe(40);
    expect(result.groups[0].total).toBe(40);
  });

  it('空集合和空组不创建标题页；非法分页参数安全回退', () => {
    expect(paginateIndexGroups([], { page: 10, pageSize: 20, collapsed: new Set() })).toEqual({ groups: [], items: [], pageCount: 1, currentPage: 0, totalVisibleSlots: 0 });
    expect(paginateIndexGroups([{ id: 'empty', label: '空组', items: [] }], { page: 0, pageSize: 20, collapsed: new Set(['empty']) }).groups).toEqual([]);
    const result = paginateIndexGroups(groups, { page: -3, pageSize: 0, collapsed: new Set() });
    expect(result.currentPage).toBe(0);
    expect(result.items).toHaveLength(20);
  });
});
