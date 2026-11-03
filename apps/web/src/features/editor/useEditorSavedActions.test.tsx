import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AnalysisScopeInput, AnalysisScopePreview, Annotation, Note, NoteVersion } from '@study-accelerator/web-core';
import type { EditorCommandTarget } from './editorCommands';
import { useEditorSavedActions } from './useEditorSavedActions';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const version = { id: 'version-1', noteId: 'note-1', content: '历史正文' } as NoteVersion;
const annotation = { id: 'annotation-1', noteId: 'note-1' } as Annotation;
const input: AnalysisScopeInput = { spaceId: 'space-1', mode: 'all', noteIds: ['note-1'] };
function fixture() {
  let draft = '源码草稿';
  let rich = '富文本草稿';
  const editor = { getMarkdown: vi.fn(() => rich), setMarkdown: vi.fn((value: string) => { rich = value; }) };
  const options = {
    note: { id: 'note-1', spaceId: 'space-1' } as Note | null,
    canWrite: true, showSourceEditor: false, extractionScope: {},
    editorRef: { current: editor as unknown as EditorCommandTarget | null },
    autosave: {
      getLatestMarkdown: vi.fn(() => draft),
      updateDraft: vi.fn((value: string) => { draft = value; }),
      saveNow: vi.fn(async (_value?: string) => {})
    },
    onPreviewAnalysisScope: vi.fn(async (_input: AnalysisScopeInput) => ({ previewHash: 'preview-1' } as AnalysisScopePreview)),
    onCreateKnowledgeCandidate: vi.fn(async (_annotation: Annotation) => {}),
    onExtractWithAssistant: vi.fn((_noteId: string) => {}),
    onSaveVersionAs: vi.fn(async (_version: NoteVersion) => {}), onFileStatus: vi.fn()
  };
  return { options, editor, type: (value: string) => { draft = value; rich = value; } };
}
type Actions = ReturnType<typeof useEditorSavedActions>;
const actions: [string, (actions: Actions) => Promise<unknown>][] = [
  ['历史恢复', actions => actions.restoreVersion(version)],
  ['历史另存', actions => actions.saveVersionAs!(version)],
  ['分析预览', actions => actions.previewAnalysis!(input)],
  ['知识候选', actions => actions.createKnowledgeCandidate!(annotation)],
  ['助手跳转', actions => actions.extractWithAssistant!()]
];
function expectNoContinuation(options: ReturnType<typeof fixture>['options']) {
  expect(options.autosave.updateDraft).not.toHaveBeenCalled();
  expect(options.onPreviewAnalysisScope).not.toHaveBeenCalled();
  expect(options.onCreateKnowledgeCandidate).not.toHaveBeenCalled();
  expect(options.onExtractWithAssistant).not.toHaveBeenCalled();
  expect(options.onSaveVersionAs).not.toHaveBeenCalled();
}

