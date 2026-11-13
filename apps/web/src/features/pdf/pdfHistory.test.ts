import type { PdfAnnotation } from '@study-accelerator/shared/pdf';
import { PdfSession } from './pdfSession';
import { PdfHistory } from './pdfHistory';
import { pdfRequest } from './pdfApi';
vi.mock('./pdfApi', async original => ({
  ...(await original<typeof import('./pdfApi')>()),
  pdfRequest: vi.fn(),
  pdfHeaders: () => ({})
}));
const request = vi.mocked(pdfRequest);
const base = {
  id: 'mark',
  type: 'highlight',
  kind: 'important',
  comment: '原批注',
  quoteText: '原文',
  segments: [{ pageIndex: 0, rect: [1, 2, 10, 12] }],
  revision: 1,
  deletedAt: null,
  sha256: 'a'.repeat(64)
} as PdfAnnotation;
function setup(saved = true, canWrite = () => true) {
  const session = new PdfSession('note', base.sha256, 'history-test', () => {});
  if (saved) session.items.set(base.id, structuredClone(base));
  const history = new PdfHistory(session, () => {}, canWrite);
  return { session, history };
}
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key)
  });
  request.mockReset();
  request.mockImplementation(async (url, options) => {
    const input = JSON.parse(String(options!.body));
    return {
      ...base,
      ...input,
      id: String(url).split('/').at(-1),
      revision: input.expectedRevision + 1,
      deletedAt: options!.method === 'DELETE' ? 'deleted' : null
    };
  });
});
afterEach(() => vi.unstubAllGlobals());
it('未发送的新标注可撤销重做，不创建多余记录', async () => {
  const { session, history } = setup(false);
  await history.stage(base.id, base);
  await history.move();
  await session.flush();
  expect(session.values()).toEqual([]);
  expect(request).not.toHaveBeenCalled();
  expect(history.canRedo).toBe(true);
  await history.move(true);
  await session.flush();
  expect(session.values()[0]).toMatchObject({ id: base.id, quoteText: '原文' });
  expect(request).toHaveBeenCalledTimes(1);
});
it('已保存的新标注撤销后重做使用新身份，保留删除事实', async () => {
  const { session, history } = setup(false);
  await history.stage(base.id, base);
  await session.flush();
  await history.move();
  await session.flush();
  expect(session.items.get(base.id)?.deletedAt).toBe('deleted');
  const restored = await history.move(true);
  await session.flush();
  expect(restored).not.toBe(base.id);
  expect(session.values()).toHaveLength(1);
  expect(session.values()[0]).toMatchObject({ quoteText: base.quoteText, segments: base.segments });
});
it('撤销已保存删除后，前序改色历史继续作用于恢复后的标注', async () => {
  const { session, history } = setup();
  await history.stage(base.id, { kind: 'question' });
  await session.flush();
  await history.stage(base.id, {}, true);
  await session.flush();
  const restored = await history.move();
  await session.flush();
  expect(restored).not.toBe(base.id);
  expect(session.values()[0].kind).toBe('question');
  await history.move();
  await session.flush();
  expect(session.values()[0].kind).toBe('important');
  await history.move(true);
  await session.flush();
  expect(session.values()[0].kind).toBe('question');
  await history.move(true);
  await session.flush();
  expect(session.values()).toEqual([]);
});
it('未发送删除撤销保留原身份，连续输入批注合并为一步', async () => {
  const { session, history } = setup();
  await history.stage(base.id, { comment: '新' });
  await history.stage(base.id, { comment: '新批注' });
  await history.move();
  expect(session.values()[0].comment).toBe('原批注');
  expect(history.canUndo).toBe(false);
  await history.move(true);
  expect(session.values()[0].comment).toBe('新批注');
  await history.stage(base.id, {}, true);
  await history.move();
  expect(session.values()[0]).toMatchObject({ id: base.id, comment: '新批注' });
});
it('撤销后新的编辑清空重做分支；只读时不执行历史或修改', async () => {
  const { history } = setup();
  await history.stage(base.id, { kind: 'question' });
  await history.move();
  await history.stage(base.id, { kind: 'pitfall' });
  expect(history.canRedo).toBe(false);
  let writable = true;
  const other = setup(true, () => writable);
  await other.history.stage(base.id, { kind: 'question' });
  writable = false;
  expect(await other.history.move()).toBeNull();
  await expect(other.history.stage(base.id, { comment: '不应写入' })).rejects.toThrow('无法修改');
  expect(other.session.values()[0].kind).toBe('question');
});
it('丢失回执后先幂等重放，再按确认修订撤销，保持原 CAS 基线', async () => {
  const { session, history } = setup();
  await history.stage(base.id, { comment: '新批注' });
  request.mockRejectedValueOnce(new Error('lost response'));
  await expect(session.flush()).rejects.toThrow('lost');
  await history.move();
  await session.flush();
  expect(request.mock.calls[1][1]!.body).toBe(request.mock.calls[0][1]!.body);
  expect(JSON.parse(String(request.mock.calls[2][1]!.body))).toMatchObject({ comment: '原批注', expectedRevision: 2 });
});
it('撤销仍受并发校验约束，冲突保留草稿且暂停历史操作', async () => {
  const { session, history } = setup();
  await history.stage(base.id, { kind: 'question' });
  await session.flush();
  await history.move();
  request.mockRejectedValueOnce(Object.assign(new Error('conflict'), { code: 'PDF_ANNOTATION_CONFLICT' }));
  await expect(session.flush()).rejects.toThrow('conflict');
  expect(JSON.parse(String(request.mock.calls[1][1]!.body))).toMatchObject({ expectedRevision: 2, kind: 'important' });
  expect(session.drafts.size).toBe(1);
  expect(history.canRedo).toBe(false);
});
it('核对并采用外部内容后可清空历史，不覆盖新的来源状态', async () => {
  const { history } = setup();
  await history.stage(base.id, { kind: 'question' });
  history.clear();
  expect(history.canUndo).toBe(false);
  expect(history.canRedo).toBe(false);
});

