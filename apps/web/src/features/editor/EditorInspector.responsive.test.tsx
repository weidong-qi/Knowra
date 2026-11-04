import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EditorInspector, type EditorInspectorProps } from './EditorInspector';

afterEach(() => vi.unstubAllGlobals());

it.each([
  { name: '960px 浏览器/平板', compact: true, nativeTitlebar: false, modal: true },
  { name: '960px 原生桌面标题栏', compact: true, nativeTitlebar: true, modal: false },
  { name: '1440px 细指针浏览器', compact: false, nativeTitlebar: false, modal: false }
])('$name 的检查器使用对应模态语义', ({ compact, nativeTitlebar, modal }) => {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: query.includes('max-width: 1100px') && compact, media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn()
  })));
  const note = { id: 'note', spaceId: 'space', title: '合成检查器', rawMarkdown: '正文', folderId: null,
    tagIds: [], internalLinks: [], contentLoaded: true, favorite: false, deleted: false };
  const props = { nativeTitlebar, note, notes: [note], folder: null, foldersById: {}, tags: [], markdown: '正文',
    open: true, canWrite: false, canInsertAttachment: false, attachments: [], attachmentsLoading: false,
    linkedNotes: [], linkedNotesLoading: false, annotations: [], annotationsLoading: false,
    focusedAnnotationId: null, onClose: vi.fn() } as unknown as EditorInspectorProps;
  render(<EditorInspector {...props} />);
  expect(screen.getByRole('complementary', { name: '文档检查器' })).toBeVisible();
  expect(screen.queryByRole('dialog', { name: '文档检查器' }) !== null).toBe(modal);
});
