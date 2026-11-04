import { PdfSession } from './pdfSession';
import { pdfRequest } from './pdfApi';
import { exportPdfExcerpt } from './pdfGeometry';
import type { PdfAnnotation } from '@study-accelerator/shared/pdf';
vi.mock('./pdfApi', () => ({
  pdfRequest: vi.fn(),
  pdfHeaders: () => ({ 'X-Knowra-Dataset': 'original-dataset' }),
  randomId: () => crypto.randomUUID(),
  annotationUrl: (note: string, id: string) => `/api/pdf/${note}/annotations/${id}`
}));
const request = vi.mocked(pdfRequest);
const base = {
  id: 'mark',
  noteId: 'note',
  spaceId: 'space',
  attachmentId: 'file',
  sha256: 'a'.repeat(64),
  type: 'region' as const,
  segments: [{ pageIndex: 0, rect: [1, 2, 3, 4] as [number, number, number, number] }],
  quoteText: '',
  kind: 'important',
  comment: '',
  revision: 1,
  operationId: 'op',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  deletedAt: null
};
beforeEach(() => {
  request.mockReset();
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear()
  });
});
afterEach(() => vi.unstubAllGlobals());
it('在途评论更新串行提交，后续请求使用成功修订并保留最新文字', async () => {
  let finish!: (value: PdfAnnotation) => void;
  request
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve as typeof finish;
        })
    )
    .mockResolvedValueOnce({ ...base, revision: 2, comment: '最新' });
  const session = new PdfSession('note', base.sha256, 'test-key', () => {});
  await session.stage('mark', { ...base, comment: '第一版' });
  const flush = session.flush();
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  await session.stage('mark', { comment: '最新' });
  finish({ ...base, comment: '第一版' });
  await flush;
  expect(JSON.parse(request.mock.calls[1][1]!.body as string)).toMatchObject({ comment: '最新', expectedRevision: 1 });
  expect(session.values()[0].comment).toBe('最新');
  expect(session.drafts.size).toBe(0);
});
it('响应丢失后重开使用同一个操作和请求重试，不重复创建', async () => {
  request.mockRejectedValueOnce(new Error('lost response'));
  const session = new PdfSession('note', base.sha256, 'test-key', () => {});
  await session.stage('mark', base);
  await expect(session.flush()).rejects.toThrow('lost response');
  const first = request.mock.calls[0][1]!.body;
  const reopened = new PdfSession('note', base.sha256, 'test-key', () => {});
  reopened.recover();
  request.mockResolvedValueOnce(base);
  await reopened.flush();
  expect(request.mock.calls[1][1]!.body).toBe(first);
  expect(reopened.drafts.size).toBe(0);
});
it.each([false, true])('失败后继续编辑，重放旧请求后仍提交最新评论（重开：%s）', async reopen => {
  request.mockRejectedValueOnce(new Error('lost response'));
  let session = new PdfSession('note', base.sha256, 'test-key', () => {});
  session.items.set(base.id, base);
  await session.stage(base.id, { comment: '第一版' });
  await expect(session.flush()).rejects.toThrow('lost response');
  await session.stage(base.id, { comment: '失败后继续修改' });
  if (reopen) {
    session = new PdfSession('note', base.sha256, 'test-key', () => {});
    session.items.set(base.id, { ...base, revision: 2, comment: '第一版' });
    session.recover();
  }
  request
    .mockResolvedValueOnce({ ...base, revision: 2, comment: '第一版' })
    .mockResolvedValueOnce({ ...base, revision: 3, comment: '失败后继续修改' });
  await session.flush();
  expect(request).toHaveBeenCalledTimes(3);
  expect(request.mock.calls[1][1]!.body).toBe(request.mock.calls[0][1]!.body);
  const replay = JSON.parse(request.mock.calls[1][1]!.body as string);
  const latest = JSON.parse(request.mock.calls[2][1]!.body as string);
  expect(latest).toMatchObject({ comment: '失败后继续修改', expectedRevision: 2 });
  expect(latest.operationId).not.toBe(replay.operationId);
  expect(session.values()[0]).toMatchObject({ comment: '失败后继续修改', revision: 3 });
  expect(session.drafts.size).toBe(0);
  expect(localStorage.getItem('test-key')).toBeNull();
});
it('创建回执丢失后删除，先以原方法重放创建，再使用确认修订删除', async () => {
  request.mockRejectedValueOnce(new Error('lost response'));
  const session = new PdfSession('note', base.sha256, 'test-key', () => {});
  await session.stage(base.id, base);
  await expect(session.flush()).rejects.toThrow('lost response');
  await session.stage(base.id, {}, true);
  const reopened = new PdfSession('note', base.sha256, 'test-key', () => {});
  reopened.recover();
  request.mockResolvedValueOnce(base).mockResolvedValueOnce({ ...base, revision: 2, deletedAt: '2026-11-04' });
  await reopened.flush();
  expect(request.mock.calls.map(([, options]) => options!.method)).toEqual(['PUT', 'PUT', 'DELETE']);
  expect(request.mock.calls[1][1]!.body).toBe(request.mock.calls[0][1]!.body);
  expect(JSON.parse(request.mock.calls[2][1]!.body as string)).toMatchObject({ expectedRevision: 1 });
  expect(reopened.values()).toEqual([]);
  expect(reopened.drafts.size).toBe(0);
});
it('成功删除的墓碑保留修订，但不进入活动标注和摘录', async () => {
  const session = new PdfSession('note', base.sha256, 'test-key', () => {});
  session.items.set(base.id, { ...base, comment: '不应导出的已删评论' });
  request.mockResolvedValueOnce({ ...base, revision: 2, deletedAt: '2026-11-04', comment: '不应导出的已删评论' });
  await session.stage(base.id, {}, true);
  expect(session.values()).toEqual([]);
  await session.flush();
  expect(session.items.get(base.id)?.revision).toBe(2);
  expect(session.values()).toEqual([]);
  expect(exportPdfExcerpt('资料', 'note', session.values())).not.toContain('不应导出的已删评论');
  expect(session.drafts.size).toBe(0);
});
it.each(['edit', 'delete', 'legacy'] as const)('恢复未发送的草稿保留原修订，远端变更必须核对（%s）', async mode => {
  const original = new PdfSession('note', base.sha256, 'test-key', () => {});
  original.items.set(base.id, base);
  await original.stage(base.id, { comment: '本机未保存评论' }, mode === 'delete');
  if (mode === 'legacy') {
    const legacy = JSON.parse(localStorage.getItem('test-key')!);
    delete legacy.drafts[0].expectedRevision;
    localStorage.setItem('test-key', JSON.stringify(legacy));
  }
  const remote = { ...base, revision: 2, comment: '其他窗口的新评论' };
  const reopened = new PdfSession('note', base.sha256, 'test-key', () => {});
  reopened.items.set(base.id, remote);
  reopened.recover();
  request.mockRejectedValueOnce(Object.assign(new Error('conflict'), { code: 'PDF_ANNOTATION_CONFLICT' }));
  await expect(reopened.flush()).rejects.toThrow('conflict');
  expect(JSON.parse(request.mock.calls[0][1]!.body as string)).toMatchObject({ expectedRevision: 1 });
  expect(reopened.errorCode).toBe('PDF_ANNOTATION_CONFLICT');
  expect(reopened.drafts.size).toBe(1);
  expect(localStorage.getItem('test-key')).toContain('本机未保存评论');
  await reopened.reconcile(base.id, remote, true);
  request.mockResolvedValueOnce({
    ...remote,
    revision: 3,
    comment: '本机未保存评论',
    deletedAt: mode === 'delete' ? '2026-11-04' : null
  });
  await reopened.flush();
  expect(JSON.parse(request.mock.calls[1][1]!.body as string)).toMatchObject({ expectedRevision: 2 });
  expect(reopened.drafts.size).toBe(0);
});
it('恢复尚未创建的草稿时，不能把远端同名 ID 当作已确认基线', async () => {
  const original = new PdfSession('note', base.sha256, 'test-key', () => {});
  await original.stage(base.id, { type: base.type, segments: base.segments, quoteText: '', comment: '本机新标注' });
  const reopened = new PdfSession('note', base.sha256, 'test-key', () => {});
  reopened.items.set(base.id, base);
  reopened.recover();
  request.mockRejectedValueOnce(Object.assign(new Error('conflict'), { code: 'PDF_ANNOTATION_CONFLICT' }));
  await expect(reopened.flush()).rejects.toThrow('conflict');
  expect(JSON.parse(request.mock.calls[0][1]!.body as string)).toMatchObject({ expectedRevision: 0 });
  expect(reopened.drafts.size).toBe(1);
});
it('未提交标注删除不产生请求；只读状态保留恢复草稿', async () => {
  const session = new PdfSession(
    'note',
    base.sha256,
    'test-key',
    () => {},
    () => false
  );
  await session.stage('mark', base);
  await session.stage('mark', {}, true);
  await session.flush();
  expect(request).not.toHaveBeenCalled();
  await session.stage('mark', base);
  await expect(session.flush()).rejects.toThrow('只读');
  expect(session.drafts.size).toBe(1);
  expect(localStorage.getItem('test-key')).toContain('mark');
});
it('哈希不一致的恢复草稿不能写入新 PDF', async () => {
  const session = new PdfSession('note', base.sha256, 'test-key', () => {});
  await session.stage('mark', base);
  const other = new PdfSession('note', 'b'.repeat(64), 'test-key', () => {});
  expect(() => other.recover()).toThrow('不匹配');
});

