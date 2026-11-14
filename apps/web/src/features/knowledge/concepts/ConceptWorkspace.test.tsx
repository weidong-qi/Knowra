import { canNavigate } from '../../../app/navigationGuard';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiRequestError,
  applyConceptCommand,
  emptyConceptState,
  mergeConceptChanges,
  type ConceptCommand,
  type ConceptState
} from '@study-accelerator/web-core';
import { createConceptStore, setSharedConceptStore } from './conceptStore';
import { ConceptWorkspace } from './ConceptWorkspace';
import { ConceptEditor } from './ConceptEditor';
afterEach(() => {
  cleanup();
  setSharedConceptStore(null);
});
function fixture(seed: ConceptCommand[] = []) {
  let state = emptyConceptState();
  let seq = 0;
  const apply = (command: ConceptCommand) => {
    const changed = applyConceptCommand(state, [], command, {
      now: '2026-11-12T00:00:00Z',
      requestHash: (++seq).toString(16).padStart(64, '0')
    });
    state = mergeConceptChanges(state, changed);
    return changed;
  };
  seed.forEach(apply);
  const request = vi.fn(async (url: string, options?: { body?: string }) => {
    if (url.endsWith('/commands')) return { data: { changed: apply(JSON.parse(options!.body!).command) } };
    return {
      data: {
        concepts: state.concepts.filter(row => !row.deletedAt),
        links: state.links.filter(row => !row.deletedAt),
        relations: state.relations.filter(row => !row.deletedAt)
      }
    };
  });
  const store = createConceptStore(request as never);
  setSharedConceptStore(store);
  return { store, request, state: () => state };
}
describe('概念首版界面', () => {
  it('新建弹窗保存名称、区分标签和别名', async () => {
    const user = userEvent.setup();
    const server = fixture();
    await server.store.load();
    const close = vi.fn();
    render(<ConceptEditor canWrite store={server.store} onClose={close} />);
    await user.type(screen.getByRole('textbox', { name: '概念名称' }), '卷积神经网络');
    await user.type(screen.getByRole('textbox', { name: '区分标签' }), '深度学习');
    await user.type(screen.getByRole('textbox', { name: '别名' }), 'CNN');
    await user.click(screen.getByRole('button', { name: '保存概念' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(server.state().concepts[0]).toMatchObject({
      name: '卷积神经网络',
      sense: '深度学习',
      aliases: ['CNN'],
      reviewStatus: 'confirmed'
    });
  });
  it('未保存概念退出前确认，继续编辑保留输入，保存后选中新身份', async () => {
    const user = userEvent.setup();
    const server = fixture();
    await server.store.load();
    const close = vi.fn();
    const saved = vi.fn();
    render(<ConceptEditor canWrite store={server.store} onClose={close} onSaved={saved} />);
    await user.type(screen.getByRole('textbox', { name: '概念名称' }), '合成概念');
    expect(canNavigate()).toBe(false);
    await user.click(screen.getByRole('button', { name: '取消' }));
    await user.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(screen.getByRole('textbox', { name: '概念名称' })).toHaveValue('合成概念');
    await user.click(screen.getByRole('button', { name: '保存概念' }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith(server.state().concepts[0].id));
    expect(canNavigate()).toBe(true);
    expect(close).toHaveBeenCalledOnce();
  });
  it('只读概念页隐藏写操作，已确认数据仍可查看', async () => {
    const server = fixture([
      { type: 'createConcept', id: 'a', operationId: 'create-a', expectedRevision: 0, name: 'CNN' }
    ]);
    const list = vi.fn(async () => []);
    render(
      <ConceptWorkspace selectedId="a" canWrite={false} onListItems={list} onSelect={vi.fn()} onOpenItem={vi.fn()} />
    );
    await screen.findByRole('heading', { name: 'CNN' });
    expect(screen.queryByRole('button', { name: '编辑概念' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '删除概念' })).not.toBeInTheDocument();
    expect(server.request.mock.calls.filter(([url]) => url.endsWith('/commands'))).toHaveLength(0);
  });
  it('旧端不支持概念时保留升级说明和重试入口，禁止新建', async () => {
    const store = createConceptStore(
      vi.fn(async () => {
        throw new ApiRequestError('不支持概念', { status: 503, code: 'KNOWLEDGE_CONCEPTS_UNAVAILABLE' });
      }) as never
    );
    setSharedConceptStore(store);
    render(
      <ConceptWorkspace
        selectedId={null}
        canWrite
        onListItems={async () => []}
        onSelect={vi.fn()}
        onOpenItem={vi.fn()}
      />
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('请升级云端与 Mac 应用');
    expect(screen.getByRole('button', { name: '新建概念' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '重新加载概念' })).toBeEnabled();
  });
  it('直接合并提示不可撤销，删除确认列出关系数量', async () => {
    fixture(
      ['a', 'b'].map(id => ({ type: 'createConcept', id, operationId: `create-${id}`, expectedRevision: 0, name: id }))
    );
    const list = vi.fn(async () => []);
    const user = userEvent.setup();
    render(<ConceptWorkspace selectedId="a" canWrite onListItems={list} onSelect={vi.fn()} onOpenItem={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: '概念更多操作' }));
    await user.click(screen.getByRole('menuitem', { name: '合并到…' }));
    expect(screen.getByRole('dialog', { name: '合并概念？' })).toHaveTextContent('合并不可撤销');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }));
    await user.click(screen.getByRole('button', { name: '概念更多操作' }));
    await user.click(screen.getByRole('menuitem', { name: '删除概念' }));
    expect(screen.getByRole('dialog', { name: '删除概念？' })).toHaveTextContent('0 条关系');
  });
});
it('GET 旧快照不能覆盖已成功的命令', async () => {
  let finish: (value: { data: ConceptState }) => void = () => {};
  const stale = emptyConceptState();
  let gets = 0;
  let serverState = emptyConceptState();
  const request = vi.fn(async (url: string, options?: { body?: string }) => {
    if (url.endsWith('/commands')) {
      const command = JSON.parse(options!.body!).command as ConceptCommand;
      const changed = applyConceptCommand(serverState, [], command, {
        now: '2026-11-12T00:00:00Z',
        requestHash: 'a'.repeat(64)
      });
      serverState = mergeConceptChanges(serverState, changed);
      return { data: { changed } };
    }
    gets += 1;
    if (gets === 2)
      return new Promise<{ data: ConceptState }>(resolve => {
        finish = resolve;
      });
    return { data: gets > 2 ? serverState : emptyConceptState() };
  });
  const store = createConceptStore(request as never);
  await store.load();
  const loading = store.load();
  await act(async () => {
    await store.execute({
      type: 'createConcept',
      id: 'a',
      operationId: 'create',
      expectedRevision: 0,
      name: 'A'
    });
    finish({ data: stale });
    await loading;
  });
  expect(store.getState().concepts[0]?.name).toBe('A');
});

it('版本冲突自动刷新后保留失败原因和表单输入', async () => {
  const server = fixture([
    { type: 'createConcept', id: 'a', operationId: 'create-a', expectedRevision: 0, name: '原概念' }
  ]);
  const request = vi.fn(async (url: string) => {
    if (url.endsWith('/commands'))
      throw new ApiRequestError('概念已被其他设备更新，请重新核对版本', {
        status: 409,
        code: 'CONCEPT_REVISION_CONFLICT'
      });
    return { data: server.state() };
  });
  const store = createConceptStore(request as never);
  await store.load();
  render(<ConceptEditor concept={server.state().concepts[0]} canWrite store={store} onClose={vi.fn()} />);
  await userEvent.type(screen.getByRole('textbox', { name: '概念名称' }), '修改');
  await userEvent.click(screen.getByRole('button', { name: '保存概念' }));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
  expect(screen.getByRole('alert')).toHaveTextContent('其他设备更新');
  expect(screen.getByRole('textbox', { name: '概念名称' })).toHaveValue('原概念修改');
});
