import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ConversationAttachmentPicker, type ConversationAttachment, type ConversationAttachmentApi } from './ConversationAttachmentPicker';
const attachment: ConversationAttachment = {
  attachmentId: 'attachment', conversationId: 'conversation', revision: 2, fileName: '资料.txt', mimeType: 'text/plain', size: 6,
  sha256: 'a'.repeat(64), storageStatus: 'ready', parseStatus: 'not_parsed', errorCode: 'AI_ATTACHMENT_NOT_PARSED', parserVersion: null,
  parsedTextHash: null, imageMetadata: null, removedAt: null, createdAt: '2026-10-04T00:00:00Z', updatedAt: '2026-10-04T00:00:00Z'
};
let api: ConversationAttachmentApi;
let createObjectURL: ReturnType<typeof vi.fn<(blob: Blob | MediaSource) => string>>;
let revokeObjectURL: ReturnType<typeof vi.fn<(url: string) => void>>;
beforeEach(() => {
  api = { list: vi.fn(async () => []), upload: vi.fn(async () => attachment),
    preview: vi.fn(async () => ({ attachment, segments: [], imageMetadata: null })),
    content: vi.fn(async () => new Blob(['image'], { type: 'image/png' })), remove: vi.fn(async () => ({ ...attachment, storageStatus: 'removed' as const })) };
  createObjectURL = vi.fn((_blob: Blob | MediaSource) => 'blob:owned-image'); revokeObjectURL = vi.fn((_url: string) => {});
  const NativeURL = globalThis.URL;
  vi.stubGlobal('URL', class extends NativeURL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = revokeObjectURL;
  });
});
afterEach(() => { vi.unstubAllGlobals(); });
function choose(file: File) { fireEvent.change(screen.getByLabelText('添加对话附件'), { target: { files: [file] } }); }
async function open(conversationId: string | null = 'conversation', ensureConversation = vi.fn(async () => 'conversation')) {
  const view = render(<ConversationAttachmentPicker conversationId={conversationId} ensureConversation={ensureConversation} api={api} />);
  fireEvent.click(screen.getByText('附件（0）'));
  const dialog = await screen.findByRole('dialog', { name: '对话附件管理' });
  // 弹层尚未挂载时，恢复提示同样不存在；正向等待可交互状态后再上传或粘贴。
  await waitFor(() => expect(within(dialog).getByLabelText('添加对话附件')).toBeEnabled());
  return { view, ensureConversation };
}
it('打开附件等待弹层挂载和附件恢复完成', async () => {
  let release!: (rows: ConversationAttachment[]) => void;
  const delayed = new Promise<ConversationAttachment[]>(resolve => { release = resolve; });
  vi.mocked(api.list).mockReturnValueOnce(delayed);
  let opened = false;
  const opening = open().then(result => { opened = true; return result; });
  await screen.findByRole('dialog', { name: '对话附件管理' });
  expect(screen.getByText('正在恢复附件…')).toBeInTheDocument();
  expect(screen.getByLabelText('添加对话附件')).toBeDisabled();
  expect(opened).toBe(false);
  await act(async () => { release([]); await delayed; });
  await opening;
  expect(screen.getByLabelText('添加对话附件')).toBeEnabled();
});
it('上传只保存会话附件，信息预览无正文且移除使用原revision', async () => {
  await open(); choose(new File(['合成内容'], '资料.txt', { type: 'text/plain' }));
  await screen.findByText('已保存到此对话；尚未发送给 AI');
  expect(api.upload).toHaveBeenCalledWith('conversation', expect.objectContaining({ uploadKey: expect.any(String), fileName: '资料.txt', mimeType: 'text/plain', contentBase64: expect.any(String) }));
  fireEvent.click(screen.getByRole('button', { name: '预览 资料.txt' })); await screen.findByText('仅显示附件信息，当前不提供文档正文预览。');
  expect(api.content).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '移除 资料.txt' }));
  await waitFor(() => expect(screen.queryByText('已保存到此对话；尚未发送给 AI')).not.toBeInTheDocument());
  expect(api.remove).toHaveBeenCalledWith('conversation', 'attachment', 2); expect(screen.queryByLabelText('附件预览')).not.toBeInTheDocument();
});
it('无会话时先确保会话，失败响应重试复用uploadKey和payload', async () => {
  vi.mocked(api.upload).mockRejectedValueOnce(new Error('上传响应丢失')).mockResolvedValueOnce(attachment);
  const { ensureConversation } = await open(null);
  choose(new File(['data'], '资料.txt', { type: 'text/plain' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('上传响应丢失');
  expect(screen.getByText(/上传未完成/)).toHaveTextContent('资料.txt');
  fireEvent.click(screen.getByRole('button', { name: '重试上传' })); await screen.findByText('已保存到此对话；尚未发送给 AI');
  expect(ensureConversation).toHaveBeenCalledOnce(); expect(vi.mocked(api.upload).mock.calls[1]).toEqual(vi.mocked(api.upload).mock.calls[0]);
});
it('原上传被移除后重试不能把removed记录当成已保存附件', async () => {
  vi.mocked(api.upload).mockRejectedValueOnce(new Error('响应丢失')).mockResolvedValueOnce({ ...attachment, storageStatus: 'removed', removedAt: '2026-10-04T01:00:00Z' });
  await open(); choose(new File(['data'], '资料.txt', { type: 'text/plain' })); await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: '重试上传' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('附件已被移除');
  expect(screen.queryByText('已保存到此对话；尚未发送给 AI')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '重试上传' })).not.toBeInTheDocument();
});
it('新建会话后prop切换为自身目标不丢失上传结果', async () => {
  let release!: (row: ConversationAttachment) => void;
  const delayed = new Promise<ConversationAttachment>(resolve => { release = resolve; });
  vi.mocked(api.upload).mockReturnValueOnce(delayed);
  const { view, ensureConversation } = await open(null);
  choose(new File(['data'], '资料.txt', { type: 'text/plain' }));
  await waitFor(() => expect(api.upload).toHaveBeenCalledOnce());
  view.rerender(<ConversationAttachmentPicker conversationId="conversation" ensureConversation={ensureConversation} api={api} />);
  await act(async () => { release(attachment); await delayed; });
  expect(await screen.findByText('已保存到此对话；尚未发送给 AI')).toBeInTheDocument();
});
it('确保会话失败不上传，也保留失败文件供用户移除', async () => {
  const ensure = vi.fn(async () => { throw new Error('会话创建失败'); });
  await open(null, ensure); choose(new File(['text'], '资料.txt', { type: 'text/plain' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('会话创建失败'); expect(api.upload).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '移除待上传文件' })); expect(screen.queryByText(/上传未完成/)).not.toBeInTheDocument();
});
it.each([
  ['旧文件.doc', 'legacy', '旧版 DOC 暂不支持'],
  ['程序.exe', 'other', '不支持此文件类型'],
  ['空文件.txt', '', '文件为空'],
  ['超限.pdf', 'oversized', '不能超过 5 MB']
])('不支持或无效文件保留失败状态并阻止上传：%s', async (fileName, content, message) => {
  const file = new File([content === 'oversized' ? new Uint8Array(5 * 1024 * 1024 + 1) : content], fileName);
  const { ensureConversation } = await open(null); choose(file);
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(api.upload).not.toHaveBeenCalled(); expect(ensureConversation).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: '重试上传' })).not.toBeInTheDocument();
});
it('未解析文档显示明确限制，旧预览正文或元数据也不能被展示', async () => {
  vi.mocked(api.list).mockResolvedValueOnce([attachment]);
  vi.mocked(api.preview).mockResolvedValueOnce({ attachment, segments: [{ text: '不应展示的旧正文', start: 0, end: 9 }], imageMetadata: { width: 40, height: 30, format: 'png' } });
  await open(); expect(screen.getByText('未解析，不能用于附件问答；尚未发送给 AI。')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '预览 资料.txt' }));
  await screen.findByText('仅显示附件信息，当前不提供文档正文预览。');
  expect(screen.getByText('text/plain · 6 字节')).toBeInTheDocument();
  expect(screen.queryByText('不应展示的旧正文')).not.toBeInTheDocument();
  expect(screen.queryByText(/40 × 30/)).not.toBeInTheDocument(); expect(api.content).not.toHaveBeenCalled();
});
it('粘贴PNG只上传会话，图片内容从受保护API取blob并移除时撤销URL', async () => {
  const image = { ...attachment, fileName: '粘贴图片.png', mimeType: 'image/png', parseStatus: 'not_parsed' as const,
    imageMetadata: null };
  vi.mocked(api.upload).mockResolvedValueOnce(image);
  vi.mocked(api.preview).mockResolvedValueOnce({ attachment: image, segments: [], imageMetadata: image.imageMetadata });
  await open();
  fireEvent.paste(screen.getByLabelText('对话附件'), { clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => new File(['png'], 'clipboard', { type: 'image/png' }) }] } });
  await screen.findByText('当前模型尚不支持图片理解。');
  expect(api.upload).toHaveBeenCalledWith('conversation', expect.objectContaining({ fileName: '粘贴图片.png', mimeType: 'image/png' }));
  fireEvent.click(screen.getByRole('button', { name: '预览 粘贴图片.png' }));
  expect(await screen.findByRole('img')).toHaveAttribute('src', 'blob:owned-image');
  expect(api.content).toHaveBeenCalledWith('conversation', 'attachment');
  fireEvent.click(screen.getByRole('button', { name: '移除 粘贴图片.png' }));
  await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:owned-image'));
});
it('切换对话后迟到上传与预览不会混入新会话', async () => {
  let release!: (row: ConversationAttachment) => void;
  const delayed = new Promise<ConversationAttachment>(resolve => { release = resolve; });
  vi.mocked(api.upload).mockReturnValueOnce(delayed);
  const { view, ensureConversation } = await open(); choose(new File(['text'], '资料.txt', { type: 'text/plain' }));
  await waitFor(() => expect(api.upload).toHaveBeenCalledOnce());
  view.rerender(<ConversationAttachmentPicker conversationId="another-conversation" ensureConversation={ensureConversation} api={api} />);
  await act(async () => { release(attachment); await delayed; });
  expect(screen.queryByText('已保存到此对话；尚未发送给 AI')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('删除版本冲突保留原附件和预览', async () => {
  vi.mocked(api.list).mockResolvedValueOnce([attachment]); vi.mocked(api.remove).mockRejectedValueOnce(Object.assign(new Error('内部错误'), { code: 'AI_ATTACHMENT_CONFLICT' }));
  await open(); fireEvent.click(screen.getByRole('button', { name: '预览 资料.txt' })); await screen.findByText('仅显示附件信息，当前不提供文档正文预览。');
  fireEvent.click(screen.getByRole('button', { name: '移除 资料.txt' })); expect(await screen.findByRole('alert')).toHaveTextContent('附件版本已变化');
  expect(screen.getByText('仅显示附件信息，当前不提供文档正文预览。')).toBeInTheDocument(); expect(screen.getByText('已保存到此对话；尚未发送给 AI')).toBeInTheDocument();
  vi.mocked(api.list).mockResolvedValueOnce([{ ...attachment, revision: 3 }]);
  fireEvent.click(screen.getByRole('button', { name: '刷新附件' })); await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole('button', { name: '移除 资料.txt' }));
  await waitFor(() => expect(api.remove).toHaveBeenLastCalledWith('conversation', 'attachment', 3));
});
it('粘贴JPEG使用JPEG文件名与mime，不当成PNG', async () => {
  await open(); fireEvent.paste(screen.getByLabelText('对话附件'), { clipboardData: { items: [{ kind: 'file', type: 'image/jpeg',
    getAsFile: () => new File(['jpeg'], 'clipboard', { type: 'image/jpeg' }) }] } });
  await waitFor(() => expect(api.upload).toHaveBeenCalledWith('conversation', expect.objectContaining({ fileName: '粘贴图片.jpg', mimeType: 'image/jpeg' })));
});
it('迟到附件列表不覆盖同一新会话刚上传成功的附件', async () => {
  let release!: (rows: ConversationAttachment[]) => void;
  const delayed = new Promise<ConversationAttachment[]>(resolve => { release = resolve; });
  let finishUpload!: (row: ConversationAttachment) => void;
  const uploadResponse = new Promise<ConversationAttachment>(resolve => { finishUpload = resolve; });
  vi.mocked(api.upload).mockReturnValueOnce(uploadResponse);
  const { view, ensureConversation } = await open(null);
  vi.mocked(api.list).mockReturnValueOnce(delayed);
  choose(new File(['text'], '资料.txt', { type: 'text/plain' }));
  await waitFor(() => expect(api.upload).toHaveBeenCalledOnce());
  view.rerender(<ConversationAttachmentPicker conversationId="conversation" ensureConversation={ensureConversation} api={api} />);
  await act(async () => { finishUpload(attachment); await uploadResponse; });
  await screen.findByText('已保存到此对话；尚未发送给 AI');
  await act(async () => { release([]); await delayed; });
  expect(screen.getByText('已保存到此对话；尚未发送给 AI')).toBeInTheDocument();
});
it('切换对话后迟到图片blob不会创建或泄漏objectURL', async () => {
  const image = { ...attachment, fileName: '图片.png', mimeType: 'image/png', parseStatus: 'not_parsed' as const };
  vi.mocked(api.list).mockResolvedValueOnce([image]);
  vi.mocked(api.preview).mockResolvedValueOnce({ attachment: image, segments: [], imageMetadata: null });
  let release!: (blob: Blob) => void;
  const delayed = new Promise<Blob>(resolve => { release = resolve; }); vi.mocked(api.content).mockReturnValueOnce(delayed);
  const { view, ensureConversation } = await open(); fireEvent.click(screen.getByRole('button', { name: '预览 图片.png' }));
  await waitFor(() => expect(api.content).toHaveBeenCalled());
  expect(screen.getByRole('button', { name: '刷新附件' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '刷新附件' }));
  expect(api.list).toHaveBeenCalledOnce();
  view.rerender(<ConversationAttachmentPicker conversationId="other" ensureConversation={ensureConversation} api={api} />);
  await act(async () => { release(new Blob(['png'])); await delayed; });
  expect(createObjectURL).not.toHaveBeenCalled(); expect(screen.queryByRole('img')).not.toBeInTheDocument();
});
it('卸载组件释放已创建图片预览URL', async () => {
  const image = { ...attachment, fileName: '图片.png', mimeType: 'image/png', parseStatus: 'not_parsed' as const };
  vi.mocked(api.list).mockResolvedValueOnce([image]); vi.mocked(api.preview).mockResolvedValueOnce({ attachment: image, segments: [], imageMetadata: null });
  const { view } = await open(); fireEvent.click(screen.getByRole('button', { name: '预览 图片.png' })); await screen.findByRole('img');
  view.unmount(); expect(revokeObjectURL).toHaveBeenCalledWith('blob:owned-image');
});
it('存储操作错误用中文解释，不暴露内部错误码', async () => {
  vi.mocked(api.remove).mockRejectedValueOnce(Object.assign(new Error('internal detail'), { code: 'AI_ATTACHMENT_FILE_MISSING' }));
  vi.mocked(api.list).mockResolvedValueOnce([attachment]); await open();
  fireEvent.click(screen.getByRole('button', { name: '移除 资料.txt' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('附件内容缺失');
  expect(screen.queryByText('AI_ATTACHMENT_FILE_MISSING')).not.toBeInTheDocument();
});
it('图片像素解码失败显式报错并释放URL', async () => {
  const image = { ...attachment, fileName: '图片.png', mimeType: 'image/png', parseStatus: 'not_parsed' as const };
  vi.mocked(api.list).mockResolvedValueOnce([image]); vi.mocked(api.preview).mockResolvedValueOnce({ attachment: image, segments: [], imageMetadata: null });
  await open(); fireEvent.click(screen.getByRole('button', { name: '预览 图片.png' })); const img = await screen.findByRole('img');
  fireEvent.error(img); expect(await screen.findByRole('alert')).toHaveTextContent('图片内容无法显示');
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:owned-image'); expect(screen.queryByRole('img')).not.toBeInTheDocument();
});

it('文件缺失保留附件信息与移除入口，禁止正文或图片预览', async () => {
  vi.mocked(api.list).mockResolvedValueOnce([{ ...attachment, storageStatus: 'missing', parseStatus: 'failed', errorCode: 'AI_ATTACHMENT_FILE_MISSING' }]);
  await open(); expect(screen.getByText('附件内容缺失，请移除后重新上传。')).toBeInTheDocument();
  expect(screen.getByText('未解析，不能用于附件问答；尚未发送给 AI。')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '预览 资料.txt' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '移除 资料.txt' })).toBeEnabled(); expect(api.content).not.toHaveBeenCalled();
});

it.each(['弹层', '消息输入区'])('%s粘贴图片仅上传一次', async (target) => {
  const image = { ...attachment, fileName: '粘贴图片.png', mimeType: 'image/png' };
  vi.mocked(api.upload).mockResolvedValueOnce(image);
  await open();
  const composer = document.createElement('textarea');
  composer.setAttribute('data-conversation-composer', ''); document.body.append(composer);
  const element = target === '弹层' ? screen.getByRole('dialog', { name: '对话附件管理' }) : composer;
  fireEvent.paste(element, { clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => new File(['png'], 'clipboard', { type: 'image/png' }) }] } });
  await screen.findByRole('button', { name: '预览 粘贴图片.png' });
  expect(api.upload).toHaveBeenCalledOnce();
  expect(api.upload).toHaveBeenCalledWith('conversation', expect.objectContaining({ fileName: '粘贴图片.png', mimeType: 'image/png' }));
  composer.remove();
});


