import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EditorAttachmentPanel } from './EditorAttachmentPanel';
import { buildAttachmentReferenceUrl } from './attachmentFiles';

const attachment = {
  id: 'attachment-1', noteId: 'note-1', fileName: 'diagram.png',
  mimeType: 'image/png', size: 2048, status: 'ready'
};

describe('EditorAttachmentPanel', () => {
  it('opens stored files and protects attachments referenced by the document', () => {
    renderPanel({ markdown: `![图](${buildAttachmentReferenceUrl(attachment.id)})` });
    expect(screen.getByRole('button', { name: '打开附件 diagram.png' })).toBeInTheDocument();
    expect(screen.getByText('正文中')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '删除附件 diagram.png' })).toBeEnabled();
  });

  it('uploads, renames and confirms deletion of an unreferenced attachment', async () => {
    const user = userEvent.setup();
    const onUpload = vi.fn().mockResolvedValue(attachment);
    const onRename = vi.fn().mockResolvedValue({ ...attachment, fileName: 'architecture.png' });
    const onDelete = vi.fn().mockResolvedValue(undefined);
    renderPanel({ onUpload, onRename, onDelete });

    const file = new File(['image'], 'new.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText('选择要上传的附件'), file);
    expect(onUpload).toHaveBeenCalledWith(file);

    await user.click(screen.getByRole('button', { name: '重命名附件 diagram.png' }));
    const fileName = screen.getByRole('textbox', { name: '文件名' });
    await user.clear(fileName);
    await user.type(fileName, 'architecture.png');
    await user.click(screen.getByRole('button', { name: '保存文件名' }));
    expect(onRename).toHaveBeenCalledWith('attachment-1', 'architecture.png');

    await user.click(screen.getByRole('button', { name: '删除附件 diagram.png' }));
    expect(screen.getByRole('dialog', { name: '删除附件？' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '删除附件' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: '删除附件' }));
    expect(onDelete).toHaveBeenCalledWith('attachment-1');
  });

  it('opens an attachment context menu and inserts the selected attachment into the document', async () => {
    const user = userEvent.setup();
    const onInsert = vi.fn().mockResolvedValue(undefined);
    renderPanel({ onInsert });

    fireEvent.contextMenu(screen.getByRole('button', { name: '打开附件 diagram.png' }));
    const menu = await screen.findByRole('menu');
    expect(menu).toHaveAttribute('aria-label', 'diagram.png附件操作');
    expect(screen.getByRole('menuitem', { name: '打开附件' })).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: '插入到正文' }));
    expect(onInsert).toHaveBeenCalledWith(attachment);
  });

  it('disables insertion when the document is not in an editable mode', async () => {
    renderPanel({ canInsert: false });
    fireEvent.contextMenu(screen.getByRole('button', { name: '打开附件 diagram.png' }));
    expect(await screen.findByRole('menuitem', { name: '插入到正文' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('shows unknown status safely and preserves read-only controls', async () => {
    const user = userEvent.setup();
    renderPanel({ attachments: [{ ...attachment, status: 'toString' }], canWrite: false });
    expect(screen.getByText(/状态未知/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '核验文件' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '删除附件 diagram.png' }));
    await screen.findByText('当前持久化资产和历史记录中未发现保留引用，可删除附件记录。');
    expect(screen.getByRole('button', { name: '删除附件' })).toBeDisabled();
  });

  it('preserves partial cleanup feedback and retries durable tasks', async () => {
    const user = userEvent.setup();
    const tasks = { items: [{ attachmentId: attachment.id, fileName: attachment.fileName, cleanup: 'pending-retry' as const, reasonCode: 'ATTACHMENT_CLEANUP_FAILED' }], pending: 1 };
    const actions = { inspectAttachmentDeletion: vi.fn().mockResolvedValue({ asset: { id: attachment.id }, decision: 'can-purge-no-history', references: [], coverage: { persistedCurrentAndHistory: true } }),
      verifyNoteAttachment: vi.fn(), restoreNoteAttachment: vi.fn(),
      listAttachmentCleanup: vi.fn().mockResolvedValueOnce({ items: [], pending: 0 }).mockResolvedValueOnce(tasks).mockResolvedValue({ items: [], pending: 0 }),
      retryAttachmentCleanup: vi.fn().mockResolvedValue({ completed: 1, pending: 0 }) };
    renderPanel({ actions, onDelete: vi.fn().mockResolvedValue({ ...attachment, cleanup: 'pending-retry' }) });
    await user.click(screen.getByRole('button', { name: '删除附件 diagram.png' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '删除附件' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: '删除附件' }));
    await screen.findByText('附件已删除，文件清理待重试');
    await user.click(screen.getByRole('button', { name: '重试文件清理' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '重试文件清理' })).not.toBeInTheDocument());
    expect(actions.retryAttachmentCleanup).toHaveBeenCalledOnce();
  });

  it('keeps deletion disabled when preflight fails or retained history references exist', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    const actions = { inspectAttachmentDeletion: vi.fn().mockRejectedValue(new Error('预检失败')),
      verifyNoteAttachment: vi.fn(), restoreNoteAttachment: vi.fn(), listAttachmentCleanup: vi.fn().mockResolvedValue({ items: [], pending: 0 }), retryAttachmentCleanup: vi.fn() };
    renderPanel({ actions, onDelete });
    await user.click(screen.getByRole('button', { name: '删除附件 diagram.png' }));
    await screen.findByText('预检失败');
    expect(screen.getByRole('button', { name: '删除附件' })).toBeDisabled();
    actions.inspectAttachmentDeletion.mockResolvedValue({ asset: { type: 'attachment', id: attachment.id }, decision: 'requires-dependency-action',
      references: [{ collection: 'noteVersions', category: 'history', id: 'v1', title: '旧版本' }], coverage: { persistedCurrentAndHistory: true } });
    await user.click(screen.getByRole('button', { name: '重新检查' }));
    await screen.findByText('历史记录：旧版本');
    expect(screen.getByRole('button', { name: '删除附件' })).toBeDisabled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('keeps the save failure visible after refreshing deletion dependencies', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockRejectedValue(new Error('正文保存失败，已阻止删除'));
    renderPanel({ onDelete });
    await user.click(screen.getByRole('button', { name: '删除附件 diagram.png' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '删除附件' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: '删除附件' }));
    await screen.findByText('正文保存失败，已阻止删除');
    await waitFor(() => expect(screen.getByRole('button', { name: '删除附件' })).toBeEnabled());
    expect(screen.getByRole('alert')).toHaveTextContent('正文保存失败，已阻止删除');
  });

  it('shows original-file restore failures without claiming success', async () => {
    const user = userEvent.setup();
    const actions = { inspectAttachmentDeletion: vi.fn(), verifyNoteAttachment: vi.fn(), restoreNoteAttachment: vi.fn().mockRejectedValue(new Error('所选文件与原附件不一致')),
      listAttachmentCleanup: vi.fn().mockResolvedValue({ items: [], pending: 0 }), retryAttachmentCleanup: vi.fn() };
    renderPanel({ attachments: [{ ...attachment, status: 'missing', sha256: 'a'.repeat(64), size: 8 }], actions });
    await user.click(screen.getByRole('button', { name: '恢复原文件' }));
    await user.upload(screen.getByLabelText('选择原附件文件'), new File(['original'], 'original.png'));
    await screen.findByText('所选文件与原附件不一致');
    expect(screen.queryByText('原附件已恢复，原正文引用可继续使用')).not.toBeInTheDocument();
    expect(screen.getByText(/文件缺失/)).toBeInTheDocument();
  });

  it('exposes verification and original-file restoration for unavailable files, blocks insertion', async () => {
    const user = userEvent.setup();
    const actions = { inspectAttachmentDeletion: vi.fn(), verifyNoteAttachment: vi.fn().mockResolvedValue(attachment), restoreNoteAttachment: vi.fn().mockResolvedValue(attachment),
      listAttachmentCleanup: vi.fn().mockResolvedValue({ items: [], pending: 0 }), retryAttachmentCleanup: vi.fn() };
    renderPanel({ attachments: [{ ...attachment, status: 'corrupt', sha256: 'a'.repeat(64), size: 8 }], actions });
    expect(screen.getByText(/文件损坏/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '核验文件' }));
    expect(actions.verifyNoteAttachment).toHaveBeenCalledWith(attachment.id);
    await user.upload(screen.getByLabelText('选择原附件文件'), new File(['original'], 'original.png'));
    // 尚未选择恢复目标，不能提交文件。
    expect(actions.restoreNoteAttachment).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '恢复原文件' }));
    await user.upload(screen.getByLabelText('选择原附件文件'), new File(['original'], 'original.png'));
    await waitFor(() => expect(actions.restoreNoteAttachment).toHaveBeenCalledWith(attachment.id, 'b3JpZ2luYWw='));
    fireEvent.contextMenu(screen.getByRole('button', { name: '打开附件 diagram.png' }));
    expect(await screen.findByRole('menuitem', { name: '插入到正文' })).toHaveAttribute('aria-disabled', 'true');
  });
});

function renderPanel(overrides: Partial<Parameters<typeof EditorAttachmentPanel>[0]> = {}) {
  return render(<EditorAttachmentPanel
    attachments={[attachment]}
    markdown=""
    canWrite
    canInsert
    loading={false}
    onUpload={vi.fn().mockResolvedValue(attachment)}
    onInsert={vi.fn().mockResolvedValue(undefined)}
    onRename={vi.fn().mockResolvedValue(attachment)}
    onDelete={vi.fn().mockResolvedValue(undefined)}
    actions={{
      inspectAttachmentDeletion: vi.fn().mockResolvedValue({ asset: { type: 'attachment', id: attachment.id }, decision: 'can-purge-no-history', references: [], reasonCodes: [], coverage: { persistedCurrentAndHistory: true } }),
      verifyNoteAttachment: vi.fn().mockResolvedValue(attachment), restoreNoteAttachment: vi.fn().mockResolvedValue(attachment),
      listAttachmentCleanup: vi.fn().mockResolvedValue({ items: [], pending: 0 }), retryAttachmentCleanup: vi.fn().mockResolvedValue({ completed: 0, pending: 0 })
    }}
    {...overrides}
  />);
}
