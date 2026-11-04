import { describe, expect, it } from 'vitest';
import type { Folder, Note, Tag } from '@study-accelerator/web-core';
import {
  buildFolderPath,
  extractInspectorOutline,
  formatInspectorDate,
  formatInspectorDay,
  formatInspectorMoment,
  getDocumentStats,
  getStatusLabel,
  resolveInspectorRelations,
  resolveNoteTags
} from './editorInspectorModel';

const note = createNote('note-a', ['note-b']);

describe('editorInspectorModel', () => {
  it('derives real metadata, folder paths and assigned tags', () => {
    const root = createFolder('root', '研究', null);
    const child = createFolder('child', '注意力', 'root');
    const tags: Tag[] = [{ id: 'tag-ai', name: 'AI' }, { id: 'tag-study', name: '学习' }];
    const tagged = { ...note, folderId: child.id, tagIds: ['tag-study', 'missing', 'tag-ai'] };

    expect(buildFolderPath(child, { root, child })).toBe('研究 / 注意力');
    expect(resolveNoteTags(tagged, tags).map((tag) => tag.name)).toEqual(['学习', 'AI']);
    expect(getStatusLabel('draft')).toBe('待整理');
  });

  it('derives outline, reading stats and bidirectional relations', () => {
    const noteB = createNote('note-b', []);
    const noteC = createNote('note-c', ['note-a']);
    const markdown = '# 核心原理\n正文内容\n## **计算步骤**\n更多内容';

    expect(extractInspectorOutline(markdown)).toEqual([
      { id: 'heading-0', level: 1, text: '核心原理' },
      { id: 'heading-2', level: 2, text: '计算步骤' }
    ]);
    expect(getDocumentStats(markdown).characterCount).toBeGreaterThan(0);
    expect(resolveInspectorRelations(note, [note, noteB, noteC])).toEqual({
      outgoing: [noteB],
      backlinks: [noteC],
      related: [noteB, noteC]
    });
  });

  it('keeps duplicate headings addressable and ignores headings inside fenced code', () => {
    const markdown = [
      '# 重复标题',
      '```md',
      '## 这不是大纲',
      '```not-a-closing-fence',
      '### 仍然不是大纲',
      '```',
      '  ## 重复标题 ##',
      '### 子级'
    ].join('\n');

    expect(extractInspectorOutline(markdown)).toEqual([
      { id: 'heading-0', level: 1, text: '重复标题' },
      { id: 'heading-6', level: 2, text: '重复标题' },
      { id: 'heading-7', level: 3, text: '子级' }
    ]);
  });

  it('formats same-day dates without pretending invalid timestamps are known', () => {
    const now = new Date(2026, 7, 31, 18, 0);
    expect(formatInspectorDate(new Date(2026, 7, 31, 10, 32).toISOString(), now)).toBe('今天 10:32');
    expect(formatInspectorDate('not-a-date', now)).toBe('未知');
  });

  it('formats compact moments relative to today', () => {
    const now = new Date(2026, 9, 14, 12, 0);
    expect(formatInspectorMoment(new Date(2026, 9, 14, 9, 5).toISOString(), now)).toBe('今天 09:05');
    expect(formatInspectorMoment(new Date(2026, 9, 13, 23, 35).toISOString(), now)).toBe('昨天 23:35');
    expect(formatInspectorMoment(new Date(2026, 5, 14, 15, 38).toISOString(), now)).toBe('6月14日 15:38');
    expect(formatInspectorMoment(new Date(2025, 5, 14, 15, 38).toISOString(), now)).toBe('2025年6月14日');
    expect(formatInspectorDay(new Date(2026, 5, 14).toISOString(), now)).toBe('6月14日');
    expect(formatInspectorMoment(undefined, now)).toBe('未知');
  });
});

function createNote(id: string, internalLinks: string[]): Note {
  return {
    id,
    title: id,
    folderId: null,
    tagIds: [],
    internalLinks,
    rawMarkdown: '',
    contentLoaded: true,
    favorite: false,
    deleted: false
  };
}

function createFolder(id: string, name: string, parentId: string | null): Folder {
  return { id, name, parentId, children: [] }
}