it('禁用状态阻止已打开弹层的文件选择和图片粘贴，恢复后保留上传能力', async () => {
  const ensureConversation = vi.fn(async () => 'conversation');
  const view = render(<ConversationAttachmentPicker conversationId={null} ensureConversation={ensureConversation} api={api} />);
  fireEvent.click(screen.getByRole('button', { name: '附件（0）' }));
  const input = await screen.findByLabelText('添加对话附件');
  view.rerender(<ConversationAttachmentPicker conversationId={null} ensureConversation={ensureConversation} api={api} isDisabled />);
  expect(input).toBeDisabled();
  fireEvent.change(input, { target: { files: [new File(['合成资料'], '资料.txt', { type: 'text/plain' })] } });
  const dialog = screen.getByRole('dialog', { name: '对话附件管理' });
  fireEvent.paste(dialog, { clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => new File(['png'], 'clipboard.png', { type: 'image/png' }) }] } });
  expect(ensureConversation).not.toHaveBeenCalled();
  expect(api.upload).not.toHaveBeenCalled();
  view.rerender(<ConversationAttachmentPicker conversationId={null} ensureConversation={ensureConversation} api={api} />);
  expect(input).toBeEnabled();
  fireEvent.change(input, { target: { files: [new File(['合成资料'], '资料.txt', { type: 'text/plain' })] } });
  await screen.findByRole('button', { name: '预览 资料.txt' });
  expect(api.upload).toHaveBeenCalledOnce();
});

