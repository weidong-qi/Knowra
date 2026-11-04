const RECENT_NOTE_LIMIT = 5;

export const LIBRARY_PAGE_SIZE_OPTIONS = [5, 10, 20, 50];

export const LIBRARY_TYPE_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'manual', label: '手动笔记' },
  { value: 'markdown-import', label: 'Markdown 导入' },
  { value: 'pdf-import', label: 'PDF 导入' },
  { value: 'imported-file', label: '文件资料' }
];

export const LIBRARY_STATUS_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'draft', label: '待整理' },
  { value: 'active', label: '进行中' },
  { value: 'published', label: '已完成' },
  { value: 'archived', label: '已归档' }
];

export const LIBRARY_TIME_OPTIONS = [
  { value: 'updated-desc', label: '最近编辑' },
  { value: 'updated-asc', label: '最早编辑' },
  { value: 'created-desc', label: '最近创建' },
  { value: 'created-asc', label: '最早创建' }
];

export function selectLibraryIndexNotes(state) {
  const tab = state.libraryIndex?.tab ?? 'all';
  const selectedTagIds = state.search?.selectedTagIds ?? [];
  const globalKeyword = String(state.search?.keyword ?? '').trim().toLowerCase();
  const localKeyword = String(state.libraryIndex?.localKeyword ?? '').trim().toLowerCase();
  const filters = resolveLibraryFilters(state.libraryIndex?.filters);
  let candidates = selectTabCandidates(state.allNotes ?? [], tab);

  candidates = candidates.filter((note) => {
    if (state.selectedFolderId && note.folderId !== state.selectedFolderId) return false;
    if (filters.type !== 'all' && note.sourceType !== filters.type) return false;
    if (filters.status !== 'all' && note.status !== filters.status) return false;
    if (selectedTagIds.length && !selectedTagIds.every((tagId) => (note.tagIds ?? []).includes(tagId))) return false;
    const tagText = (note.tagIds ?? [])
      .map((tagId) => (state.tags ?? []).find((tag) => tag.id === tagId)?.name ?? '')
      .join(' ');
    const searchableText = `${note.title} ${note.summary ?? note.rawMarkdown ?? ''} ${tagText}`.toLowerCase();
    const matchesGlobal = !globalKeyword || (Array.isArray(state.search?.matchingNoteIds)
      ? state.search.matchingNoteIds.includes(note.id) || tagText.toLowerCase().includes(globalKeyword)
      : searchableText.includes(globalKeyword));
    const matchesLocal = !localKeyword || searchableText.includes(localKeyword);
    return matchesGlobal && matchesLocal;
  });

  return candidates.sort(createTimeComparator(filters.time));
}

export function paginateLibraryIndexNotes(notes = [], pagination = {}) {
  const resolved = resolveLibraryPagination(pagination, notes.length);
  const startIndex = (resolved.page - 1) * resolved.pageSize;
  return {
    ...resolved,
    items: notes.slice(startIndex, startIndex + resolved.pageSize),
    startIndex
  };
}

export function resolveLibraryPagination(pagination = {}, totalItems = 0) {
  const requestedSize = Number(pagination.pageSize);
  const pageSize = LIBRARY_PAGE_SIZE_OPTIONS.includes(requestedSize) ? requestedSize : 10;
  const totalPages = Math.max(1, Math.ceil(Math.max(0, totalItems) / pageSize));
  const requestedPage = Number.isInteger(Number(pagination.page)) ? Number(pagination.page) : 1;
  const page = Math.min(totalPages, Math.max(1, requestedPage));
  return { page, pageSize, totalItems: Math.max(0, totalItems), totalPages };
}

export function getLibraryTabCounts(notes = []) {
  const activeNotes = notes.filter((note) => !note.deleted);
  return {
    all: activeNotes.length,
    recent: Math.min(RECENT_NOTE_LIMIT, activeNotes.length),
    favorites: activeNotes.filter((note) => note.favorite).length,
    recycle: notes.filter((note) => note.deleted).length
  };
}

export function resolveLibraryFilters(filters = {}) {
  return {
    type: resolveOptionValue(LIBRARY_TYPE_OPTIONS, filters.type, 'all'),
    status: resolveOptionValue(LIBRARY_STATUS_OPTIONS, filters.status, 'all'),
    time: resolveOptionValue(LIBRARY_TIME_OPTIONS, filters.time, 'updated-desc')
  };
}

export function getLibraryFilterLabel(kind, value) {
  const options = getLibraryFilterOptions(kind);
  return options.find((option) => option.value === value)?.label ?? options[0].label;
}

export function getLibraryFilterOptions(kind) {
  if (kind === 'status') return LIBRARY_STATUS_OPTIONS;
  if (kind === 'time') return LIBRARY_TIME_OPTIONS;
  return LIBRARY_TYPE_OPTIONS;
}

export function getEstimatedReadingMinutes(note) {
  if (Number.isFinite(Number(note?.readingMinutes))) {
    return Math.max(1, Number(note.readingMinutes));
  }
  const contentLength = Number.isFinite(Number(note?.characterCount))
    ? Number(note.characterCount)
    : String(note?.rawMarkdown ?? '').replace(/\s/g, '').length;
  return Math.max(1, Math.ceil(contentLength / 360));
}

export function getSourceTypeLabel(sourceType) {
  const labels = {
    manual: '手动笔记',
    'markdown-import': 'MD 导入',
    'pdf-import': 'PDF 导入',
    'imported-file': '文件资料'
  };
  return labels[sourceType] ?? '文档';
}

export function getStatusLabel(status) {
  const labels = { draft: '待整理', active: '进行中', published: '已完成', archived: '已归档' };
  return labels[status] ?? status ?? '进行中';
}

function selectTabCandidates(notes, tab) {
  if (tab === 'recycle') return notes.filter((note) => note.deleted);
  const activeNotes = notes.filter((note) => !note.deleted);
  if (tab === 'favorites') return activeNotes.filter((note) => note.favorite);
  if (tab === 'recent') {
    return [...activeNotes]
      .sort(createTimeComparator('updated-desc'))
      .slice(0, RECENT_NOTE_LIMIT);
  }
  return activeNotes;
}

function createTimeComparator(time) {
  const [field, direction] = String(time).split('-');
  const dateKey = field === 'created' ? 'createdAt' : 'updatedAt';
  const multiplier = direction === 'asc' ? 1 : -1;
  return (left, right) => multiplier * (toTimestamp(left[dateKey]) - toTimestamp(right[dateKey]));
}

function resolveOptionValue(options, value, fallback) {
  return options.some((option) => option.value === value) ? value : fallback;
}

function toTimestamp(value) {
  const timestamp = new Date(value ?? 0).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}