describe.each(actions)('%s 保存边界', (_name, invoke) => {
  it.each([false, true])('从当前正文入口读取并先保存（源码 %s）', async showSourceEditor => {
    const { options } = fixture(); options.showSourceEditor = showSourceEditor;
    const pending = deferred<void>(); options.autosave.saveNow.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useEditorSavedActions(options));
    const operation = invoke(result.current);
    expect(options.autosave.saveNow).toHaveBeenCalledWith(showSourceEditor ? '源码草稿' : '富文本草稿');
    expectNoContinuation(options);
    await act(async () => { pending.resolve(); await operation; });
    if (_name === '历史恢复') expect(options.autosave.saveNow).toHaveBeenLastCalledWith(version.content);
    if (_name === '历史另存') expect(options.onSaveVersionAs).toHaveBeenCalledExactlyOnceWith(version);
    if (_name === '分析预览') expect(options.onPreviewAnalysisScope).toHaveBeenCalledExactlyOnceWith(input);
    if (_name === '知识候选') expect(options.onCreateKnowledgeCandidate).toHaveBeenCalledExactlyOnceWith(annotation);
    if (_name === '助手跳转') expect(options.onExtractWithAssistant).toHaveBeenCalledExactlyOnceWith('note-1');
  });

  it('保存失败保留草稿，不发出后续动作', async () => {
    const { options } = fixture(); options.autosave.saveNow.mockRejectedValueOnce(new Error('合成保存失败'));
    const { result } = renderHook(() => useEditorSavedActions(options));
    await expect(invoke(result.current)).rejects.toThrow('合成保存失败');
    expectNoContinuation(options);
    expect(options.autosave.getLatestMarkdown()).toBe('源码草稿');
  });

  it.each(['继续输入', '笔记往返', '空间往返', '权限往返', '环境往返', '源码往返', '编辑器替换', '卸载'])('%s 使等待中的操作失效', async change => {
    const fixtureState = fixture(); const { options } = fixtureState;
    const pending = deferred<void>(); options.autosave.saveNow.mockReturnValueOnce(pending.promise);
    const { result, rerender, unmount } = renderHook(props => useEditorSavedActions(props), { initialProps: options });
    const operation = invoke(result.current).catch(error => error);
    const transitions = {
      '笔记往返': { ...options, note: { ...options.note!, id: 'note-2' } },
      '空间往返': { ...options, note: { ...options.note!, spaceId: 'space-2' } },
      '权限往返': { ...options, canWrite: false },
      '环境往返': { ...options, extractionScope: {} },
      '源码往返': { ...options, showSourceEditor: true }
    };
    if (change in transitions) {
      rerender(transitions[change as keyof typeof transitions]); rerender(options);
    } else if (change === '继续输入') fixtureState.type('保存期间的新正文');
    else if (change === '编辑器替换') options.editorRef.current = { ...options.editorRef.current! };
    else unmount();
    await act(async () => { pending.resolve(); expect(await operation).toBeInstanceOf(Error); });
    expectNoContinuation(options);
    expect(options.autosave.saveNow).toHaveBeenCalledOnce();
  });

  it('已过期的回调不能在新会话启动保存', async () => {
    const { options } = fixture();
    const { result, rerender } = renderHook(props => useEditorSavedActions(props), { initialProps: options });
    const old = result.current;
    rerender({ ...options, note: { ...options.note!, id: 'other' } }); rerender(options);
    await expect(invoke(old)).rejects.toBeInstanceOf(Error);
    expect(options.autosave.saveNow).not.toHaveBeenCalled();
  });

  it('普通保存刷新 note 和回调身份不会误作废等待中的操作', async () => {
    const { options } = fixture(); const pending = deferred<void>(); options.autosave.saveNow.mockReturnValueOnce(pending.promise);
    const { result, rerender } = renderHook(props => useEditorSavedActions(props), { initialProps: options });
    const operation = invoke(result.current);
    rerender({ ...options, note: { ...options.note!, updatedAt: '2026-10-11T01:00:00Z' }, onFileStatus: vi.fn() });
    await act(async () => { pending.resolve(); await operation; });
  });
});

it('历史恢复先保存原正文，再更新编辑器和草稿、保存历史正文，最后提示成功', async () => {
  const { options, editor } = fixture(); const pending = deferred<void>();
  options.autosave.saveNow.mockResolvedValueOnce(undefined).mockReturnValueOnce(pending.promise);
  const { result } = renderHook(() => useEditorSavedActions(options));
  const operation = result.current.restoreVersion(version);
  await act(async () => { await Promise.resolve(); });
  expect(options.autosave.saveNow.mock.calls).toEqual([['富文本草稿'], ['历史正文']]);
  expect(options.autosave.updateDraft).toHaveBeenCalledWith('历史正文', { immediate: true });
  expect(editor.setMarkdown).toHaveBeenCalledWith('历史正文');
  expect(options.onFileStatus).not.toHaveBeenCalled();
  await act(async () => { pending.resolve(); await operation; });
  expect(options.onFileStatus).toHaveBeenCalledExactlyOnceWith('已恢复历史正文；恢复前的正文已保留在历史记录中');
});

it('恢复的最终保存失败不伪报成功，恢复草稿保留供 autosave 重试', async () => {
  const { options } = fixture();
  options.autosave.saveNow.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('最终保存失败'));
  const { result } = renderHook(() => useEditorSavedActions(options));
  await expect(result.current.restoreVersion(version)).rejects.toThrow('最终保存失败');
  expect(options.autosave.getLatestMarkdown()).toBe('历史正文');
  expect(options.onFileStatus).not.toHaveBeenCalled();
});