it.each(['列表不再包含附件', '已移除', '带移除时间', '文件缺失', '仍在保存', '版本变化'])('刷新发现%s时关闭旧图片预览并释放URL', async reason => {
  const image = { ...attachment, fileName: '图片.png', mimeType: 'image/png' };
  vi.mocked(api.list).mockResolvedValueOnce([image]);
  vi.mocked(api.preview).mockResolvedValueOnce({ attachment: image, segments: [], imageMetadata: null });
  await open(); fireEvent.click(screen.getByRole('button', { name: '预览 图片.png' }));
  await screen.findByRole('img');
  const refreshed: ConversationAttachment[] = reason === '列表不再包含附件' ? [] : [{ ...image,
    storageStatus: reason === '已移除' ? 'removed' : reason === '文件缺失' ? 'missing' : reason === '仍在保存' ? 'pending' : 'ready',
    revision: reason === '版本变化' ? image.revision + 1 : image.revision,
    removedAt: reason === '带移除时间' ? '2026-10-04T01:00:00Z' : null }];
  vi.mocked(api.list).mockResolvedValueOnce(refreshed);
  fireEvent.click(screen.getByRole('button', { name: '刷新附件' }));
  await waitFor(() => {
    expect(screen.queryByLabelText('附件预览')).not.toBeInTheDocument();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:owned-image');
  });
  expect(api.preview).toHaveBeenCalledOnce(); expect(api.content).toHaveBeenCalledOnce();
});