it('保存进行中撤销等待当前回执，等待时不接受其他历史改写', async () => {
  const { session, history } = setup();
  let finish: (value: PdfAnnotation) => void = () => {};
  request.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve as typeof finish;
      })
  );
  await history.stage(base.id, { kind: 'question' });
  const saving = session.flush();
  await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
  const undo = history.move();
  expect(history.busy).toBe(true);
  await expect(history.stage(base.id, { comment: '不应接受' })).rejects.toThrow('无法修改');
  finish({ ...base, kind: 'question', revision: 2 });
  await saving;
  await undo;
  await session.flush();
  expect(session.values()[0].kind).toBe('important');
  expect(JSON.parse(String(request.mock.calls[1][1]!.body))).toMatchObject({ expectedRevision: 2 });
});
it('当前内容被外部替换时拒绝撤销，不将旧快照覆盖到外部版本', async () => {
  const { session, history } = setup();
  await history.stage(base.id, { kind: 'question' });
  session.drafts.clear();
  session.items.set(base.id, { ...base, kind: 'pitfall', revision: 3 });
  await expect(history.move()).rejects.toThrow('内容已变化');
  expect(session.values()[0].kind).toBe('pitfall');
  expect(request).not.toHaveBeenCalled();
});

it('便签连续改名合并为一步，标题与正文分别撤销，保存后重做保留标题', async () => {
  const { session, history } = setup();
  session.items.set(base.id, { ...base, type: 'note', quoteText: '' });
  await history.stage(base.id, { title: '自' });
  await history.stage(base.id, { title: '自定义便签' });
  await history.stage(base.id, { comment: '新的正文' });
  await session.flush();
  await history.move();
  expect(session.values()[0]).toMatchObject({ title: '自定义便签', comment: base.comment });
  await history.move();
  await session.flush();
  expect(session.values()[0].title).toBe('');
  expect(history.canUndo).toBe(false);
  await history.move(true);
  await session.flush();
  expect(session.values()[0].title).toBe('自定义便签');
  await history.stage(base.id, {}, true);
  await session.flush();
  await history.move();
  await session.flush();
  expect(session.values()[0]).toMatchObject({ type: 'note', title: '自定义便签', comment: base.comment });
});