it('恢复已提交后切换笔记，允许保存回执完成但不向新笔记发布提示', async () => {
  const { options } = fixture(); const pending = deferred<void>();
  options.autosave.saveNow.mockResolvedValueOnce(undefined).mockReturnValueOnce(pending.promise);
  const { result, rerender } = renderHook(props => useEditorSavedActions(props), { initialProps: options });
  const operation = result.current.restoreVersion(version);
  await act(async () => { await Promise.resolve(); });
  expect(options.autosave.saveNow).toHaveBeenCalledTimes(2);
  rerender({ ...options, note: { ...options.note!, id: 'other' } });
  await act(async () => { pending.resolve(); await operation; });
  expect(options.onFileStatus).not.toHaveBeenCalled();
});

it.each(['继续输入', '环境往返', '卸载'])('预览响应返回前%s，不交付旧范围', async change => {
  const fixtureState = fixture(); const { options } = fixtureState; const pending = deferred<AnalysisScopePreview>();
  options.onPreviewAnalysisScope.mockReturnValueOnce(pending.promise);
  const { result, rerender, unmount } = renderHook(props => useEditorSavedActions(props), { initialProps: options });
  const operation = result.current.previewAnalysis!(input).catch(error => error);
  await act(async () => { await Promise.resolve(); });
  expect(options.onPreviewAnalysisScope).toHaveBeenCalledExactlyOnceWith(input);
  if (change === '继续输入') fixtureState.type('预览中的新内容');
  else if (change === '环境往返') { rerender({ ...options, extractionScope: {} }); rerender(options); }
  else unmount();
  await act(async () => { pending.resolve({} as AnalysisScopePreview); expect(await operation).toEqual(expect.objectContaining({ message: '预览期间笔记或草稿已变化，请重新预览。' })); });
});

it('禁用或缺失能力不暴露可执行入口；跨笔记/空间参数在保存前拒绝', async () => {
  const { options } = fixture();
  const { result, rerender } = renderHook(props => useEditorSavedActions(props), { initialProps: options });
  await expect(result.current.restoreVersion({ ...version, noteId: 'other' })).rejects.toBeInstanceOf(Error);
  await expect(result.current.saveVersionAs!({ ...version, noteId: 'other' })).rejects.toBeInstanceOf(Error);
  await expect(result.current.createKnowledgeCandidate!({ ...annotation, noteId: 'other' })).rejects.toBeInstanceOf(Error);
  await expect(result.current.previewAnalysis!({ ...input, spaceId: 'other' })).rejects.toBeInstanceOf(Error);
  rerender({ ...options, canWrite: false });
  await expect(result.current.extractWithAssistant!()).rejects.toBeInstanceOf(Error);
  expect(options.autosave.saveNow).not.toHaveBeenCalled();
  const missing = renderHook(() => useEditorSavedActions({ ...options, onPreviewAnalysisScope: undefined, onCreateKnowledgeCandidate: undefined, onExtractWithAssistant: undefined, onSaveVersionAs: undefined }));
  expect(missing.result.current).toMatchObject({ previewAnalysis: undefined, createKnowledgeCandidate: undefined, extractWithAssistant: undefined, saveVersionAs: undefined });
});


it.each(['候选', '另存'])('%s 已发出的请求允许正常完成，不把会话切换伪装成撤销', async action => {
  const { options } = fixture(); const pending = deferred<void>();
  options.onCreateKnowledgeCandidate.mockReturnValueOnce(pending.promise);
  options.onSaveVersionAs.mockReturnValueOnce(pending.promise);
  const { result, unmount } = renderHook(() => useEditorSavedActions(options));
  const operation = action === '候选' ? result.current.createKnowledgeCandidate!(annotation) : result.current.saveVersionAs!(version);
  await act(async () => { await Promise.resolve(); });
  expect(action === '候选' ? options.onCreateKnowledgeCandidate : options.onSaveVersionAs).toHaveBeenCalledOnce();
  unmount();
  await act(async () => { pending.resolve(); await operation; });
});

it('富文本尚未挂载时使用 autosave 草稿', async () => {
  const { options } = fixture(); options.editorRef.current = null;
  const { result } = renderHook(() => useEditorSavedActions(options));
  await result.current.extractWithAssistant!();
  expect(options.autosave.saveNow).toHaveBeenCalledWith('源码草稿');
  expect(options.onExtractWithAssistant).toHaveBeenCalledExactlyOnceWith('note-1');
});