it('远端已删除标注时，本机未保存评论仍保留原选区；损坏草稿不会被退出覆盖', async () => {
  const session = new PdfSession('note', base.sha256, 'test-key', () => {});
  session.items.set(base.id, base);
  await session.stage(base.id, { comment: '未保存评论' });
  const reopened = new PdfSession('note', base.sha256, 'test-key', () => {});
  reopened.recover();
  expect(reopened.values()[0]).toMatchObject({ comment: '未保存评论', segments: base.segments });
  const raw = JSON.stringify({ version: 1, sha256: base.sha256, drafts: [{ id: 'invalid', fields: {} }] });
  localStorage.setItem('invalid-key', raw);
  const invalid = new PdfSession('note', base.sha256, 'invalid-key', () => {});
  expect(() => invalid.recover()).toThrow('无效');
  await expect(invalid.persist()).rejects.toThrow('无效');
  expect(localStorage.getItem('invalid-key')).toBe(raw);
});

it('非法 JSON 的恢复草稿仍保留原始字节', async () => {
  localStorage.setItem('broken', '{bad json');
  const session = new PdfSession('note', base.sha256, 'broken', () => {});
  expect(() => session.recover()).toThrow();
  await expect(session.persist()).rejects.toThrow();
  expect(localStorage.getItem('broken')).toBe('{bad json');
});

