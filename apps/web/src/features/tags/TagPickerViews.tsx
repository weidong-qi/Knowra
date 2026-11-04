import type { FormEvent } from 'react';
import type { Tag, TagColor, TagGroup } from '@study-accelerator/web-core';
import { Button, IconButton, SearchBox, Select, TextField, PressableButton } from '../../components/ui';
import { DeleteIcon, EditIcon, PlusIcon, SearchIcon } from '../../components/icons/knowra';
import { TagChip } from './TagChip';
import { COLORS } from './useTagPickerController';
import styles from './TagPickerDialog.module.css';
const REMOVE_WITHOUT_MERGE = '__remove_without_merge__';

export function SelectTagsView({ canWrite, query, selected, selectedTags, visibleGroups, exactMatch, notice, error, onQueryChange, onToggle, onCreate, onCreateFromQuery }: {
  canWrite: boolean; query: string; selected: Set<string>; selectedTags: Tag[]; visibleGroups: Array<{ group: TagGroup; tags: Tag[] }>;
  exactMatch: boolean; notice: string; error: string; onQueryChange(value: string): void; onToggle(tag: Tag): void;
  onCreate(): void; onCreateFromQuery(): void;
}) {
  const trimmed = query.trim();
  const canCreateFromQuery = canWrite && Boolean(trimmed) && !exactMatch;
  return <>
    <SearchBox label="搜索已有标签" size="field" icon={<SearchIcon size={16} />} name="tag-search" autoComplete="off" placeholder="搜索标签，或输入名称新建"
      value={query} onChange={(event) => onQueryChange(event.target.value)} onClear={query ? () => onQueryChange('') : undefined}
      onKeyDown={(event) => { if (event.key === 'Enter' && canCreateFromQuery && visibleGroups.length === 0) { event.preventDefault(); onCreateFromQuery(); } }} />
    {canCreateFromQuery
      ? <Button variant="ghost" className={styles.createRow} icon={<PlusIcon size={16} />} onPress={onCreateFromQuery}>新建标签“{trimmed}”</Button>
      : canWrite && !trimmed ? <Button variant="ghost" className={styles.createRow} icon={<PlusIcon size={16} />} onPress={onCreate}>新建标签</Button> : null}
    {selectedTags.length > 0 ? <section className={styles.selected} aria-label="已选择标签"><h3>已选择</h3><div className={styles.chips}>{selectedTags.map((tag) => <TagChip key={tag.id} tag={tag} selected removable={canWrite} aria-label={`移除标签 ${tag.name}`} onClick={() => onToggle(tag)} />)}</div></section> : null}
    {visibleGroups.map(({ group, tags }) => <section className={styles.group} key={group.id}><div className={styles.groupHeader}><strong>{group.name}</strong><span>{group.selectionMode === 'single' ? '单选' : '多选'}{group.isSystem ? ' · 内置' : ''}</span></div><div className={styles.chips}>{tags.map((tag) => <TagChip key={tag.id} tag={tag} selected={selected.has(tag.id)} aria-pressed={selected.has(tag.id)} onClick={() => onToggle(tag)} />)}</div></section>)}
    {visibleGroups.length === 0 && !trimmed ? <p className={styles.empty}>还没有标签，先新建一个吧。</p> : null}
    {visibleGroups.length === 0 && trimmed ? <p className={styles.empty}>没有找到“{trimmed}”{canCreateFromQuery ? '，按回车可新建。' : ''}</p> : null}
    <Feedback notice={notice} error={error} />
  </>;
}

