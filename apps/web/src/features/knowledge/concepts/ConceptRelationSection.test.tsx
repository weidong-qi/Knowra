import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import {
  applyConceptCommand,
  emptyConceptState,
  mergeConceptChanges,
  type ConceptCommand,
  type KnowledgeItem
} from '@study-accelerator/web-core';
import { ConceptRelationSection } from './ConceptRelationSection';
import { createConceptStore } from './conceptStore';
afterEach(cleanup);
async function fixture() {
  const items: KnowledgeItem[] = [
    {
      id: 'k',
      title: '合成依据',
      canonicalStatement: '合成定义正文',
      userExplanation: '',
      knowledgeType: 'concept',
      importance: null,
      reviewStatus: 'confirmed',
      sourceMode: 'manual',
      createdAt: '2026-11-13',
      updatedAt: '2026-11-13',
      deletedAt: null
    }
  ];
  let state = emptyConceptState();
  let seq = 0;
  const hashes = new Map<string, string>();
  const apply = (command: ConceptCommand) => {
    const payload = JSON.stringify(command);
    if (!hashes.has(payload)) hashes.set(payload, String(++seq).padStart(64, '0'));
    const changed = applyConceptCommand(state, items, command, {
      now: '2026-11-13T00:00:00.000Z',
      requestHash: hashes.get(payload)!
    });
    state = mergeConceptChanges(state, changed);
    return changed;
  };
  apply({ type: 'createConcept', id: 'a', name: '起点', expectedRevision: 0, operationId: 'a', itemIds: ['k'] });
  apply({
    type: 'createConcept',
    id: 'b',
    name: '终点',
    expectedRevision: 0,
    operationId: 'b',
    itemIds: ['k'],
    role: 'mentions'
  });
  const request = vi.fn(async (url: string, options?: { body?: string }) =>
    url.endsWith('/commands') ? { data: { changed: apply(JSON.parse(options!.body!).command) } } : { data: state }
  );
  const store = createConceptStore(request as never);
  await store.load();
  return {
    items,
    store,
    request,
    get state() {
      return state;
    }
  };
}
function show(f: Awaited<ReturnType<typeof fixture>>, canWrite = true) {
  return render(
    <ConceptRelationSection
      concept={f.state.concepts[0]}
      items={f.items}
      store={f.store}
      canWrite={canWrite}
      onOpenConcept={vi.fn()}
      onOpenItem={vi.fn()}
    />
  );
}
it('投影不会自动写库，显式选择类型后保存依据和方向，删除后投影再出现', async () => {
  const f = await fixture();
  const user = userEvent.setup();
  show(f);
  expect(f.state.relations).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: '选择类型并确认' }));
  let dialog = screen.getByRole('dialog', { name: '确认条目投影的关系类型' });
  expect(within(dialog).getByRole('button', { name: '确认并保存关系' })).toBeDisabled();
  await user.click(within(dialog).getByRole('button', { name: /关系类型/ }));
  await user.click(screen.getByRole('option', { name: '是一种' }));
  await user.click(within(dialog).getByRole('button', { name: '确认并保存关系' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(f.state.relations[0]).toMatchObject({
    fromConceptId: 'a',
    toConceptId: 'b',
    basisItemId: 'k',
    type: 'isA',
    reviewStatus: 'confirmed',
    sourceMode: 'manual'
  });
  expect(screen.queryByRole('button', { name: '选择类型并确认' })).toBeNull();
  await user.click(screen.getByRole('button', { name: '删除关系', exact: true }));
  dialog = screen.getByRole('dialog', { name: '删除这条关系？' });
  await user.click(within(dialog).getByRole('button', { name: '确认删除关系' }));
  await screen.findByRole('button', { name: '选择类型并确认' });
  expect(f.state.relations[0].deletedAt).not.toBeNull();
  expect(f.state.links.filter(row => !row.deletedAt)).toHaveLength(2);
});
it('只读关系仍可浏览但不能创建、确认或删除', async () => {
  const f = await fixture();
  show(f, false);
  expect(screen.getByText('条目投影 · 待定类型（1）')).toBeVisible();
  expect(screen.queryByRole('button', { name: '建立关系' })).toBeNull();
  expect(screen.queryByRole('button', { name: '选择类型并确认' })).toBeNull();
  expect(f.request.mock.calls.filter(([url]) => url.endsWith('/commands'))).toHaveLength(0);
});
it('打开编辑后版本变化保留输入，但必须显式核对才能保存', async () => {
  const f = await fixture();
  const user = userEvent.setup();
  show(f);
  await user.click(screen.getByRole('button', { name: '选择类型并确认' }));
  const dialog = screen.getByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: /关系类型/ }));
  await user.click(screen.getByRole('option', { name: '是一种' }));
  await act(async () => {
    await f.store.execute({
      type: 'updateConcept',
      id: 'a',
      operationId: 'external',
      expectedRevision: 1,
      patch: { sense: '新语境' }
    });
  });
  expect(within(dialog).getByRole('button', { name: '确认并保存关系' })).toBeDisabled();
  await user.click(within(dialog).getByRole('button', { name: '已核对，按最新版本继续' }));
  await user.click(within(dialog).getByRole('button', { name: '确认并保存关系' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(f.state.relations[0].type).toBe('isA');
});

it('服务端已保存但首响应丢失时，同一输入重试复用操作回执', async () => {
  const f = await fixture();
  const user = userEvent.setup();
  show(f);
  const original = f.request.getMockImplementation()!;
  let loseResponse = true;
  f.request.mockImplementation(async (url, options) => {
    const result = await original(url, options);
    if (url.endsWith('/commands') && loseResponse) {
      loseResponse = false;
      throw new Error('响应丢失');
    }
    return result;
  });
  await user.click(screen.getByRole('button', { name: '选择类型并确认' }));
  const dialog = screen.getByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: /关系类型/ }));
  await user.click(screen.getByRole('option', { name: '是一种' }));
  await user.click(within(dialog).getByRole('button', { name: '确认并保存关系' }));
  await within(dialog).findByText('响应丢失');
  await user.click(within(dialog).getByRole('button', { name: '确认并保存关系' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(f.state.relations.filter(row => !row.deletedAt)).toHaveLength(1);
  const commands = f.request.mock.calls
    .filter(([url]) => url.endsWith('/commands'))
    .map(([, options]) => JSON.parse(options!.body!).command);
  expect(commands[0].operationId).toBe(commands[1].operationId);
});

it('手工建立无依据骨架，再编辑为带两端挂靠依据的关系', async () => {
  const f = await fixture();
  const user = userEvent.setup();
  show(f);
  await user.click(screen.getByRole('button', { name: '建立关系' }));
  let dialog = screen.getByRole('dialog', { name: '建立概念关系' });
  await user.click(within(dialog).getByRole('button', { name: '终点概念' }));
  await user.click(screen.getByRole('option', { name: '终点', exact: true }));
  await user.click(within(dialog).getByRole('button', { name: /关系类型/ }));
  await user.click(screen.getByRole('option', { name: '导致', exact: true }));
  await user.click(within(dialog).getByRole('button', { name: '保存关系' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(f.state.relations[0]).toMatchObject({ type: 'causes', basisItemId: null });
  await user.click(screen.getByRole('button', { name: '编辑关系' }));
  dialog = screen.getByRole('dialog', { name: '编辑关系' });
  await user.click(within(dialog).getByRole('button', { name: /关系类型/ }));
  await user.click(screen.getByRole('option', { name: '适用于', exact: true }));
  await user.click(within(dialog).getByRole('button', { name: /依据知识点/ }));
  await user.click(screen.getByRole('option', { name: '合成依据', exact: true }));
  await user.click(within(dialog).getByRole('button', { name: '保存关系' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(f.state.relations.filter(row => !row.deletedAt)).toHaveLength(1);
  expect(f.state.relations[0]).toMatchObject({ type: 'appliesTo', basisItemId: 'k', revision: 2 });
});
