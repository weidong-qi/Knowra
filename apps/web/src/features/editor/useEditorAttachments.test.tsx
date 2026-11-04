import { act, renderHook, waitFor } from '@testing-library/react';
import type { Dispatch, MouseEvent, SetStateAction } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Attachment } from '@study-accelerator/web-core';
import * as desktopLifecycle from '../../app/desktopLifecycle';
import type { EditorCommandTarget } from './editorCommands';
import type { AttachmentActions } from './EditorAttachmentPanel';
import { downloadAttachment, fetchAttachmentBlob } from './attachmentAccess';
import { buildAttachmentReferenceUrl } from './attachmentFiles';
import { useEditorAttachments } from './useEditorAttachments';

vi.mock('./attachmentAccess', () => ({ downloadAttachment: vi.fn(), fetchAttachmentBlob: vi.fn() }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const attachment = { id: 'attachment-1', noteId: 'note-1', fileName: '合成附件.txt', mimeType: 'text/plain', size: 4, status: 'ready' } as Attachment;
const picture = { ...attachment, id: 'picture-1', fileName: '合成图片.png', mimeType: 'image/png' };
const imageFile = () => new File(['synthetic'], '合成图片.png', { type: 'image/png' });
function fixture() {
  const editor = { getMarkdown: vi.fn(() => '正文'), insertImage: vi.fn(() => true), insertLink: vi.fn(() => true) };
  const options = {
    noteId: 'note-1', canWrite: true, showSourceEditor: false, extendedWritesEnabled: true,
    editorRef: { current: editor as unknown as EditorCommandTarget | null },
    autosave: { getLatestMarkdown: vi.fn(() => '正文'), saveNow: vi.fn(async (_markdown?: string) => {}) },
    attachments: [attachment, picture], setAttachments: vi.fn<Dispatch<SetStateAction<Attachment[]>>>(),
    attachmentActions: {
      inspectAttachmentDeletion: vi.fn(), listAttachmentCleanup: vi.fn(), retryAttachmentCleanup: vi.fn(),
      verifyNoteAttachment: vi.fn(async (_id: string) => attachment),
      restoreNoteAttachment: vi.fn(async (_id: string, _bytes: string) => attachment)
    } as AttachmentActions,
    onListAttachments: vi.fn(async (_id: string) => [attachment, picture]),
    onUploadAttachment: vi.fn(async () => picture),
    onRenameAttachment: vi.fn(async (_id: string, _name: string) => ({ ...attachment, fileName: '新名称.txt' })),
    onDeleteAttachment: vi.fn(async (_id: string) => {}), onFileStatus: vi.fn()
  };
  return { options, editor };
}
function linkEvent(id: string, button = 0) {
  const anchor = document.createElement('a');
  anchor.href = id.startsWith('https:') ? id : buildAttachmentReferenceUrl(id);
  const child = document.createElement('span'); anchor.append(child);
  return { button, target: child, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as MouseEvent<HTMLDivElement>;
}
beforeEach(() => {
  vi.mocked(fetchAttachmentBlob).mockResolvedValue(new Blob(['synthetic']));
  vi.mocked(downloadAttachment).mockResolvedValue('saved-token');
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:synthetic');
    static revokeObjectURL = vi.fn();
  });
});
afterEach(() => { delete window.knowraDesktop; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('编辑器附件上传与写回', () => {
  it('文件上传独立跟踪桌面任务，退出屏障等待上传完成；图片插入也跟踪完整外层链', async () => {
    const { options, editor } = fixture(); const pending = deferred<Attachment>();
    options.onUploadAttachment.mockReturnValueOnce(pending.promise);
    const tracked = vi.spyOn(desktopLifecycle, 'trackDesktopTask');
    const { result } = renderHook(() => useEditorAttachments(options));
    let upload!: Promise<Attachment>;
    act(() => { upload = result.current.uploadAttachmentFile(imageFile()); });
    await waitFor(() => expect(options.onUploadAttachment).toHaveBeenCalledOnce());
    expect(options.onUploadAttachment).toHaveBeenCalledWith(expect.objectContaining({ noteId: 'note-1', mimeType: 'image/png', contentBase64: 'c3ludGhldGlj' }));
    let flushed = false;
    const flush = desktopLifecycle.flushBeforeWorkspaceRestore().then(() => { flushed = true; });
    await new Promise(resolve => setTimeout(resolve, 10)); expect(flushed).toBe(false);
    await act(async () => { pending.resolve(picture); await upload; await flush; });
    expect(options.setAttachments.mock.calls[0][0]).toBeTypeOf('function');
    const update = options.setAttachments.mock.calls[0][0] as (rows: Attachment[]) => Attachment[];
    expect(update([attachment, picture])).toEqual([picture, attachment]);
    expect(tracked).toHaveBeenCalledTimes(1);
    await act(async () => { await result.current.insertImageFile(imageFile()); });
    expect(tracked).toHaveBeenCalledTimes(3);
    expect(editor.insertImage).toHaveBeenCalledWith(buildAttachmentReferenceUrl(picture.id), picture.fileName);
  });

  it('上传图片失败不插入，失败后可重试；无效图片在上传前拒绝', async () => {
    const { options, editor } = fixture(); options.onUploadAttachment.mockRejectedValueOnce(new Error('上传失败'));
    const { result } = renderHook(() => useEditorAttachments(options));
    await expect(result.current.insertImageFile(imageFile())).rejects.toThrow('上传失败');
    expect(editor.insertImage).not.toHaveBeenCalled();
    await expect(result.current.insertImageFile(new File(['x'], 'x.txt', { type: 'text/plain' }))).rejects.toThrow('正文图片仅支持');
    expect(options.onUploadAttachment).toHaveBeenCalledTimes(1);
    await act(async () => { await result.current.insertImageFile(imageFile()); });
    expect(editor.insertImage).toHaveBeenCalledOnce();
  });

  it('上传期间切换笔记不写回新列表或向新编辑器插图，但返回已上传的附件', async () => {
    const { options, editor } = fixture(); const pending = deferred<Attachment>(); options.onUploadAttachment.mockReturnValue(pending.promise);
    const { result, rerender } = renderHook(props => useEditorAttachments(props), { initialProps: options });
    let error!: Promise<unknown>;
    act(() => { error = result.current.insertImageFile(imageFile()).catch(cause => cause); });
    await waitFor(() => expect(options.onUploadAttachment).toHaveBeenCalled());
    rerender({ ...options, noteId: 'note-2' });
    await act(async () => { pending.resolve(picture); });
    expect(await error).toEqual(new Error('图片已上传，笔记已切换，未插入正文'));
    expect(options.setAttachments).not.toHaveBeenCalled(); expect(editor.insertImage).not.toHaveBeenCalled();
  });

  it('Milkdown 上传只返回引用，由原编辑器处理选区；能力关闭不上传', async () => {
    const { options, editor } = fixture();
    const { result, rerender } = renderHook(props => useEditorAttachments(props), { initialProps: options });
    await expect(result.current.uploadEditorImage(imageFile())).resolves.toEqual({ url: buildAttachmentReferenceUrl(picture.id), alt: picture.fileName });
    expect(editor.insertImage).not.toHaveBeenCalled();
    rerender({ ...options, extendedWritesEnabled: false });
    await expect(result.current.uploadEditorImage(imageFile())).rejects.toThrow('离线附件上传尚未开放');
    expect(options.onUploadAttachment).toHaveBeenCalledTimes(1);
  });

  it('已有附件分别插入图片和链接；非 ready 或编辑器拒绝时不报告成功', async () => {
    const { options, editor } = fixture(); const { result } = renderHook(() => useEditorAttachments(options));
    await result.current.insertStoredAttachment(attachment); await result.current.insertStoredAttachment(picture);
    expect(editor.insertLink).toHaveBeenCalledWith(buildAttachmentReferenceUrl(attachment.id), attachment.fileName);
    expect(editor.insertImage).toHaveBeenCalledWith(buildAttachmentReferenceUrl(picture.id), picture.fileName);
    await expect(result.current.insertStoredAttachment({ ...picture, status: 'missing' })).rejects.toThrow('附件尚不可用');
    editor.insertImage.mockReturnValue(false);
    await expect(result.current.insertStoredAttachment(picture)).rejects.toThrow('当前编辑状态无法插入附件');
    expect(options.onFileStatus).toHaveBeenCalledTimes(2);
  });

  it.each(['rename', 'verify', 'restore', 'refresh'] as const)('%s 的结果更新当前列表，但切笔记后的迟到结果不污染新列表', async kind => {
    const { options } = fixture(); const pending = deferred<any>(); const updated = { ...attachment, fileName: '新名称.txt' };
    const invoke = (current: ReturnType<typeof useEditorAttachments>) => kind === 'rename' ? current.renameAttachment(attachment.id, updated.fileName)
      : kind === 'verify' ? current.actions!.verifyNoteAttachment(attachment.id)
      : kind === 'restore' ? current.actions!.restoreNoteAttachment(attachment.id, 'eA==') : current.actions!.refreshAttachments!();
    const callback = kind === 'rename' ? options.onRenameAttachment : kind === 'verify' ? options.attachmentActions.verifyNoteAttachment
      : kind === 'restore' ? options.attachmentActions.restoreNoteAttachment : options.onListAttachments;
    vi.mocked(callback as (...args: never[]) => Promise<unknown>).mockResolvedValueOnce(kind === 'refresh' ? [updated] : updated).mockReturnValueOnce(pending.promise);
    const { result, rerender } = renderHook(props => useEditorAttachments(props), { initialProps: options });
    await act(async () => { await invoke(result.current); });
    const change = options.setAttachments.mock.calls[0][0];
    expect(typeof change === 'function' ? change([attachment]) : change).toEqual([updated]);
    options.setAttachments.mockClear();
    const request = invoke(result.current); rerender({ ...options, noteId: 'note-2' });
    await act(async () => { pending.resolve(kind === 'refresh' ? [updated] : updated); await request; });
    expect(options.setAttachments).not.toHaveBeenCalled();
  });
});

describe('附件删除的保存与引用屏障', () => {
  it.each([false, true])('showSourceEditor=%s：删除前保存对应正文，成功后才移除列表', async source => {
    const { options, editor } = fixture(); options.showSourceEditor = source;
    editor.getMarkdown.mockReturnValue(source ? '编辑器旧正文' : '正文');
    const order: string[] = [];
    options.autosave.saveNow.mockImplementation(async () => { order.push('save'); });
    options.onDeleteAttachment.mockImplementation(async () => { order.push('delete'); });
    const { result } = renderHook(() => useEditorAttachments(options));
    await result.current.deleteAttachment(attachment.id);
    expect(order).toEqual(['save', 'delete']); expect(options.autosave.saveNow).toHaveBeenCalledWith('正文');
    const update = options.setAttachments.mock.calls[0][0] as (rows: Attachment[]) => Attachment[];
    expect(update([attachment, picture])).toEqual([picture]);
  });
  it.each(['reference', 'save-failure', 'new-reference', 'new-text', 'note', 'readonly', 'delete-failure'])('%s 阻断删除或保留列表，不跳过二次验证', async change => {
    const { options, editor } = fixture(); const pending = deferred<void>();
    const reference = `[附件](${buildAttachmentReferenceUrl(attachment.id)})`;
    if (change === 'reference') editor.getMarkdown.mockReturnValue(reference);
    if (change === 'save-failure') options.autosave.saveNow.mockRejectedValue(new Error('保存冲突'));
    else options.autosave.saveNow.mockReturnValue(pending.promise);
    if (change === 'delete-failure') options.onDeleteAttachment.mockRejectedValue(new Error('删除失败'));
    const { result, rerender } = renderHook(props => useEditorAttachments(props), { initialProps: options });
    const outcome = result.current.deleteAttachment(attachment.id).catch(cause => cause);
    if (change === 'new-reference') options.autosave.getLatestMarkdown.mockReturnValue(reference);
    if (change === 'new-text') options.autosave.getLatestMarkdown.mockReturnValue('新正文');
    if (change === 'note') rerender({ ...options, noteId: 'note-2' });
    if (change === 'readonly') rerender({ ...options, canWrite: false });
    pending.resolve();
    expect(await outcome).toBeInstanceOf(Error);
    if (change !== 'delete-failure') expect(options.onDeleteAttachment).not.toHaveBeenCalled();
    expect(options.setAttachments).not.toHaveBeenCalled();
    if (change === 'reference') expect(options.autosave.saveNow).not.toHaveBeenCalled();
  });
  it('删除请求成功期间切换笔记，不删除新笔记的列表项', async () => {
    const { options } = fixture(); const pending = deferred<void>(); options.onDeleteAttachment.mockReturnValue(pending.promise);
    const { result, rerender } = renderHook(props => useEditorAttachments(props), { initialProps: options });
    const request = result.current.deleteAttachment(attachment.id);
    await waitFor(() => expect(options.onDeleteAttachment).toHaveBeenCalled());
    rerender({ ...options, noteId: 'note-2' }); pending.resolve(); await request;
    expect(options.setAttachments).not.toHaveBeenCalled();
  });
});

describe('正文附件链接与反馈生命周期', () => {
  it.each([0, 1])('捕获 %s 键附件链接并打开图片，非附件/右键继续传播', async button => {
    const { options } = fixture(); const { result } = renderHook(() => useEditorAttachments(options));
    const event = linkEvent(picture.id, button);
    act(() => result.current.handleAttachmentLink(event));
    await waitFor(() => expect(result.current.bodyPreview?.name).toBe(picture.fileName));
    expect(event.preventDefault).toHaveBeenCalledOnce(); expect(event.stopPropagation).toHaveBeenCalledOnce();
    for (const ignored of [linkEvent('https://example.com'), linkEvent(picture.id, 2)]) {
      act(() => result.current.handleAttachmentLink(ignored)); expect(ignored.preventDefault).not.toHaveBeenCalled();
    }
    expect(fetchAttachmentBlob).toHaveBeenCalledTimes(1);
  });
  it.each(['replace', 'close', 'note', 'unmount'])('%s 释放图片对象 URL', async change => {
    const { options } = fixture();
    vi.mocked(URL.createObjectURL).mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second');
    const { result, rerender, unmount } = renderHook(props => useEditorAttachments(props), { initialProps: options });
    act(() => result.current.handleAttachmentLink(linkEvent(picture.id)));
    await waitFor(() => expect(result.current.bodyPreview?.url).toBe('blob:first'));
    if (change === 'replace') {
      act(() => result.current.handleAttachmentLink(linkEvent(picture.id)));
      await waitFor(() => expect(result.current.bodyPreview?.url).toBe('blob:second'));
    }
    if (change === 'close') act(() => result.current.closePreview());
    if (change === 'note') rerender({ ...options, noteId: 'note-2' });
    if (change === 'unmount') unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:first');
  });
  it.each(['image', 'download'])('%s 迟到成功不向切换后的笔记发布反馈', async kind => {
    const { options } = fixture(); const pending = deferred<any>();
    if (kind === 'image') vi.mocked(fetchAttachmentBlob).mockReturnValueOnce(pending.promise);
    else vi.mocked(downloadAttachment).mockReturnValueOnce(pending.promise);
    const { result, rerender } = renderHook(props => useEditorAttachments(props), { initialProps: options });
    act(() => result.current.handleAttachmentLink(linkEvent(kind === 'image' ? picture.id : attachment.id)));
    rerender({ ...options, noteId: 'note-2' });
    await act(async () => { pending.resolve(kind === 'image' ? new Blob(['image']) : 'token'); await pending.promise; });
    expect(result.current.bodyPreview).toBeNull(); expect(result.current.bodySavedToken).toBeNull(); expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it('无缓存附件查全量列表；非 ready 反馈并刷新当前笔记，不读文件', async () => {
    const { options } = fixture(); options.attachments = []; options.onListAttachments.mockResolvedValue([{ ...picture, status: 'missing' }]);
    const { result } = renderHook(() => useEditorAttachments(options));
    act(() => result.current.handleAttachmentLink(linkEvent(picture.id)));
    await waitFor(() => expect(options.onFileStatus).toHaveBeenCalledWith('附件尚不可用，请先核验或恢复原文件'));
    expect(options.onListAttachments.mock.calls).toEqual([[''], ['note-1']]);
    expect(fetchAttachmentBlob).not.toHaveBeenCalled(); expect(options.setAttachments).toHaveBeenCalled();
  });
  it('正文读取失败后刷新也失败仍保留原反馈，不覆盖列表', async () => {
    const { options } = fixture(); vi.mocked(fetchAttachmentBlob).mockRejectedValueOnce(new Error('读取失败')); options.onListAttachments.mockRejectedValueOnce(new Error('刷新失败'));
    const { result } = renderHook(() => useEditorAttachments(options));
    await act(async () => { result.current.handleAttachmentLink(linkEvent(picture.id)); });
    expect(options.onFileStatus).toHaveBeenCalledWith('读取失败'); expect(options.setAttachments).not.toHaveBeenCalled();
  });
  it('桌面保存 token 打开/报错/关闭，切笔记清空；Web null token 不显示保存提示', async () => {
    const { options } = fixture();
    const open = vi.fn().mockRejectedValueOnce(new Error('打开失败'));
    window.knowraDesktop = { openSavedAttachment: open, onPrepareClose: vi.fn(), onCancelClose: vi.fn() };
    const { result, rerender } = renderHook(props => useEditorAttachments(props), { initialProps: options });
    act(() => result.current.handleAttachmentLink(linkEvent(attachment.id)));
    await waitFor(() => expect(result.current.bodySavedToken).toBe('saved-token'));
    await act(async () => result.current.openSavedAttachment());
    expect(open).toHaveBeenCalledWith('saved-token'); expect(options.onFileStatus).toHaveBeenCalledWith('Error: 打开失败');
    act(() => result.current.dismissDownload()); expect(result.current.bodySavedToken).toBeNull();
    act(() => result.current.handleAttachmentLink(linkEvent(attachment.id)));
    await waitFor(() => expect(result.current.bodySavedToken).toBe('saved-token'));
    rerender({ ...options, noteId: 'note-2' }); expect(result.current.bodySavedToken).toBeNull();
    vi.mocked(downloadAttachment).mockResolvedValueOnce(null);
    await act(async () => result.current.handleAttachmentLink(linkEvent(attachment.id)));
    expect(result.current.bodySavedToken).toBeNull();
  });
});