export function ManageTagsView({ canWrite, query, groups, usageCounts, notice, error, onQueryChange, onCreate, onEdit, onDelete, onOpenFullManager }: {
  canWrite: boolean; query: string; groups: Array<{ group: TagGroup; tags: Tag[] }>; usageCounts: Record<string, number>;
  notice: string; error: string; onQueryChange(value: string): void; onCreate(): void; onEdit(tag: Tag): void; onDelete(tag: Tag): void; onOpenFullManager?: () => void;
}) {
  return <>
    <div className={styles.manageTools}>
      <SearchBox label="搜索标签库" size="field" icon={<SearchIcon size={16} />} name="tag-manager-search" autoComplete="off" placeholder="按名称查找…"
        value={query} onChange={(event) => onQueryChange(event.target.value)} onClear={query ? () => onQueryChange('') : undefined} />
      {canWrite ? <Button variant="primary" icon={<PlusIcon size={16} />} onPress={onCreate}>新建标签</Button> : null}
    </div>
    {groups.map(({ group, tags }) => <section className={styles.group} key={group.id} aria-labelledby={`picker-manage-${group.id}`}>
      <div className={styles.groupHeader}><strong id={`picker-manage-${group.id}`}>{group.name}</strong><span>{group.selectionMode === 'single' ? '单选' : '多选'}{group.isSystem ? ' · 内置' : ''}</span></div>
      <div className={styles.manageRows}>{tags.map((tag) => <article className={styles.manageRow} key={tag.id}>
        <TagChip tag={tag} className={styles.manageTag} />
        <span className={styles.usage}>{usageCounts[tag.id] ?? 0} 篇笔记</span>
        <div className={styles.rowActions}>
          {canWrite ? <IconButton size={28} aria-label={`编辑标签 ${tag.name}`} onPress={() => onEdit(tag)}><EditIcon size={16} /></IconButton> : null}
          {canWrite && !tag.isSystem ? <IconButton size={28} aria-label={`删除标签 ${tag.name}`} className={styles.dangerAction} onPress={() => onDelete(tag)}><DeleteIcon size={16} /></IconButton> : null}
          {tag.isSystem ? <span className={styles.systemNote}>内置标签不可删除</span> : null}
        </div>
      </article>)}</div>
    </section>)}
    {groups.length === 0 ? <p className={styles.empty}>没有符合条件的标签。</p> : null}
    {onOpenFullManager ? <a className={styles.fullManager} href="#/materials/tags" onClick={(event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      onOpenFullManager();
    }}>打开完整标签管理页</a> : null}
    <Feedback notice={notice} error={error} />
  </>;
}

export function TagForm({ editingTag, groups, name, groupId, color, error, onNameChange, onGroupChange, onColorChange, onSubmit }: {
  editingTag: Tag | null; groups: TagGroup[]; name: string; groupId: string; color: TagColor; error: string;
  onNameChange(value: string): void; onGroupChange(value: string): void; onColorChange(value: TagColor): void; onSubmit(): void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }
  return <form id="tag-form" className={styles.form} onSubmit={submit}>
    <TextField label="标签名称" description="1–30 个字符，工作区内不能重名。" name="tag-name" autoComplete="off" value={name} onChange={onNameChange} maxLength={30} isRequired />
    <Select label="所属分组" name="tag-group" selectedKey={groupId} onSelectionChange={(key) => onGroupChange(String(key))} isDisabled={Boolean(editingTag?.isSystem)} options={groups.map((group) => ({ id: group.id, label: `${group.name}${group.isSystem ? ' · 内置' : ''}` }))} />
    <fieldset className={styles.colorField}><legend>颜色</legend><div className={styles.palette}>{COLORS.map((item) => <PressableButton key={item} type="button" className={styles.swatch} data-color={item} aria-label={`${colorLabel(item)}色`} aria-pressed={color === item} onPress={() => onColorChange(item)}><span aria-hidden="true" /></PressableButton>)}</div></fieldset>
    {editingTag?.isSystem ? <p className={styles.helper}>内置标签可改名、改色，但不能更换分组或删除。</p> : null}
    <Feedback error={error} />
  </form>;
}

export function DeleteTagView({ tag, usageCount, candidates, mergeTargetId, error, onMergeTargetChange }: {
  tag: Tag; usageCount: number; candidates: Tag[]; mergeTargetId: string; error: string; onMergeTargetChange(value: string): void;
}) {
  return <div className={styles.deletePanel}>
    <TagChip tag={tag} />
    <p>{usageCount > 0 ? `这个标签正在被 ${usageCount} 篇笔记使用。你可以先合并，或从这些笔记中移除后删除。` : '这个标签尚未被任何笔记使用，可以安全删除。'}</p>
    {usageCount > 0 ? <Select label="合并到其他标签（可选）" description="选择后，原标签的笔记引用会迁移到目标标签。" name="merge-target" selectedKey={mergeTargetId || REMOVE_WITHOUT_MERGE} onSelectionChange={(key) => onMergeTargetChange(key === REMOVE_WITHOUT_MERGE ? '' : String(key))} options={[{ id: REMOVE_WITHOUT_MERGE, label: '不合并，直接移除引用' }, ...candidates.map((candidate) => ({ id: candidate.id, label: candidate.name ?? '未命名标签' }))]} /> : null}
    <Feedback error={error} />
  </div>;
}

function Feedback({ notice = '', error = '' }: { notice?: string; error?: string }) {
  return <>{notice ? <p className={styles.notice} role="status" aria-live="polite">{notice}</p> : null}{error ? <p className={styles.error} role="alert">{error}</p> : null}</>;
}

function colorLabel(color: TagColor) {
  return ({ neutral: '中性', blue: '蓝', green: '绿', orange: '橙', red: '红', violet: '紫' })[color];
}
