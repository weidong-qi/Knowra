import { useRef, useState } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Tag, TagGroup } from '@study-accelerator/web-core';
import { TagPickerDialog } from './TagPickerDialog';

const groups: TagGroup[] = [
  { id: 'group-ordinary', spaceId: 'space-1', code: 'ordinary', name: '普通标签', selectionMode: 'multiple', isSystem: true, sortOrder: 0 },
  { id: 'group-mastery', spaceId: 'space-1', code: 'mastery', name: '掌握程度', selectionMode: 'single', isSystem: true, sortOrder: 1 }
];

const initialTags: Tag[] = [
  { id: 'tag-paper', spaceId: 'space-1', name: '论文', color: 'blue', groupId: 'group-ordinary', isSystem: false, sortOrder: 0 },
  { id: 'tag-multimodal', spaceId: 'space-1', name: '多模态', color: 'green', groupId: 'group-ordinary', isSystem: false, sortOrder: 1 },
  { id: 'tag-mastered', spaceId: 'space-1', name: '已掌握', color: 'green', groupId: 'group-mastery', isSystem: true, sortOrder: 0 }
];

describe('TagPickerDialog', () => {
  it('保存期间阻止关闭和管理，失败后保留草稿并允许重试', async () => {
    const user = userEvent.setup();
    let reject!: (error: Error) => void;
    const onSave = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
    const onOpenChange = vi.fn();
    renderPicker({ onSave, onOpenChange });
    await user.click(screen.getByRole('button', { name: '多模态' }));
    await user.click(screen.getByRole('button', { name: '保存到笔记' }));
    await user.click(screen.getByRole('button', { name: '关闭' }));
    await user.click(screen.getByRole('button', { name: '取消' }));
    await user.click(screen.getByRole('button', { name: '管理标签库' }));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '保存到笔记' })).toBeInTheDocument();
    await act(async () => reject(new Error('暂时失败')));
    expect(screen.getByRole('alert')).toHaveTextContent('暂时失败');
    expect(screen.getAllByRole('button', { name: '多模态' }).some(button => button.getAttribute('aria-pressed') === 'true')).toBe(true);
    await user.click(screen.getByRole('button', { name: '关闭' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('直接提供新建和管理入口，不需要先输入搜索词', () => {
    renderPicker();

    expect(screen.getByRole('button', { name: '新建标签' })).toBeVisible();
    expect(screen.getByRole('button', { name: '管理标签库' })).toBeVisible();
    expect(screen.getByRole('searchbox', { name: '搜索已有标签' })).toBeVisible();
  });

  it('可从显式入口新建标签并自动添加到当前笔记', async () => {
    const user = userEvent.setup();
    const onCreateTag = vi.fn();
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderPicker({ onCreateTag, onSave });

    await user.click(screen.getByRole('button', { name: '新建标签' }));
    expect(screen.getByRole('dialog', { name: '新建标签' })).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: /标签名称/ }), '新标签');
    await user.click(screen.getByRole('button', { name: '创建并添加' }));

    expect(onCreateTag).toHaveBeenCalledWith(expect.objectContaining({ name: '新标签', groupId: 'group-ordinary' }));
    expect(await screen.findByText('已创建并添加“新标签”')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '保存到笔记' }));
    expect(onSave).toHaveBeenCalledWith(expect.arrayContaining(['tag-paper', 'tag-new']));
  });

  it('管理视图显示普通标签删除操作与影响确认，并保护内置标签', async () => {
    const user = userEvent.setup();
    const onDeleteTag = vi.fn().mockResolvedValue(undefined);
    renderPicker({ onDeleteTag });

    await user.click(screen.getByRole('button', { name: '管理标签库' }));
    expect(screen.getAllByRole('button', { name: /^删除标签 / })).toHaveLength(2);
    expect(screen.getByText('内置标签不可删除')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '删除标签 论文' }));
    expect(screen.getByRole('dialog', { name: '删除标签' })).toBeInTheDocument();
    expect(screen.getByText('这个标签正在被 3 篇笔记使用。你可以先合并，或从这些笔记中移除后删除。')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '从 3 篇笔记移除并删除' }));
    expect(onDeleteTag).toHaveBeenCalledWith('tag-paper');
  });

  it('进入管理视图后返回，不会丢失尚未保存的笔记标签草稿', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderPicker({ onSave });

    await user.click(screen.getByRole('button', { name: '多模态' }));
    await user.click(screen.getByRole('button', { name: '管理标签库' }));
    await user.click(screen.getByRole('button', { name: '返回选择标签' }));
    await user.click(screen.getByRole('button', { name: '保存到笔记' }));

    expect(onSave).toHaveBeenCalledWith(expect.arrayContaining(['tag-paper', 'tag-multimodal']));
  });
});

function renderPicker(overrides: Partial<Parameters<typeof TagPickerDialog>[0]> = {}) {
  const onCreateTag = overrides.onCreateTag ?? vi.fn();
  const onUpdateTag = overrides.onUpdateTag ?? vi.fn().mockResolvedValue(initialTags[0]);
  const onDeleteTag = overrides.onDeleteTag ?? vi.fn().mockResolvedValue(undefined);
  const onMergeTags = overrides.onMergeTags ?? vi.fn().mockResolvedValue(undefined);

  function Harness() {
    const [tags, setTags] = useState(initialTags);
    const triggerRef = useRef<HTMLButtonElement>(null);
    return <><button ref={triggerRef} type="button">打开标签</button><TagPickerDialog
      {...overrides}
      isOpen
      triggerRef={triggerRef}
      tags={tags}
      groups={groups}
      selectedTagIds={['tag-paper']}
      usageCounts={{ 'tag-paper': 3 }}
      canWrite
      onOpenChange={overrides.onOpenChange ?? vi.fn()}
      onCreateTag={async (input) => {
        const created = await onCreateTag(input) as Tag | undefined ?? { id: 'tag-new', spaceId: 'space-1', ...input, isSystem: false, sortOrder: tags.length };
        setTags((current) => [...current, created]);
        return created;
      }}
      onUpdateTag={onUpdateTag}
      onDeleteTag={async (id) => { await onDeleteTag(id); setTags((current) => current.filter((tag) => tag.id !== id)); }}
      onMergeTags={onMergeTags}
      onSave={overrides.onSave ?? vi.fn().mockResolvedValue(undefined)}
    /></>;
  }

  return render(<Harness />);
}
