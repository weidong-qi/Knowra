import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AnalysisScopePreview, AnnotationPreview } from '@study-accelerator/web-core';
import { EditorInspector, type EditorInspectorProps } from './EditorInspector';
import {
  analysisPreview, annotationA, annotationB, annotationOtherNote, annotationPreview,
  deferred, inspectorProps, knowledgeLinks, noteA, noteB
} from './EditorInspector.lifecycle.fixtures';

function setup(overrides: Partial<EditorInspectorProps> = {}) {
  let props = inspectorProps(overrides);
  const view = render(<EditorInspector {...props} />);
  return {
    user: userEvent.setup(),
    rerender(next: Partial<EditorInspectorProps>) {
      props = { ...props, ...next };
      view.rerender(<EditorInspector {...props} />);
    }
  };
}

async function requestDetail(user: ReturnType<typeof userEvent.setup>, index = 1) {
  await user.click(screen.getByRole('button', { name: `重点 ${index} 更多操作` }));
  await user.click(screen.getByRole('menuitem', { name: '预览与编辑' }));
}

async function resolveRequest<T>(pending: ReturnType<typeof deferred<T>>, value: T) {
  await act(async () => {
    pending.resolve(value);
    await pending.promise;
  });
}

describe('EditorInspector 异步生命周期', () => {
  it('切换笔记后旧详情迟到，不重新打开弹窗或覆盖新笔记详情', async () => {
    const old = deferred<AnnotationPreview>();
    const onPreviewAnnotation = vi.fn()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue(annotationPreview(annotationOtherNote));
    const { user, rerender } = setup({ onPreviewAnnotation });
    await user.click(screen.getByRole('tab', { name: '标注' }));
    await requestDetail(user);
    expect(onPreviewAnnotation).toHaveBeenCalledWith(annotationA.id);

    rerender({ note: noteB, markdown: noteB.rawMarkdown, annotations: [annotationOtherNote] });
    expect(screen.queryByRole('dialog', { name: '重点详情' })).not.toBeInTheDocument();
    await requestDetail(user);
    const dialog = await screen.findByRole('dialog', { name: '重点详情' });
    expect(dialog).toHaveTextContent(`${annotationOtherNote.id} 预览`);
    await resolveRequest(old, annotationPreview(annotationA));

    expect(screen.getAllByRole('dialog', { name: '重点详情' })).toHaveLength(1);
    const currentDialog = screen.getByRole('dialog', { name: '重点详情' });
    expect(currentDialog).toHaveTextContent(`${annotationOtherNote.id} 预览`);
    expect(currentDialog).not.toHaveTextContent(`${annotationA.id} 预览`);
    expect(within(currentDialog).getByRole('textbox', { name: '备注' })).toHaveValue(annotationOtherNote.comment);
  });

  it('切换笔记后旧分析预览迟到，不覆盖新笔记的分析范围', async () => {
    const old = deferred<AnalysisScopePreview>();
    const onPreviewAnalysisScope = vi.fn()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue(analysisPreview(noteB));
    const { user, rerender } = setup({ onPreviewAnalysisScope });
    await user.click(screen.getByRole('tab', { name: 'AI' }));
    await user.click(screen.getByRole('button', { name: '分析整篇' }));
    expect(onPreviewAnalysisScope).toHaveBeenCalledWith({ spaceId: 'space', mode: 'all', noteIds: [noteA.id] });

    rerender({ note: noteB, markdown: noteB.rawMarkdown, annotations: [] });
    expect(screen.queryByRole('dialog', { name: '确认分析范围' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '分析整篇' }));
    const dialog = await screen.findByRole('dialog', { name: '确认分析范围' });
    expect(dialog).toHaveTextContent(`${noteB.id} 分析预览`);
    await resolveRequest(old, analysisPreview(noteA));

    expect(screen.getAllByRole('dialog', { name: '确认分析范围' })).toHaveLength(1);
    const currentDialog = screen.getByRole('dialog', { name: '确认分析范围' });
    expect(currentDialog).toHaveTextContent(`${noteB.id} 分析预览`);
    expect(currentDialog).not.toHaveTextContent(`${noteA.id} 分析预览`);
    expect(onPreviewAnalysisScope).toHaveBeenLastCalledWith({ spaceId: 'space', mode: 'all', noteIds: [noteB.id] });
  });

  it('同笔记先请求 A 再请求 B，A 迟到不能覆盖 B 的正文、备注和关联候选', async () => {
    const old = deferred<AnnotationPreview>();
    const onPreviewAnnotation = vi.fn((id: string) => id === annotationA.id
      ? old.promise : Promise.resolve(annotationPreview(annotationB)));
    const onGetAnnotationKnowledgeLinks = vi.fn(async (id: string) => knowledgeLinks(id === annotationA.id ? annotationA : annotationB));
    const onOpenKnowledgeItem = vi.fn();
    const { user } = setup({ annotations: [annotationA, annotationB], onPreviewAnnotation, onGetAnnotationKnowledgeLinks, onOpenKnowledgeItem });
    await user.click(screen.getByRole('tab', { name: '标注' }));
    await requestDetail(user, 1);
    await requestDetail(user, 2);
    expect(onPreviewAnnotation.mock.calls.map(([id]) => id)).toEqual([annotationA.id, annotationB.id]);
    const dialog = await screen.findByRole('dialog', { name: '重点详情' });
    expect(dialog).toHaveTextContent(`${annotationB.id} 预览`);
    await resolveRequest(old, annotationPreview(annotationA));

    const currentDialog = screen.getByRole('dialog', { name: '重点详情' });
    expect(currentDialog).toHaveTextContent(`${annotationB.id} 预览`);
    expect(currentDialog).not.toHaveTextContent(`${annotationA.id} 预览`);
    expect(within(currentDialog).getByRole('textbox', { name: '备注' })).toHaveValue(annotationB.comment);
    await user.click(within(currentDialog).getByRole('button', { name: `${annotationB.id} 候选` }));
    expect(onOpenKnowledgeItem).toHaveBeenCalledWith(`candidate-${annotationB.id}`);
  });

  it('A、B 详情同时在途时两个菜单均禁用，B 完成后仍保留展示权', async () => {
    const pendingA = deferred<AnnotationPreview>();
    const pendingB = deferred<AnnotationPreview>();
    const onPreviewAnnotation = vi.fn((id: string) => id === annotationA.id ? pendingA.promise : pendingB.promise);
    const { user } = setup({ annotations: [annotationA, annotationB], onPreviewAnnotation });
    await user.click(screen.getByRole('tab', { name: '标注' }));
    await requestDetail(user, 1);
    await requestDetail(user, 2);

    for (const index of [1, 2]) {
      await user.click(screen.getByRole('button', { name: `重点 ${index} 更多操作` }));
      expect.soft(screen.getByRole('menuitem', { name: '预览与编辑' })).toHaveAttribute('aria-disabled', 'true');
      await user.keyboard('{Escape}');
    }
    await resolveRequest(pendingB, annotationPreview(annotationB));
    expect(await screen.findByRole('dialog', { name: '重点详情' })).toHaveTextContent(`${annotationB.id} 预览`);
    await resolveRequest(pendingA, annotationPreview(annotationA));
    const dialog = screen.getByRole('dialog', { name: '重点详情' });
    expect(dialog).toHaveTextContent(`${annotationB.id} 预览`);
    expect(dialog).not.toHaveTextContent(`${annotationA.id} 预览`);
    expect(onPreviewAnnotation.mock.calls.map(([id]) => id)).toEqual([annotationA.id, annotationB.id]);
  });

  it('A、B 请求间重复点击在途 A，不重发请求也不抢走 B 的展示权', async () => {
    const pendingA = deferred<AnnotationPreview>();
    const pendingB = deferred<AnnotationPreview>();
    const onPreviewAnnotation = vi.fn((id: string) => id === annotationA.id ? pendingA.promise : pendingB.promise);
    const { user } = setup({ annotations: [annotationA, annotationB], onPreviewAnnotation });
    await user.click(screen.getByRole('tab', { name: '标注' }));
    await requestDetail(user, 1);
    await requestDetail(user, 2);
    await requestDetail(user, 1);
    // 点击禁用项时菜单可能保持展开，正常关闭它后再观察请求结果。
    await user.keyboard('{Escape}');
    expect(onPreviewAnnotation.mock.calls.map(([id]) => id)).toEqual([annotationA.id, annotationB.id]);

    await resolveRequest(pendingB, annotationPreview(annotationB));
    expect(await screen.findByRole('dialog', { name: '重点详情' })).toHaveTextContent(`${annotationB.id} 预览`);
    await resolveRequest(pendingA, annotationPreview(annotationA));
    const dialog = screen.getByRole('dialog', { name: '重点详情' });
    expect(dialog).toHaveTextContent(`${annotationB.id} 预览`);
    expect(dialog).not.toHaveTextContent(`${annotationA.id} 预览`);
    expect(within(dialog).getByRole('textbox', { name: '备注' })).toHaveValue(annotationB.comment);
  });

  it('详情读取失败后可以重新打开，成功重试清除旧错误', async () => {
    const onPreviewAnnotation = vi.fn()
      .mockRejectedValueOnce(new Error('详情读取失败'))
      .mockResolvedValue(annotationPreview(annotationA));
    const { user } = setup({ onPreviewAnnotation });
    await user.click(screen.getByRole('tab', { name: '标注' }));
    await requestDetail(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('详情读取失败');
    expect(screen.queryByRole('dialog', { name: '重点详情' })).not.toBeInTheDocument();

    await requestDetail(user);
    expect(await screen.findByRole('dialog', { name: '重点详情' })).toHaveTextContent(`${annotationA.id} 预览`);
    expect(onPreviewAnnotation).toHaveBeenCalledTimes(2);
    // 弹窗会隐藏背景内容；仍检查 DOM，防止旧错误只是被 aria-hidden 遮住。
    expect(screen.queryByText('详情读取失败')).not.toBeInTheDocument();
  });

  it('分析预览失败后可以重试，成功时只展示本次范围', async () => {
    const onPreviewAnalysisScope = vi.fn()
      .mockRejectedValueOnce(new Error('分析预览失败'))
      .mockResolvedValue(analysisPreview(noteA));
    const { user } = setup({ onPreviewAnalysisScope });
    await user.click(screen.getByRole('tab', { name: 'AI' }));
    await user.click(screen.getByRole('button', { name: '分析整篇' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('分析预览失败');
    await user.click(screen.getByRole('button', { name: '分析整篇' }));

    expect(await screen.findByRole('dialog', { name: '确认分析范围' })).toHaveTextContent(`${noteA.id} 分析预览`);
    expect(onPreviewAnalysisScope).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('分析预览失败')).not.toBeInTheDocument();
  });
});

describe('EditorInspector 详情写入保护与恢复', () => {
  it.each([
    { name: '只读笔记', permissions: { canWrite: false } },
    { name: '扩展写入关闭', permissions: { extendedWritesEnabled: false } }
  ])('$name 仍可查看详情，但不能保存或恢复排除范围', async ({ permissions }) => {
    const onUpdateAnnotation = vi.fn().mockResolvedValue(undefined);
    const onDeleteAnnotationExclusion = vi.fn().mockResolvedValue(undefined);
    const { user } = setup({ ...permissions, onUpdateAnnotation, onDeleteAnnotationExclusion });
    await user.click(screen.getByRole('tab', { name: '标注' }));
    await requestDetail(user);
    const dialog = await screen.findByRole('dialog', { name: '重点详情' });
    expect(dialog).toHaveTextContent(`${annotationA.id} 预览`);
    const save = within(dialog).getByRole('button', { name: '保存信息' });
    const restore = within(dialog).getByRole('button', { name: '恢复排除范围：已排除的片段' });
    expect.soft(save).toBeDisabled();
    expect.soft(restore).toBeDisabled();
    await user.click(save);
    await user.click(restore);
    expect(onUpdateAnnotation).not.toHaveBeenCalled();
    expect(onDeleteAnnotationExclusion).not.toHaveBeenCalled();
  });

  it('详情打开后权限变为只读，保存和恢复排除都立刻停止写入', async () => {
    const onUpdateAnnotation = vi.fn().mockResolvedValue(undefined);
    const onDeleteAnnotationExclusion = vi.fn().mockResolvedValue(undefined);
    const { user, rerender } = setup({ onUpdateAnnotation, onDeleteAnnotationExclusion });
    await user.click(screen.getByRole('tab', { name: '标注' }));
    await requestDetail(user);
    await screen.findByRole('dialog', { name: '重点详情' });
    rerender({ canWrite: false });

    const dialog = screen.getByRole('dialog', { name: '重点详情' });
    const save = within(dialog).getByRole('button', { name: '保存信息' });
    const restore = within(dialog).getByRole('button', { name: '恢复排除范围：已排除的片段' });
    expect.soft(save).toBeDisabled();
    expect.soft(restore).toBeDisabled();
    await user.click(restore);
    await user.click(save);
    expect(onUpdateAnnotation).not.toHaveBeenCalled();
    expect(onDeleteAnnotationExclusion).not.toHaveBeenCalled();
  });

  it('恢复排除失败后保留详情、解除提交锁并允许使用原修订重试', async () => {
    const first = deferred<void>();
    const retry = deferred<void>();
    const onDeleteAnnotationExclusion = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise);
    const { user } = setup({ onDeleteAnnotationExclusion });
    await user.click(screen.getByRole('tab', { name: '标注' }));
    await requestDetail(user);
    const dialog = await screen.findByRole('dialog', { name: '重点详情' });
    const restore = within(dialog).getByRole('button', { name: '恢复排除范围：已排除的片段' });
    await user.click(restore);
    expect(onDeleteAnnotationExclusion).toHaveBeenCalledWith(annotationA.id, 'exclusion', 3);
    expect(restore).toBeDisabled();
    await user.click(restore);
    expect(onDeleteAnnotationExclusion).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.reject(new Error('恢复排除失败，请重试'));
      await first.promise.catch(() => undefined);
    });
    // 原错误呈现可能在弹窗背景；不耦合提取后的具体布局。
    expect(await screen.findByText('恢复排除失败，请重试')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '重点详情' })).toBeVisible();
    await waitFor(() => expect(restore).toBeEnabled());
    await user.click(restore);
    expect(onDeleteAnnotationExclusion).toHaveBeenNthCalledWith(2, annotationA.id, 'exclusion', 3);
    expect(restore).toBeDisabled();
    await resolveRequest(retry, undefined);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '重点详情' })).not.toBeInTheDocument());
    expect(screen.queryByText('恢复排除失败，请重试')).not.toBeInTheDocument();
  });
});
