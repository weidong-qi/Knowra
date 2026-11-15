import { act, cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import {
  applyConceptCommand,
  emptyConceptState,
  mergeConceptChanges,
  type CreateKnowledgeCandidateInput,
  type KnowledgeItem
} from '@study-accelerator/web-core';
import { canNavigate } from '../../../app/navigationGuard';
import { ConceptWorkspace } from './ConceptWorkspace';
import { createConceptStore, setSharedConceptStore } from './conceptStore';
import { useConceptDefinitionLink } from './useConceptDefinitionLink';

afterEach(() => {
  cleanup();
  setSharedConceptStore(null);
  sessionStorage.clear();
});

it('写定义沿用草稿保护，保存失败保留输入，挂靠失败只重试关联', async () => {
  const user = userEvent.setup();
  const items: KnowledgeItem[] = [];
  const options = { now: '2026-11-15T00:00:00Z', requestHash: 'a'.repeat(64) };
  let state = applyConceptCommand(
    emptyConceptState(),
    [],
    {
      type: 'createConcept',
      id: 'math',
      name: '数学',
      operationId: 'create',
      expectedRevision: 0
    },
    options
  );
  let linkAttempts = 0;
  const request = vi.fn(async (url: string, input?: { body?: string }) => {
    if (!url.endsWith('/commands')) return { data: state };
    if (++linkAttempts === 1) throw new Error('模拟挂靠失败');
    const changed = applyConceptCommand(state, items, JSON.parse(input!.body!).command, options);
    state = mergeConceptChanges(state, changed);
    return { data: { changed } };
  });
  const store = createConceptStore(request as never);
  setSharedConceptStore(store);
  let saveAttempts = 0;
  const create = vi.fn(async (input: CreateKnowledgeCandidateInput) => {
    if (++saveAttempts === 1) throw new Error('模拟保存失败');
    const item: KnowledgeItem = {
      id: input.id!,
      title: input.title!,
      canonicalStatement: input.canonicalStatement!,
      userExplanation: '',
      knowledgeType: 'concept',
      sourceMode: 'manual',
      importance: null,
      reviewStatus: 'candidate',
      createdAt: options.now,
      updatedAt: options.now,
      deletedAt: null
    };
    items.push(item);
    return { item, evidence: [] };
  });
  render(
    <ConceptWorkspace
      selectedId="math"
      canWrite
      onSelect={vi.fn()}
      onOpenItem={vi.fn()}
      onListItems={async () => items}
      onCreateItem={create}
    />
  );
  await user.click(await screen.findByRole('button', { name: '写定义' }));
  const dialog = screen.getByRole('dialog', { name: '为“数学”写定义' });
  expect(within(dialog).getByRole('textbox', { name: '标题' })).toHaveValue('数学的定义');
  expect(within(dialog).getByRole('button', { name: /知识类型/ })).toBeDisabled();
  await user.click(within(dialog).getByRole('button', { name: '保存' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('请在核心陈述中填写定义正文');
  expect(create).not.toHaveBeenCalled();
  await user.type(within(dialog).getByRole('textbox', { name: '核心陈述' }), '研究数量与结构的学科。');
  expect(canNavigate()).toBe(false);
  await user.click(within(dialog).getByRole('button', { name: '取消' }));
  await user.click(screen.getByRole('button', { name: '继续编辑' }));
  await user.click(within(dialog).getByRole('button', { name: '保存' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('模拟保存失败');
  expect(within(dialog).getByRole('textbox', { name: '核心陈述' })).toHaveValue('研究数量与结构的学科。');
  await user.click(within(dialog).getByRole('button', { name: '保存' }));
  await screen.findByRole('button', { name: '重试挂入' });
  expect(screen.queryByRole('dialog', { name: '为“数学”写定义' })).not.toBeInTheDocument();
  expect(items).toHaveLength(1);
  expect(canNavigate()).toBe(true);
  await user.click(screen.getByRole('button', { name: '重试挂入' }));
  await waitFor(() => expect(screen.getByRole('region', { name: '定义' })).toHaveTextContent('研究数量与结构的学科。'));
  expect(screen.getByRole('region', { name: '定义' })).toHaveTextContent('候选');
  expect(create).toHaveBeenCalledTimes(2);
  expect(create.mock.calls[0]![0].id).toBe(create.mock.calls[1]![0].id);
  expect(linkAttempts).toBe(2);
  expect(state.links).toHaveLength(1);
  expect(state.links[0]).toMatchObject({ knowledgeItemId: items[0]!.id, role: 'subject' });
});

it('挂靠已经提交但响应丢失时，重试先核对快照而不重复写入', async () => {
  const now = '2026-11-15T00:00:00Z';
  const item: KnowledgeItem = {
    id: 'definition',
    title: '数学的定义',
    canonicalStatement: '定义正文',
    userExplanation: '',
    knowledgeType: 'concept',
    sourceMode: 'manual',
    importance: null,
    reviewStatus: 'candidate',
    createdAt: now,
    updatedAt: now,
    deletedAt: null
  };
  const options = { now, requestHash: 'a'.repeat(64) };
  let state = applyConceptCommand(
    emptyConceptState(),
    [item],
    {
      type: 'createConcept',
      id: 'math',
      name: '数学',
      operationId: 'create',
      expectedRevision: 0
    },
    options
  );
  const request = vi.fn(async (url: string, input?: { body?: string }) => {
    if (!url.endsWith('/commands')) return { data: state };
    state = mergeConceptChanges(state, applyConceptCommand(state, [item], JSON.parse(input!.body!).command, options));
    throw new Error('模拟提交后丢失响应');
  });
  const store = createConceptStore(request as never);
  await store.load();
  const { result } = renderHook(() => useConceptDefinitionLink(store));
  await act(() => result.current.start(state.concepts[0]!, item));
  expect(result.current.error).toBe('模拟提交后丢失响应');
  await act(() => result.current.retry());
  expect(result.current.task).toBeNull();
  expect(request.mock.calls.filter(([url]) => url.endsWith('/commands'))).toHaveLength(1);
  expect(state.links).toHaveLength(1);
});
