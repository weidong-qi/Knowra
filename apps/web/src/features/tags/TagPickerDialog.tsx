import { useEffect, useState } from 'react';
import type { Tag } from '@study-accelerator/web-core';
import { Button, IconButton, Popover, PopoverDialog } from '../../components/ui';
import { ChevronLeftIcon, CloseIcon, SettingsIcon, TagIcon } from '../../components/icons/knowra';
import { useTagPickerController, type TagPickerProps, type DialogMode } from './useTagPickerController';
import { SelectTagsView, ManageTagsView, TagForm, DeleteTagView } from './TagPickerViews';
import styles from './TagPickerDialog.module.css';

export function TagPickerDialog(props: TagPickerProps) {
  const { isOpen, triggerRef, tags, canWrite, usageCounts = {}, onOpenFullManager } = props;
  const { mode, setMode, returnMode, selected, query, setQuery, managerQuery, setManagerQuery, editingTag, deleteTarget, mergeTargetId, setMergeTargetId, name, setName, groupId, setGroupId, color, setColor, pending, error, setError, notice, orderedGroups, visibleGroups, managedGroups, selectedTags, exactMatch, deleteUsageCount, toggle, openCreate, openEdit, openDelete, submitTag, deleteTag, save, requestOpenChange } = useTagPickerController(props);
  const sideSpace = useMinWidth(820);

  if (!isOpen) return null;
  const goBack = mode === 'manage' ? () => { setError(''); setMode('select'); }
    : mode === 'form' ? () => { setError(''); setMode(returnMode); }
    : () => { setError(''); setMode('manage'); };
  const title = dialogTitle(mode, editingTag);
  return <Popover triggerRef={triggerRef} isOpen onOpenChange={requestOpenChange} placement={sideSpace ? 'left' : 'top'} offset={12} className={styles.popover}>
    <PopoverDialog className={styles.panel} aria-label={title} data-pending={pending || undefined}>
      <header className={styles.header}>
        {mode === 'select'
          ? <span className={styles.headIcon} aria-hidden="true"><TagIcon size={18} /></span>
          : <IconButton disabled={pending} size={28} aria-label={mode === 'manage' ? '返回选择标签' : '返回'} onPress={goBack}><ChevronLeftIcon size={18} /></IconButton>}
        <div className={styles.headText}><h2>{title}</h2><p>{dialogDescription(mode)}</p></div>
        {mode === 'select' ? <IconButton disabled={pending} size={28} aria-label="管理标签库" onPress={() => { setError(''); setMode('manage'); }}><SettingsIcon size={18} /></IconButton> : null}
        <IconButton disabled={pending} size={28} aria-label="关闭" onPress={() => requestOpenChange(false)}><CloseIcon size={16} /></IconButton>
      </header>
      <fieldset key={mode} disabled={pending} className={styles.body}>
        {mode === 'select' ? <SelectTagsView canWrite={canWrite} query={query} selected={selected} selectedTags={selectedTags} visibleGroups={visibleGroups} exactMatch={exactMatch} notice={notice} error={error} onQueryChange={setQuery} onToggle={toggle} onCreate={() => openCreate('select')} onCreateFromQuery={() => openCreate('select', query.trim())} /> : null}
        {mode === 'manage' ? <ManageTagsView canWrite={canWrite} query={managerQuery} groups={managedGroups} usageCounts={usageCounts} notice={notice} error={error} onQueryChange={setManagerQuery} onCreate={() => openCreate('manage')} onEdit={openEdit} onDelete={openDelete} onOpenFullManager={onOpenFullManager ? () => { requestOpenChange(false); if (!pending) onOpenFullManager(); } : undefined} /> : null}
        {mode === 'form' ? <TagForm editingTag={editingTag} groups={orderedGroups} name={name} groupId={groupId} color={color} error={error} onNameChange={setName} onGroupChange={setGroupId} onColorChange={setColor} onSubmit={() => void submitTag()} /> : null}
        {mode === 'delete' && deleteTarget ? <DeleteTagView tag={deleteTarget} usageCount={deleteUsageCount} candidates={tags.filter((tag) => tag.id !== deleteTarget.id)} mergeTargetId={mergeTargetId} error={error} onMergeTargetChange={setMergeTargetId} /> : null}
      </fieldset>
      {mode !== 'manage' ? <footer className={styles.footer}>
        {mode === 'select' ? <><span className={styles.footerHint}>已选 {selected.size} 个</span><Button isDisabled={pending} variant="ghost" onPress={() => requestOpenChange(false)}>取消</Button>{canWrite ? <Button variant="primary" isPending={pending} onPress={() => void save()}>保存到笔记</Button> : null}</> : null}
        {mode === 'form' ? <><Button isDisabled={pending} variant="ghost" onPress={goBack}>取消</Button><Button type="submit" form="tag-form" variant={'primary'} isPending={pending} isDisabled={!name.trim() || !groupId}>{editingTag ? '保存修改' : returnMode === 'select' ? '创建并添加' : '创建标签'}</Button></> : null}
        {mode === 'delete' ? <><Button isDisabled={pending} variant="ghost" onPress={goBack}>取消</Button><Button variant="danger" isPending={pending} onPress={() => void deleteTag()}>{mergeTargetId ? '合并并删除' : deleteUsageCount ? `从 ${deleteUsageCount} 篇笔记移除并删除` : '删除标签'}</Button></> : null}
      </footer> : null}
    </PopoverDialog>
  </Popover>;
}

/** 宽屏从按钮侧边弹出，可用高度是整个视口；窄屏退回上下方向。 */
function useMinWidth(width: number) {
  const query = `(min-width: ${width}px)`;
  const [matches, setMatches] = useState(() => window.matchMedia?.(query).matches ?? true);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}

function dialogTitle(mode: DialogMode, editingTag: Tag | null) {
  if (mode === 'manage') return '管理标签库';
  if (mode === 'form') return editingTag ? '编辑标签' : '新建标签';
  if (mode === 'delete') return '删除标签';
  return '编辑笔记标签';
}

function dialogDescription(mode: DialogMode) {
  if (mode === 'manage') return '修改或删除工作区中的标签；这些更改会立即生效。';
  if (mode === 'form') return '设置标签名称、所属分组和颜色。';
  if (mode === 'delete') return '删除属于全局操作，请确认对已有笔记的影响。';
  return '给当前笔记添加或移除标签。';
}
