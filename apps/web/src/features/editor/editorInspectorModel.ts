import type { Folder, Note, Tag } from '@study-accelerator/web-core';

export interface InspectorHeading {
  id: string;
  level: number;
  text: string;
}

export interface InspectorRelations {
  outgoing: Note[];
  backlinks: Note[];
  related: Note[];
}

const STATUS_LABELS: Record<string, string> = {
  draft: '待整理',
  active: '进行中',
  archived: '已归档',
  published: '已发布'
};

export function buildFolderPath(folder: Folder | null, foldersById: Record<string, Folder>): string {
  if (!folder) return '未整理';
  const names: string[] = [];
  const visited = new Set<string>();
  let current: Folder | undefined = folder;
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    names.unshift(current.name);
    current = current.parentId ? foldersById[current.parentId] : undefined;
  }
  return names.join(' / ') || '未整理';
}

export function resolveNoteTags(note: Note, tags: Tag[]): Tag[] {
  const byId = new Map(tags.map((tag) => [tag.id, tag]));
  return note.tagIds.map((tagId) => byId.get(tagId)).filter((tag): tag is Tag => Boolean(tag));
}

export function resolveInspectorRelations(note: Note, notes: Note[]): InspectorRelations {
  const available = notes.filter((item) => !item.deleted && item.id !== note.id);
  const outgoingIds = new Set(note.internalLinks);
  const outgoing = available.filter((item) => outgoingIds.has(item.id));
  const backlinks = available.filter((item) => item.internalLinks.includes(note.id));
  const relatedIds = new Set([...outgoing, ...backlinks].map((item) => item.id));
  return {
    outgoing,
    backlinks,
    related: available.filter((item) => relatedIds.has(item.id))
  };
}

export function extractInspectorOutline(markdown: string): InspectorHeading[] {
  const headings: InspectorHeading[] = [];
  let fence: { marker: '`' | '~'; length: number } | null = null;

  markdown.split(/\r?\n/).forEach((line, index) => {
    if (fence) {
      const closingFence = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(line)?.[1] ?? '';
      if (closingFence[0] === fence.marker && closingFence.length >= fence.length) fence = null;
      return;
    }

    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const token = fenceMatch[1] ?? '';
      const marker = token[0] as '`' | '~';
      fence = { marker, length: token.length };
      return;
    }

    const match = /^\s{0,3}(#{1,4})[\t ]+(.+?)\s*$/.exec(line);
    if (!match) return;
    const source = (match[2] ?? '').replace(/[\t ]+#+[\t ]*$/, '');
    const text = stripInlineMarkdown(source);
    if (text) headings.push({ id: `heading-${index}`, level: match[1]?.length ?? 1, text });
  });

  return headings;
}

export function getDocumentStats(markdown: string, plainText?: string): {
  characterCount: number;
  readingMinutes: number;
} {
  const readable = (plainText?.trim() ? plainText : stripMarkdown(markdown)).trim();
  const characterCount = readable.replace(/\s/g, '').length;
  return {
    characterCount,
    readingMinutes: characterCount === 0 ? 0 : Math.max(1, Math.ceil(characterCount / 250))
  };
}

export function getStatusLabel(status?: string): string {
  const normalized = status?.trim().toLowerCase();
  return normalized ? STATUS_LABELS[normalized] ?? status ?? '待整理' : '待整理';
}

export function getSourceLabel(sourceType?: string): string {
  if (sourceType === 'markdown-import') return 'IMPORTED NOTE';
  if (sourceType === 'web-clip') return 'WEB CLIP';
  return 'KNOWRA NOTE';
}

export function formatInspectorDate(value?: string, now = new Date()): string {
  if (!value) return '未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未知';
  const dateParts = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const time = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => dateParts.find((item) => item.type === type)?.value ?? '';
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  return sameDay
    ? `今天 ${time}`
    : `${part('year')}-${part('month')}-${part('day')} ${time}`;
}

/** 检查器里的紧凑时间：今天/昨天 + 时分，今年内“M月D日 时分”，更早带年份。 */
export function formatInspectorMoment(value?: string, now = new Date()): string {
  if (!value) return '未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未知';
  const time = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  const dayStart = (input: Date) => new Date(input.getFullYear(), input.getMonth(), input.getDate()).getTime();
  const days = Math.round((dayStart(now) - dayStart(date)) / 86_400_000);
  if (days === 0) return `今天 ${time}`;
  if (days === 1) return `昨天 ${time}`;
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

/** 只含日期的短格式，用于“创建于”。 */
export function formatInspectorDay(value?: string, now = new Date()): string {
  if (!value) return '未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未知';
  return date.getFullYear() === now.getFullYear()
    ? `${date.getMonth() + 1}月${date.getDate()}日`
    : `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[^\n]*\n?/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/^\s{0,3}(?:#{1,6}|>|[-+*]|\d+[.)])\s+/gm, '')
    .replace(/[*_~=`]/g, '')
    .replace(/\[\[|\]\]/g, ' ');
}

function stripInlineMarkdown(value: string): string {
  return value.replace(/[*_~=`]/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim();
}