it('并发冲突经用户核对后以最新修订保存；远端删除时保留为新标注', async () => {
  const session = new PdfSession('note', base.sha256, 'test-key', () => {});
  session.items.set(base.id, base);
  await session.stage(base.id, { comment: '本机评论' });
  request.mockRejectedValueOnce(Object.assign(new Error('conflict'), { code: 'PDF_ANNOTATION_CONFLICT' }));
  await expect(session.flush()).rejects.toThrow('conflict');
  expect(session.errorCode).toBe('PDF_ANNOTATION_CONFLICT');
  await session.reconcile(base.id, { ...base, revision: 2, comment: '最新版本' }, true);
  request.mockResolvedValueOnce({ ...base, revision: 3, comment: '本机评论' });
  await session.flush();
  expect(JSON.parse(request.mock.calls[1][1]!.body as string)).toMatchObject({
    comment: '本机评论',
    expectedRevision: 2
  });
  await session.stage(base.id, { comment: '删除后的本机草稿' });
  const copiedId = await session.reconcile(base.id, null, true);
  expect(copiedId).not.toBe(base.id);
  request.mockResolvedValueOnce({ ...base, id: copiedId, revision: 1 });
  await session.flush();
  expect(JSON.parse(request.mock.calls[2][1]!.body as string).expectedRevision).toBe(0);
});
it('恢复完成前离开不会清除已有的持久化草稿', async () => {
  const stored = JSON.stringify({
    version: 1,
    sha256: base.sha256,
    drafts: [{ id: base.id, fields: base, expectedRevision: 0 }]
  });
  localStorage.setItem('guard-key', stored);
  const session = new PdfSession(
    'note',
    base.sha256,
    'guard-key',
    () => {},
    () => true,
    true
  );
  await session.persist();
  expect(localStorage.getItem('guard-key')).toBe(stored);
  session.recover();
  expect(session.drafts.size).toBe(1);
  await session.persist();
  expect(localStorage.getItem('guard-key')).not.toBeNull();
});
it('队首标注冲突时跳过它继续保存其余标注，并指向冲突标注供核对', async () => {
  const conflict = Object.assign(new Error('标注已变化'), { code: 'PDF_ANNOTATION_CONFLICT' });
  request.mockImplementation(async (url: string) => {
    if (url.endsWith('/stale')) throw conflict;
    return { ...base, id: 'fresh', revision: 1 };
  });
  const session = new PdfSession('note', base.sha256, 'test-key', () => {});
  await session.stage('stale', { ...base, id: 'stale' });
  await session.stage('fresh', { ...base, id: 'fresh' });
  await expect(session.flush()).rejects.toBe(conflict);
  expect([...session.drafts.keys()]).toEqual(['stale']);
  expect(session.conflictId()).toBe('stale');
  expect(session.errorCode).toBe('PDF_ANNOTATION_CONFLICT');
});
