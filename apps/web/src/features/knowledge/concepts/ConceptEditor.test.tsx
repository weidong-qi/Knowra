import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiRequestError, emptyConceptState, type KnowledgeConcept } from '@study-accelerator/web-core';
import { createConceptStore } from './conceptStore';
import { ConceptEditor } from './ConceptEditor';

afterEach(cleanup);
const initial = {
  id: 'a',
  name: '原概念',
  sense: '',
  aliases: [],
  revision: 1,
  deletedAt: null,
  mergedInto: null
} as KnowledgeConcept;
it('409 后保留草稿，显式核对最新基线后使用新 revision 保存', async () => {
  const user = userEvent.setup();
  let remote = initial;
  let writes = 0;
  const request = vi.fn(async (url: string, options?: { body?: string }) => {
    if (url.endsWith('/commands')) {
      writes += 1;
      if (writes === 1) {
        remote = { ...initial, revision: 2, name: '远端名称', sense: '远端标签', aliases: ['远端别名'] };
        throw new ApiRequestError('概念已被其他设备更新', { status: 409, code: 'CONCEPT_REVISION_CONFLICT' });
      }
      const command = JSON.parse(options!.body!).command;
      expect(command.expectedRevision).toBe(2);
      expect(command.patch.name).toBe('我的草稿');
      return {
        data: { changed: { ...emptyConceptState(), concepts: [{ ...remote, ...command.patch, revision: 3 }] } }
      };
    }
    return { data: { ...emptyConceptState(), concepts: [remote] } };
  });
  const store = createConceptStore(request as never);
  await store.load();
  const close = vi.fn();
  render(<ConceptEditor concept={initial} canWrite store={store} onClose={close} />);
  await user.clear(screen.getByRole('textbox', { name: '概念名称' }));
  await user.type(screen.getByRole('textbox', { name: '概念名称' }), '我的草稿');
  await user.click(screen.getByRole('button', { name: '保存概念' }));
  expect(await screen.findByText('远端名称')).toBeInTheDocument();
  expect(screen.getByText('远端标签')).toBeInTheDocument();
  expect(screen.getByText('远端别名')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: '概念名称' })).toHaveValue('我的草稿');
  expect(screen.getByRole('button', { name: '保存概念' })).toBeDisabled();
  expect(writes).toBe(1);
  await user.click(screen.getByRole('button', { name: '已核对，采用最新版本基线' }));
  expect(close).not.toHaveBeenCalled();
  expect(writes).toBe(1);
  await user.click(screen.getByRole('button', { name: '保存概念' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  const commands = request.mock.calls
    .filter(([url]) => url.endsWith('/commands'))
    .map(([, options]) => JSON.parse(options!.body!).command);
  expect(commands[0].operationId).not.toBe(commands[1].operationId);
});

it.each(['deleted', 'merged', 'missing'] as const)('编辑目标 %s 后阻止旧写且保留草稿', async kind => {
  let concepts = [initial];
  const request = vi.fn(async () => ({ data: { ...emptyConceptState(), concepts } }));
  const store = createConceptStore(request as never);
  await store.load();
  render(<ConceptEditor concept={initial} canWrite store={store} onClose={vi.fn()} />);
  await userEvent.type(screen.getByRole('textbox', { name: '概念名称' }), '草稿');
  concepts =
    kind === 'missing'
      ? []
      : [
          {
            ...initial,
            revision: 2,
            deletedAt: kind === 'deleted' ? '2026-11-13' : null,
            mergedInto: kind === 'merged' ? 'b' : null
          }
        ];
  await act(() => store.load());
  expect(screen.getByRole('button', { name: '保存概念' })).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('不能保存旧编辑');
  expect(screen.getByRole('textbox', { name: '概念名称' })).toHaveValue('原概念草稿');
  expect(request).toHaveBeenCalledTimes(2);
});
