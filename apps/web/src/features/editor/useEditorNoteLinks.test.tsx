import { StrictMode, type PropsWithChildren } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { calculateContentHash } from '@study-accelerator/content-anchor';
import type { Note, NoteLinkRelations } from '@study-accelerator/web-core';
import type { EditorCommandTarget } from './editorCommands';
import { requestNoteLinkNavigation, takeNoteLinkNavigation } from './editorLinkNavigation';
import { useEditorNoteLinks } from './useEditorNoteLinks';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture() {
  const note = { id: 'note-1', spaceId: 'space-1', rawMarkdown: '正文' } as Note;
  const relation: NoteLinkRelations = { noteId: note.id, spaceId: note.spaceId!, contentHash: calculateContentHash(note.rawMarkdown),
    outgoing: [{ id: 'target', title: '目标', folderId: null, status: 'active', occurrences: [] }], backlinks: [] };
  const editor = { getMarkdown: vi.fn(() => '正文'), applyNoteLinkEdit: vi.fn(() => true), focus: vi.fn(),
    matchesMarkdownDocument: vi.fn(() => true), selectNoteLinkOccurrence: vi.fn(() => true) };
  const options = { note: note as Note | null, canWrite: true, canEditContent: true, refreshKey: 0,
    editorRef: { current: editor as unknown as EditorCommandTarget },
    autosave: { getLatestMarkdown: vi.fn(() => '草稿'), saveNow: vi.fn(async (_markdown?: string) => {}), hasLocalChanges: false },
    onGetNoteLinkRelations: vi.fn(async (_id: string) => relation), onOpenNote: vi.fn(), onFileStatus: vi.fn(),
    saveCurrentScrollPosition: vi.fn(), restoreCurrentScrollPosition: vi.fn(async () => {}) };
  return { options, editor, relation };
}
const locator = { targetNoteId: 'target', occurrenceId: 'ref-test' };