it('刷新返回同版本的新对象时保留原图片预览与URL', async () => {
  const image = { ...attachment, fileName: '图片.png', mimeType: 'image/png' };
  vi.mocked(api.list).mockResolvedValueOnce([image]);
  vi.mocked(api.preview).mockResolvedValueOnce({ attachment: image, segments: [], imageMetadata: null });
  await open(); fireEvent.click(screen.getByRole('button', { name: '预览 图片.png' }));
  const displayed = await screen.findByRole('img');
  vi.mocked(api.list).mockResolvedValueOnce([{ ...image }]);
  fireEvent.click(screen.getByRole('button', { name: '刷新附件' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '刷新附件' })).toBeEnabled());
  expect(api.list).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('img')).toBe(displayed); expect(revokeObjectURL).not.toHaveBeenCalled();
  expect(api.content).toHaveBeenCalledOnce();
});

it('刷新失败保留现有图片预览，重试成功后才关闭失效预览', async () => {
  const image = { ...attachment, fileName: '图片.png', mimeType: 'image/png' };
  vi.mocked(api.list).mockResolvedValueOnce([image]);
  vi.mocked(api.preview).mockResolvedValueOnce({ attachment: image, segments: [], imageMetadata: null });
  await open(); fireEvent.click(screen.getByRole('button', { name: '预览 图片.png' }));
  const displayed = await screen.findByRole('img');
  vi.mocked(api.list).mockRejectedValueOnce(new Error('刷新暂时失败'));
  fireEvent.click(screen.getByRole('button', { name: '刷新附件' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('刷新暂时失败');
  expect(screen.getByRole('img')).toBe(displayed); expect(revokeObjectURL).not.toHaveBeenCalled();
  vi.mocked(api.list).mockResolvedValueOnce([]);
  fireEvent.click(screen.getByRole('button', { name: '刷新附件' }));
  await waitFor(() => {
    expect(screen.queryByLabelText('附件预览')).not.toBeInTheDocument();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:owned-image');
  });
});

it.each(['关闭预览', '切换对话', '卸载组件'])('刷新待决时%s，迟到结果不会重开预览或重复释放URL', async action => {
  const image = { ...attachment, fileName: '图片.png', mimeType: 'image/png' };
  vi.mocked(api.list).mockResolvedValueOnce([image]);
  vi.mocked(api.preview).mockResolvedValueOnce({ attachment: image, segments: [], imageMetadata: null });
  const { view, ensureConversation } = await open();
  fireEvent.click(screen.getByRole('button', { name: '预览 图片.png' })); await screen.findByRole('img');
  let release!: (rows: ConversationAttachment[]) => void;
  const delayed = new Promise<ConversationAttachment[]>(resolve => { release = resolve; });
  vi.mocked(api.list).mockReturnValueOnce(delayed);
  fireEvent.click(screen.getByRole('button', { name: '刷新附件' }));
  await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  if (action === '关闭预览') fireEvent.click(screen.getByRole('button', { name: '关闭附件预览' }));
  else if (action === '切换对话') view.rerender(<ConversationAttachmentPicker conversationId="other" ensureConversation={ensureConversation} api={api} />);
  else view.unmount();
  await act(async () => { release([{ ...image }]); await delayed; });
  expect(screen.queryByLabelText('附件预览')).not.toBeInTheDocument();
  expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:owned-image');
  expect(createObjectURL).toHaveBeenCalledOnce();
  if (action === '切换对话') expect(screen.queryByRole('button', { name: '预览 图片.png' })).not.toBeInTheDocument();
});
