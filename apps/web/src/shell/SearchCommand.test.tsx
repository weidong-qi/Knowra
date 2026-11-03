import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { CommandNoteSearchHit, CommandNoteSearcher } from '@study-accelerator/web-core';
import { SearchCommand, type SearchHit } from './SearchCommand';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function tick(ms = 180) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
const bodyHit = (id: string, snippet: string): CommandNoteSearchHit => ({ id, title: `合成资料 ${id}`, folderId: null, snippet });

function setup(search?: CommandNoteSearcher) {
  const onTitle = vi.fn(), onTag = vi.fn(), onHome = vi.fn(), onBody = vi.fn(), onOpenChange = vi.fn();
  const hits: SearchHit[] = [
    { id: 'action:home', primary: '返回主页', secondary: '回到早安页', group: '动作', onSelect: onHome },
    { id: 'note:title', primary: '本地标题', secondary: '合成目录', group: '资料', onSelect: onTitle },
    { id: 'tag:test', primary: '#合成标签', secondary: '按标签筛选', group: '标签', onSelect: onTag }
  ];
  const props = { isOpen: true, onOpenChange, hits,
    commandSearch: search ? { spaceId: 'space-a', search, onSelect: onBody } : undefined };
  const view = render(<SearchCommand {...props} />);
  return { ...view, props, onTitle, onTag, onHome, onBody, onOpenChange, input: screen.getByRole('combobox') };
}

