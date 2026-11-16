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
import { getKnowledgeDraftScope, knowledgeDraftRecovery } from '../knowledgeDraftRecovery';

afterEach(async () => {
  cleanup();
  await knowledgeDraftRecovery.flush();
  setSharedConceptStore(null);
  sessionStorage.clear();
});

it('重新挂载后可从概念页恢复定义，写定义复用原候选 ID 与正文并挂回原概念', async () => {
  const user = userEvent.setup();
  const now = '2026-11-16T00:00:00Z';
  const options = { now, requestHash: 'a'.repeat(64) };
  const items: KnowledgeItem[] = [];
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
  const store = createConceptStore(
    vi.fn(async (url: string, input?: { body?: string }) => {
      if (!url.endsWith('/commands')) return { data: state };
      const changed = applyConceptCommand(state, items, JSON.parse(input!.body!).command, options);
      state = mergeConceptChanges(state, changed);
      return { data: { changed } };
    }) as never
  );
  setSharedConceptStore(store);
  const create = vi.fn(async (input: CreateKnowledgeCandidateInput) => {
    const item = {
      ...input,
      id: input.id!,
      sourceMode: 'manual',
      importance: null,
      reviewStatus: 'candidate',
      createdAt: now,
      updatedAt: now,
      deletedAt: null
    } as KnowledgeItem;
    items.push(item);
    return { item, evidence: [] };
  });
  const mount = () =>
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
  let view = mount();
  await user.click(await screen.findByRole('button', { name: '写定义' }));
  await user.type(screen.getByRole('textbox', { name: '核心陈述' }), '恢复后的数学定义。');
  await knowledgeDraftRecovery.flush();
  const original = knowledgeDraftRecovery.list(getKnowledgeDraftScope())[0]!;
  expect(original.definitionTarget).toEqual({ conceptId: 'math', conceptName: '数学' });
  view.unmount();
  view = mount();
  await user.click(await screen.findByRole('button', { name: '恢复定义草稿：数学的定义' }));
  expect(screen.getByRole('textbox', { name: '核心陈述' })).toHaveValue('恢复后的数学定义。');
  expect(screen.getByRole('button', { name: /知识类型/ })).toBeDisabled();
  view.unmount();
  mount();
  await user.click(await screen.findByRole('button', { name: '写定义' }));
  expect(screen.getByRole('status')).toHaveTextContent('已恢复未保存的知识草稿');
  await user.click(screen.getByRole('button', { name: '保存', exact: true }));
  await waitFor(() => expect(state.links).toHaveLength(1));
  expect(create).toHaveBeenCalledOnce();
  expect(create.mock.calls[0]![0]).toMatchObject({
    id: original.candidateId,
    canonicalStatement: '恢复后的数学定义。',
    knowledgeType: 'concept'
  });
  expect(state.links[0]).toMatchObject({ conceptId: 'math', knowledgeItemId: original.candidateId, role: 'subject' });
  expect(knowledgeDraftRecovery.list(getKnowledgeDraftScope())).toEqual([]);
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
  expect(screen.getByRole('region', { name: '定义' })).toHaveTextContent('待确认');
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

it('目标概念已删除时保留恢复草稿并允许导出，禁止创建孤立的定义知识', async () => {
  const user = userEvent.setup();
  const value = {
    title: '数学的定义',
    canonicalStatement: '定义正文',
    userExplanation: '',
    knowledgeType: 'concept' as const
  };
  const draft = {
    version: 1 as const,
    kind: 'create' as const,
    candidateId: 'orphan-definition',
    initialValue: value,
    value,
    definitionTarget: { conceptId: 'deleted-math', conceptName: '数学' }
  };
  knowledgeDraftRecovery.write(getKnowledgeDraftScope(), draft);
  await knowledgeDraftRecovery.flush();
  setSharedConceptStore(createConceptStore(vi.fn(async () => ({ data: emptyConceptState() })) as never));
  const create = vi.fn();
  render(
    <ConceptWorkspace
      selectedId="deleted-math"
      canWrite
      onSelect={vi.fn()}
      onOpenItem={vi.fn()}
      onListItems={async () => []}
      onCreateItem={create}
    />
  );
  await user.click(await screen.findByRole('button', { name: '恢复定义草稿：数学的定义' }));
  expect(screen.getByRole('alert')).toHaveTextContent('目标概念已删除或合并');
  expect(screen.getByRole('button', { name: '导出定义草稿：数学的定义' })).toBeEnabled();
  expect(screen.queryByRole('textbox', { name: '核心陈述' })).not.toBeInTheDocument();
  expect(create).not.toHaveBeenCalled();
  expect(knowledgeDraftRecovery.list(getKnowledgeDraftScope())).toEqual([draft]);
});
