import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { calculateContentHash } from '@study-accelerator/content-anchor';
import { VersionHistoryPanel, groupVersionSessions } from './VersionHistoryPanel';

const note = { id: 'note-1', title: '笔记', folderId: null, tagIds: [], internalLinks: [], rawMarkdown: '较早正文', contentLoaded: true, favorite: false, deleted: false };
const versions = [
  { id: 'v2', noteId: note.id, content: '最新创建的快照', contentHash: calculateContentHash('最新创建的快照'), createdAt: '2026-09-20T12:00:00.000Z', createdBy: 'user' },
  { id: 'v1', noteId: note.id, content: '较早正文', contentHash: calculateContentHash('较早正文'), createdAt: '2026-09-20T11:00:00.000Z', createdBy: 'user' }
];

describe('VersionHistoryPanel', () => {
  it('loads summaries by page and marks current content rather than the newest snapshot', async () => {
    const user = userEvent.setup();
    const onListVersionPage = vi.fn().mockResolvedValueOnce({ items: [versions[0]], total: 2, nextCursor: 'cursor-1', currentVersionId: 'v1' }).mockResolvedValueOnce({ items: [versions[1]], total: 2, nextCursor: null, currentVersionId: 'v1' });
    const onGetVersion = vi.fn().mockResolvedValue(versions[0]);
    render(<VersionHistoryPanel note={note} markdown={note.rawMarkdown} canWrite onListVersions={vi.fn()} onListVersionPage={onListVersionPage} onGetVersion={onGetVersion} />);
    await screen.findByText('2 条历史记录');
    expect(onGetVersion).not.toHaveBeenCalled();
    expect(screen.queryByText('当前正文')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '加载更早记录' }));
    expect(await screen.findByText('当前正文')).toBeInTheDocument();
    expect(onListVersionPage).toHaveBeenLastCalledWith(note.id, { limit: 20, cursor: 'cursor-1' });
    await user.click(screen.getByRole('button', { name: /历史正文/ }));
    await screen.findByText(versions[0].content);
    await user.click(screen.getByRole('button', { name: '与当前正文对比' }));
    expect(screen.getByRole('region', { name: '所选历史正文与当前正文（含草稿）的正文差异' })).toBeInTheDocument();
    expect(screen.getByLabelText('正文差异内容')).toHaveTextContent('较早正文');
  });

  it('confirms restore, reports failed saves and disables writes in read-only mode', async () => {
    const user = userEvent.setup();
    const onRestoreVersion = vi.fn().mockRejectedValue(new Error('正文已在另一端更新'));
    const onSaveVersionAs = vi.fn().mockResolvedValue(undefined);
    const props = { note, markdown: note.rawMarkdown, canWrite: true, onListVersions: vi.fn().mockResolvedValue(versions), onGetVersion: vi.fn().mockResolvedValue(versions[0]), onRestoreVersion, onSaveVersionAs };
    const { rerender } = render(<VersionHistoryPanel {...props} />);
    await user.click(await screen.findByRole('button', { name: /历史正文/ }));
    await screen.findByText(versions[0].content);
    await user.click(screen.getByRole('button', { name: '恢复此版本' }));
    expect(onRestoreVersion).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '确认恢复' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('正文已在另一端更新');
    expect(screen.getByRole('dialog', { name: '恢复历史正文' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '取消' }));
    await user.click(screen.getByRole('button', { name: '另存为新笔记' }));
    await waitFor(() => expect(onSaveVersionAs).toHaveBeenCalledWith(versions[0]));
    rerender(<VersionHistoryPanel {...props} canWrite={false} />);
    expect(screen.getByRole('button', { name: '恢复此版本' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '另存为新笔记' })).toBeDisabled();
  });

  it('keeps every immutable snapshot available when grouping nearby edits', () => {
    const nearby = { ...versions[0], id: 'v3', createdAt: '2026-09-20T11:59:00.000Z' };
    expect(groupVersionSessions([versions[0], nearby, versions[1]]).map((items) => items.map((item) => item.id))).toEqual([['v2', 'v3'], ['v1']]);
  });
});
