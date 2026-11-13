import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { emptyConceptState, type ConceptState, type KnowledgeConcept } from '@study-accelerator/web-core';
import { createConceptStore } from './conceptStore';
import { ConceptActionDialog } from './ConceptActionDialog';

afterEach(cleanup);
const owner = {
  id: 'a',
  name: '源概念',
  revision: 1,
  deletedAt: null,
  mergedInto: null,
  reviewStatus: 'confirmed'
} as KnowledgeConcept;
const destination = { ...owner, id: 'b', name: '目标概念' };
async function fixture(action: 'delete' | 'merge' = 'delete') {
  let remote: ConceptState = { ...emptyConceptState(), concepts: [owner, destination] };
  let fail = false;
  const commands: Array<Record<string, unknown>> = [];
  const request = vi.fn(async (url: string, options?: { body?: string }) => {
    if (url.endsWith('/commands')) {
      commands.push(JSON.parse(options!.body!).command);
      if (fail) throw new Error('响应丢失，请重试');
      return {
        data: {
          changed: {
            ...remote,
            concepts: remote.concepts.map(row =>
              row.id === 'a' ? { ...row, revision: row.revision + 1, deletedAt: '2026-11-13' } : row
            )
          }
        }
      };
    }
    return { data: remote };
  });
  const store = createConceptStore(request as never);
  await store.load();
  const close = vi.fn();
  const props = { action, concept: owner, canWrite: true, store, onClose: close, onSelect: vi.fn() };
  const view = render(<ConceptActionDialog {...props} />);
  return {
    commands,
    close,
    failNext(value: boolean) {
      fail = value;
    },
    async refresh(next: ConceptState) {
      remote = next;
      await act(() => store.load());
      view.rerender(<ConceptActionDialog {...props} concept={next.concepts.find(row => row.id === 'a') ?? owner} />);
    }
  };
}

it('删除确认保留打开时的范围，新增入边后阻止旧确认', async () => {
  const f = await fixture();
  expect(screen.getByText(/0 条关系/)).toBeInTheDocument();
  await f.refresh({
    ...emptyConceptState(),
    concepts: [{ ...owner, revision: 2 }, destination],
    relations: [
      {
        id: 'new',
        fromConceptId: 'b',
        toConceptId: 'a',
        revision: 1,
        deletedAt: null
      } as ConceptState['relations'][number]
    ]
  });
  expect(screen.getByText(/0 条关系/)).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('旧确认已失效');
  expect(screen.getByRole('button', { name: '删除概念及关系' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: '删除概念及关系' }));
  expect(f.commands).toHaveLength(0);
});

it.each(['source', 'target'] as const)('合并冻结已选择的源和目标，%s 更新后要求重新核对', async kind => {
  const f = await fixture('merge');
  await userEvent.click(screen.getByRole('button', { name: '合并目标' }));
  await userEvent.click(screen.getByRole('option', { name: '目标概念' }));
  expect(screen.getByRole('button', { name: '确认合并' })).toBeEnabled();
  await f.refresh({
    ...emptyConceptState(),
    concepts: [
      kind === 'source' ? { ...owner, revision: 2 } : owner,
      kind === 'target' ? { ...destination, revision: 2 } : destination
    ]
  });
  expect(screen.getByRole('button', { name: '确认合并' })).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('重新打开');
  expect(f.commands).toHaveLength(0);
});

it.each(['delete', 'merge'] as const)('%s 响应丢失后的相同请求重用 operationId 和版本基线', async action => {
  const f = await fixture(action);
  if (action === 'merge') {
    await userEvent.click(screen.getByRole('button', { name: '合并目标' }));
    await userEvent.click(screen.getByRole('option', { name: '目标概念' }));
  }
  const button = screen.getByRole('button', { name: action === 'merge' ? '确认合并' : '删除概念及关系' });
  f.failNext(true);
  await userEvent.click(button);
  expect(await screen.findByRole('alert')).toHaveTextContent('响应丢失');
  f.failNext(false);
  await userEvent.click(button);
  await waitFor(() => expect(f.close).toHaveBeenCalledOnce());
  expect(f.commands).toHaveLength(2);
  expect(f.commands[1]).toEqual(f.commands[0]);
  expect(f.commands[1].expectedRevision).toBe(1);
});