describe('命令搜索交互', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  it('加载期间 Enter 不选择 DOM 中已隐藏的旧命中', () => {
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    render(<SearchCommand isOpen onOpenChange={onOpenChange} isLoading hits={[
      { id: 'note:old', primary: '旧结果', group: '资料', onSelect }
    ]} />);
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(onSelect).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('本地标题、标签、主页动作、清空和上下方向键继续工作', () => {
    const view = setup();
    expect(screen.getAllByRole('option')).toHaveLength(3);
    fireEvent.keyDown(view.input, { key: 'ArrowUp' });
    expect(view.input).toHaveAttribute('aria-activedescendant', 'search-hit-tag:test');
    fireEvent.keyDown(view.input, { key: 'ArrowDown' });
    expect(view.input).toHaveAttribute('aria-activedescendant', 'search-hit-action:home');
    for (const [query, callback] of [['本地', view.onTitle], ['合成标签', view.onTag], ['主页', view.onHome]] as const) {
      fireEvent.change(view.input, { target: { value: query } });
      expect(screen.getAllByRole('option')).toHaveLength(1);
      fireEvent.keyDown(view.input, { key: 'Enter' });
      expect(callback).toHaveBeenCalledTimes(1);
    }
    fireEvent.click(screen.getByRole('button', { name: '清除搜索关键字' }));
    expect(view.input).toHaveValue('');
    expect(screen.getAllByRole('option')).toHaveLength(3);
    expect(view.input).toHaveAttribute('maxlength', '200');
  });

  it('键盘高亮离屏时只滚动结果区，保留输入焦点且不触发选择', () => {
    const view = setup();
    const scrollport = document.getElementById('search-command-results')!;
    const options = screen.getAllByRole('option');
    Object.defineProperty(scrollport, 'clientHeight', { configurable: true, value: 100 });
    vi.spyOn(scrollport, 'getBoundingClientRect').mockReturnValue({ top: 10, bottom: 110 } as DOMRect);
    vi.spyOn(options[2], 'getBoundingClientRect').mockReturnValue({ top: 150, bottom: 190 } as DOMRect);
    vi.spyOn(options[0], 'getBoundingClientRect').mockReturnValue({ top: -70, bottom: -30 } as DOMRect);
    view.input.focus();
    fireEvent.keyDown(view.input, { key: 'ArrowUp' });
    expect(scrollport.scrollTop).toBe(80);
    expect(view.input).toHaveFocus();
    expect(view.input).toHaveAttribute('aria-activedescendant', 'search-hit-tag:test');
    expect(view.onTag).not.toHaveBeenCalled();
    fireEvent.keyDown(view.input, { key: 'ArrowDown' });
    expect(scrollport.scrollTop).toBe(0);
    expect(view.input).toHaveFocus();
    expect(view.onHome).not.toHaveBeenCalled();
    expect(view.onOpenChange).not.toHaveBeenCalled();
  });

  it('180ms 防抖合并输入，正文命中不经过标题二次过滤并可 Enter 打开', async () => {
    const note = bodyHit('body', '…完整正文中出现中文深处命中…');
    const search = vi.fn().mockResolvedValue([note]);
    const view = setup(search);
    fireEvent.change(view.input, { target: { value: '中文' } });
    await tick(100);
    fireEvent.change(view.input, { target: { value: '中文深处命中' } });
    await tick(179);
    expect(search).not.toHaveBeenCalled();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(view.input).not.toHaveAttribute('aria-activedescendant');
    fireEvent.keyDown(view.input, { key: 'Enter' });
    expect(view.onOpenChange).not.toHaveBeenCalled();
    await tick(1);
    expect(search).toHaveBeenCalledExactlyOnceWith({ query: '中文深处命中', spaceId: 'space-a' });
    expect(screen.getByRole('option')).toHaveTextContent(note.title);
    expect(screen.getByRole('option')).toHaveTextContent(note.snippet);
    fireEvent.keyDown(view.input, { key: 'Enter' });
    expect(view.onBody).toHaveBeenCalledExactlyOnceWith(note, expect.objectContaining({ isCurrent: expect.any(Function) }));
    expect(view.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('本地标题与正文同 ID 去重；服务端空结果仍保留本地标题、标签和动作', async () => {
    const search = vi.fn().mockResolvedValueOnce([{ ...bodyHit('title', '本地标题的正文片段'), title: '过期标题' }]).mockResolvedValue([]);
    const view = setup(search);
    fireEvent.change(view.input, { target: { value: '本地标题' } });
    await tick();
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option')).toHaveTextContent('本地标题的正文片段');
    expect(screen.getByRole('option')).not.toHaveTextContent('过期标题');
    fireEvent.keyDown(view.input, { key: 'Enter' });
    expect(view.onTitle).toHaveBeenCalledTimes(1);
    expect(view.onBody).not.toHaveBeenCalled();
    for (const query of ['合成标签', '主页']) {
      fireEvent.change(view.input, { target: { value: query } });
      await tick();
      expect(screen.getAllByRole('option')).toHaveLength(1);
    }
  });

  it('空白输入不请求正文，清空立即停止旧命中的展示和选择', async () => {
    const pending = deferred<CommandNoteSearchHit[]>();
    const search = vi.fn().mockReturnValue(pending.promise);
    const view = setup(search);
    fireEvent.change(view.input, { target: { value: '  ' } });
    await tick(300);
    expect(search).not.toHaveBeenCalled();
    fireEvent.change(view.input, { target: { value: '正文' } });
    await tick();
    fireEvent.click(screen.getByRole('button', { name: '清除搜索关键字' }));
    await act(async () => pending.resolve([bodyHit('late', '正文')]));
    expect(screen.queryByText('合成资料 late')).not.toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('查询变化立即隐藏 ready 结果，回到相同查询也需新响应', async () => {
    const pending = deferred<CommandNoteSearchHit[]>();
    const search = vi.fn().mockResolvedValueOnce([bodyHit('old', '旧正文')]).mockReturnValue(pending.promise);
    const view = setup(search);
    fireEvent.change(view.input, { target: { value: '正文' } });
    await tick();
    expect(screen.getByText('合成资料 old')).toBeInTheDocument();
    fireEvent.change(view.input, { target: { value: '新正文' } });
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    fireEvent.change(view.input, { target: { value: '正文' } });
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    fireEvent.keyDown(view.input, { key: 'Enter' });
    expect(view.onBody).not.toHaveBeenCalled();
    await tick();
    expect(search).toHaveBeenCalledTimes(2);
    await act(async () => pending.resolve([bodyHit('new', '新正文')]));
    expect(screen.getByText('合成资料 new')).toBeInTheDocument();
  });

  it('倒序响应只展示最新查询；旧失败不会覆盖新成功', async () => {
    const first = deferred<CommandNoteSearchHit[]>(), second = deferred<CommandNoteSearchHit[]>(), third = deferred<CommandNoteSearchHit[]>();
    const search = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
    const view = setup(search);
    fireEvent.change(view.input, { target: { value: '甲' } }); await tick();
    fireEvent.change(view.input, { target: { value: '乙' } }); await tick();
    fireEvent.change(view.input, { target: { value: '丙' } }); await tick();
    await act(async () => third.resolve([bodyHit('latest', '丙')]));
    await act(async () => second.reject(new Error('旧查询错误')));
    await act(async () => first.resolve([bodyHit('old', '甲')]));
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByText('合成资料 latest')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.keyDown(view.input, { key: 'Enter' });
    expect(view.onBody.mock.calls[0][0].id).toBe('latest');
  });

  it('切换空间立即禁止旧结果，旧空间响应不能覆盖新空间', async () => {
    const pending = deferred<CommandNoteSearchHit[]>();
    const search = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue([bodyHit('space-b', '正文')]);
    const view = setup(search);
    fireEvent.change(view.input, { target: { value: '正文' } }); await tick();
    view.rerender(<SearchCommand {...view.props} commandSearch={{ ...view.props.commandSearch!, spaceId: 'space-b' }} />);
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    fireEvent.keyDown(view.input, { key: 'Enter' });
    expect(view.onBody).not.toHaveBeenCalled();
    await tick();
    expect(search).toHaveBeenLastCalledWith({ query: '正文', spaceId: 'space-b' });
    await act(async () => pending.resolve([bodyHit('space-a-late', '正文')]));
    expect(screen.getByText('合成资料 space-b')).toBeInTheDocument();
    expect(screen.queryByText('合成资料 space-a-late')).not.toBeInTheDocument();
  });

  it('关闭取消防抖及响应发布，重开清空并隔离上次会话', async () => {
    const pending = deferred<CommandNoteSearchHit[]>();
    const search = vi.fn().mockReturnValue(pending.promise);
    const view = setup(search);
    fireEvent.change(view.input, { target: { value: '正文' } });
    view.rerender(<SearchCommand {...view.props} isOpen={false} />);
    await tick(300);
    expect(search).not.toHaveBeenCalled();
    view.rerender(<SearchCommand {...view.props} />);
    const input = screen.getByRole('combobox');
    expect(input).toHaveValue('');
    fireEvent.change(input, { target: { value: '正文' } }); await tick();
    view.rerender(<SearchCommand {...view.props} isOpen={false} />);
    await act(async () => pending.resolve([bodyHit('closed', '正文')]));
    expect(view.onOpenChange).not.toHaveBeenCalled();
    view.rerender(<SearchCommand {...view.props} />);
    expect(screen.getByRole('combobox')).toHaveValue('');
    expect(screen.queryByText('合成资料 closed')).not.toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('服务失败显式显示错误，Enter 不能跳旧结果；修改查询可重试', async () => {
    const search = vi.fn().mockResolvedValueOnce([bodyHit('old', '旧正文')]).mockRejectedValueOnce(new Error('合成 HTTP 503')).mockResolvedValue([]);
    const view = setup(search);
    fireEvent.change(view.input, { target: { value: '正文' } }); await tick();
    fireEvent.change(view.input, { target: { value: '新查询' } });
    fireEvent.keyDown(view.input, { key: 'Enter' });
    await tick();
    expect(screen.getByRole('alert')).toHaveTextContent('正文搜索失败');
    expect(screen.getByRole('alert')).toHaveTextContent('合成 HTTP 503');
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    fireEvent.keyDown(view.input, { key: 'Enter' });
    expect(view.onBody).not.toHaveBeenCalled();
    expect(view.onOpenChange).not.toHaveBeenCalled();
    fireEvent.change(view.input, { target: { value: '不存在' } }); await tick();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('没有匹配「不存在」的结果')).toBeInTheDocument();
  });

  it('中文 IME 组合期间不请求、展示或抢 Enter，结束后只搜索最终中文', async () => {
    const search = vi.fn().mockResolvedValue([bodyHit('中文', '正文中文')]);
    const view = setup(search);
    fireEvent.compositionStart(view.input);
    fireEvent.change(view.input, { target: { value: 'zhongwen' } }); await tick(500);
    fireEvent.keyDown(view.input, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(view.input, { key: 'Enter' });
    expect(search).not.toHaveBeenCalled();
    expect(view.onOpenChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    fireEvent.change(view.input, { target: { value: '正文中文' } });
    fireEvent.compositionEnd(view.input);
    await tick(179); expect(search).not.toHaveBeenCalled();
    await tick(1);
    expect(search).toHaveBeenCalledExactlyOnceWith({ query: '正文中文', spaceId: 'space-a' });
    fireEvent.keyDown(view.input, { key: 'Enter', keyCode: 229 });
    expect(view.onBody).not.toHaveBeenCalled();
    fireEvent.keyDown(view.input, { key: 'Enter' });
    expect(view.onBody).toHaveBeenCalledTimes(1);
  });

  it('缺少当前空间或程序传入超长查询时显式阻止请求与选择', async () => {
    const search = vi.fn().mockResolvedValue([]);
    const view = setup(search);
    view.rerender(<SearchCommand {...view.props} commandSearch={{ ...view.props.commandSearch!, spaceId: null }} />);
    fireEvent.change(view.input, { target: { value: '正文' } }); await tick();
    expect(screen.getByRole('alert')).toHaveTextContent('请选择当前空间');
    view.rerender(<SearchCommand {...view.props} />);
    fireEvent.change(view.input, { target: { value: '字'.repeat(201) } }); await tick();
    expect(screen.getByRole('alert')).toHaveTextContent('最多 200 字符');
    fireEvent.keyDown(view.input, { key: 'Enter' });
    expect(search).not.toHaveBeenCalled();
    expect(view.onBody).not.toHaveBeenCalled();
  });

  it('详情载入期间保持弹窗和 loading Enter 保护，callback 对象重建不取消实际选择', async () => {
    const note = bodyHit('new', '未预载正文');
    const view = setup(vi.fn().mockResolvedValue([note]));
    const pending = deferred<void>();
    view.onBody.mockReturnValue(pending.promise);
    fireEvent.change(view.input, { target: { value: '正文' } }); await tick();
    fireEvent.keyDown(view.input, { key: 'Enter' });
    expect(screen.getByText('正在载入笔记…')).toBeInTheDocument();
    fireEvent.keyDown(view.input, { key: 'Enter' });
    expect(view.onBody).toHaveBeenCalledTimes(1);
    expect(view.onOpenChange).not.toHaveBeenCalled();
    const context = view.onBody.mock.calls[0][1];
    const rebuiltOnSelect = vi.fn();
    view.rerender(<SearchCommand {...view.props} commandSearch={{ ...view.props.commandSearch!, onSelect: rebuiltOnSelect }} />);
    expect(context.isCurrent()).toBe(true);
    await act(async () => pending.resolve());
    expect(view.onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(rebuiltOnSelect).not.toHaveBeenCalled();
  });

  it('同空间 dataset key 变化时立即隐藏旧命中，必须接受新请求后才能选择', async () => {
    const search = vi.fn().mockResolvedValueOnce([bodyHit('old', '正文')]).mockResolvedValueOnce([bodyHit('new', '正文')]);
    const view = setup(search);
    fireEvent.change(view.input, { target: { value: '正文' } }); await tick();
    expect(screen.getByText('合成资料 old')).toBeInTheDocument();
    view.rerender(<SearchCommand {...view.props} commandSearch={{ ...view.props.commandSearch!, scopeKey: {} }} />);
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    fireEvent.keyDown(view.input, { key: 'Enter' });
    expect(view.onBody).not.toHaveBeenCalled();
    await tick();
    expect(search).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('option')).toHaveTextContent('合成资料 new');
  });

  it('关闭后迟到的详情失败不会设置隐藏错误或再次关闭新弹窗', async () => {
    const view = setup(vi.fn().mockResolvedValue([bodyHit('new', '正文')]));
    const pending = deferred<void>();
    view.onBody.mockReturnValueOnce(pending.promise);
    fireEvent.change(view.input, { target: { value: '正文' } }); await tick();
    fireEvent.keyDown(view.input, { key: 'Enter' });
    const context = view.onBody.mock.calls[0][1];
    fireEvent.click(screen.getByRole('button', { name: '关闭对话框' }));
    expect(context.isCurrent()).toBe(false);
    view.rerender(<SearchCommand {...view.props} isOpen={false} />);
    view.rerender(<SearchCommand {...view.props} />);
    await act(async () => pending.reject(new Error('旧详情失败')));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(view.onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(screen.getByRole('combobox')).toHaveValue('');
  });
});