describe('编辑器链接会话与导航生命周期', () => {
  it('先保存，再核验存活关系，记住滚动位置后打开目标', async () => {
    const { options } = fixture(); const order: string[] = [];
    const { result } = renderHook(() => useEditorNoteLinks(options));
    options.autosave.saveNow.mockImplementation(async () => { order.push('save'); });
    options.onGetNoteLinkRelations.mockImplementationOnce(async () => { order.push('relations'); return fixture().relation; });
    options.saveCurrentScrollPosition.mockImplementation(() => { order.push('scroll'); });
    options.onOpenNote.mockImplementation(() => { order.push('open'); });
    await act(async () => { await result.current.openLinkedNote('target'); });
    expect(order).toEqual(['save', 'relations', 'scroll', 'open']);
    expect(options.autosave.saveNow).toHaveBeenCalledWith('正文');
    expect(options.onOpenNote).toHaveBeenCalledWith('target');
  });

  it.each(['save', 'relations'].flatMap(phase => ['note', 'roundtrip', 'scope', 'readonly', 'document', 'unmount'].map(change => [phase, change])))('%s 期间 %s 改变不发布迟到导航', async (phase, change) => {
    const { options, editor, relation } = fixture();
    const save = deferred<void>(); const lookup = deferred<NoteLinkRelations>();
    const { result, rerender, unmount } = renderHook(props => useEditorNoteLinks(props), { initialProps: options });
    if (phase === 'save') options.autosave.saveNow.mockReturnValueOnce(save.promise);
    else options.onGetNoteLinkRelations.mockReturnValueOnce(lookup.promise);
    let pending!: Promise<void>;
    await act(async () => { pending = result.current.openLinkedNote('target'); await Promise.resolve(); });
    if (change === 'note' || change === 'roundtrip') rerender({ ...options, note: { ...options.note!, id: 'note-2' } });
    if (change === 'roundtrip') rerender(options);
    if (change === 'scope') rerender({ ...options, note: { ...options.note!, spaceId: 'space-2' } });
    if (change === 'readonly') rerender({ ...options, canWrite: false, canEditContent: false });
    if (change === 'document') editor.getMarkdown.mockReturnValue('后续修改');
    if (change === 'unmount') unmount();
    await act(async () => { save.resolve(); lookup.resolve(relation); await pending; });
    expect(options.onOpenNote).not.toHaveBeenCalled();
    expect(options.saveCurrentScrollPosition).not.toHaveBeenCalled();
    if (change === 'unmount') expect(options.onFileStatus).not.toHaveBeenCalled();
    else expect(options.onFileStatus).toHaveBeenCalledWith(expect.stringContaining('来源已变化'));
  });

  it.each(['save-failure', 'wrong-note', 'wrong-space', 'deleted', 'missing', 'readonly-draft'])('%s 阻止导航并给出可重试说明', async reason => {
    const { options, relation } = fixture();
    if (reason === 'readonly-draft') { options.canWrite = false; options.autosave.hasLocalChanges = true; }
    const { result } = renderHook(() => useEditorNoteLinks(options));
    if (reason === 'save-failure') options.autosave.saveNow.mockRejectedValueOnce(new Error('合成保存失败'));
    if (reason === 'wrong-note') options.onGetNoteLinkRelations.mockResolvedValue({ ...relation, noteId: 'other' });
    if (reason === 'wrong-space') options.onGetNoteLinkRelations.mockResolvedValue({ ...relation, spaceId: 'other' });
    if (reason === 'deleted') options.onGetNoteLinkRelations.mockResolvedValue({ ...relation, outgoing: [{ ...relation.outgoing[0], status: 'deleted' }] });
    if (reason === 'missing') options.onGetNoteLinkRelations.mockResolvedValue({ ...relation, outgoing: [] });
    await act(async () => { await result.current.openLinkedNote('target'); });
    expect(options.onOpenNote).not.toHaveBeenCalled();
    expect(options.onFileStatus).toHaveBeenCalledOnce();
  });

  it('同上下文普通重渲染不取消导航，保存失败后可以重试', async () => {
    const { options } = fixture(); const save = deferred<void>();
    const { result, rerender } = renderHook(props => useEditorNoteLinks(props), { initialProps: options });
    options.autosave.saveNow.mockRejectedValueOnce(new Error('暂时失败'));
    await act(async () => { await result.current.openLinkedNote('target'); });
    expect(options.onOpenNote).not.toHaveBeenCalled();
    options.autosave.saveNow.mockReturnValueOnce(save.promise);
    let pending!: Promise<void>; act(() => { pending = result.current.openLinkedNote('target'); });
    rerender({ ...options, note: { ...options.note! }, refreshKey: 1 });
    await act(async () => { save.resolve(); await pending; });
    expect(options.onOpenNote).toHaveBeenCalledOnce();
  });

  it('无本地草稿的只读笔记仍能导航，不触发保存', async () => {
    const { options } = fixture(); options.canWrite = false; options.canEditContent = false;
    const { result } = renderHook(() => useEditorNoteLinks(options));
    await act(async () => { await result.current.openLinkedNote('target'); });
    expect(options.onOpenNote).toHaveBeenCalledWith('target');
    expect(options.autosave.saveNow).not.toHaveBeenCalled();
  });

  it('移除链接保留 null 目标并保存，当前选区失效则不保存', async () => {
    const { options, editor } = fixture();
    const { result } = renderHook(() => useEditorNoteLinks(options));
    const session = { document: {}, from: 1, to: 3, label: '文字' };
    act(() => result.current.requestLink(session));
    await act(async () => { await result.current.applyLink(null, '文字'); });
    expect(editor.applyNoteLinkEdit).toHaveBeenCalledWith(session, null, '文字');
    expect(options.autosave.saveNow).toHaveBeenCalledOnce();
    editor.applyNoteLinkEdit.mockReturnValue(false);
    await expect(result.current.applyLink(null, '文字')).rejects.toThrow('正文或选区已变化');
    expect(options.autosave.saveNow).toHaveBeenCalledOnce();
  });

  it('反向引用查询来源笔记，待视口恢复后才消费与定位', async () => {
    const { options, relation, editor } = fixture();
    const { result, rerender } = renderHook(props => useEditorNoteLinks(props), { initialProps: options });
    options.onGetNoteLinkRelations.mockResolvedValue({ ...relation, noteId: 'source' });
    await act(async () => { await result.current.openLinkedNote('source', locator); });
    expect(options.onGetNoteLinkRelations).toHaveBeenLastCalledWith('source');
    expect(options.onOpenNote).toHaveBeenCalledWith('source');
    const restore = deferred<void>();
    options.restoreCurrentScrollPosition.mockReturnValueOnce(restore.promise);
    rerender({ ...options, note: { ...options.note!, id: 'source' } });
    let pending!: Promise<void>;
    act(() => { pending = result.current.onReady(); });
    expect(editor.selectNoteLinkOccurrence).not.toHaveBeenCalled();
    await act(async () => { restore.resolve(); await pending; });
    expect(editor.selectNoteLinkOccurrence).toHaveBeenCalledWith(locator);
    expect(result.current.navigationNotice).toBe(false);
    expect(takeNoteLinkNavigation('source', 'space-1')).toBeNull();
  });

  it.each(['roundtrip', 'scope', 'unmount'])('视口恢复期间 %s 变化不消费待定位请求', async change => {
    const { options, editor } = fixture(); const restore = deferred<void>();
    options.restoreCurrentScrollPosition.mockReturnValueOnce(restore.promise);
    const { result, rerender, unmount } = renderHook(props => useEditorNoteLinks(props), { initialProps: options });
    requestNoteLinkNavigation('note-1', 'space-1', locator, calculateContentHash('正文'));
    let pending!: Promise<void>; act(() => { pending = result.current.onReady(); });
    if (change === 'roundtrip') { rerender({ ...options, note: { ...options.note!, id: 'note-2' } }); rerender(options); }
    if (change === 'scope') rerender({ ...options, note: { ...options.note!, spaceId: 'space-2' } });
    if (change === 'unmount') unmount();
    await act(async () => { restore.resolve(); await pending; });
    expect(editor.selectNoteLinkOccurrence).not.toHaveBeenCalled();
    expect(takeNoteLinkNavigation('note-1', 'space-1')).toEqual({ locator, contentHash: calculateContentHash('正文') });
  });

  it.each(['hash', 'document', 'position'])('来源 %s 不符保留提示，关闭提示不更改正文', async reason => {
    const { options, editor } = fixture();
    if (reason === 'document') editor.matchesMarkdownDocument.mockReturnValue(false);
    if (reason === 'position') editor.selectNoteLinkOccurrence.mockReturnValue(false);
    const { result } = renderHook(() => useEditorNoteLinks(options), { wrapper: ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode> });
    requestNoteLinkNavigation('note-1', 'space-1', locator, calculateContentHash(reason === 'hash' ? '旧正文' : '正文'));
    await act(async () => { await result.current.onReady(); });
    expect(result.current.navigationNotice).toBe(true);
    act(() => result.current.dismissNavigationNotice());
    expect(result.current.navigationNotice).toBe(false);
    expect(options.autosave.saveNow).not.toHaveBeenCalled();
  });

  it('编辑会话只在当前笔记与资料集中展示，应用成功后保存', async () => {
    const { options, editor } = fixture();
    const { result, rerender } = renderHook(props => useEditorNoteLinks(props), { initialProps: options });
    const session = { document: {}, from: 1, to: 3, label: '文字' };
    act(() => result.current.requestLink(session));
    expect(result.current.editSession).toBe(session);
    const apply = result.current.applyLink;
    rerender({ ...options, note: { ...options.note!, spaceId: 'space-2' } });
    expect(result.current.editSession).toBeUndefined();
    await expect(apply('target', '标题')).rejects.toThrow('正文或选区已变化');
    expect(editor.applyNoteLinkEdit).not.toHaveBeenCalled();
    rerender(options);
    await act(async () => { await result.current.applyLink('target', '标题'); });
    expect(editor.applyNoteLinkEdit).toHaveBeenCalledWith(session, 'target', '标题');
    expect(options.autosave.saveNow).toHaveBeenCalledWith('正文');
    editor.applyNoteLinkEdit.mockReturnValue(false);
    await expect(result.current.applyLink('target', '标题')).rejects.toThrow('正文或选区已变化');
    expect(options.autosave.saveNow).toHaveBeenCalledOnce();
  });
});
