import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Tag, TagColor, TagGroup } from '@study-accelerator/web-core';
import { Button, Dialog, DialogBody, DialogClose, DialogFooter, IconButton, Menu, MenuItem, MenuPopover, MenuTrigger, Popover, PopoverDialog, PopoverTrigger, SearchBox, SegmentedButton, SegmentedControl, Select, TextField, PressableButton } from '../../components/ui';
import { useNavigate } from '../../app/router';
import { useAppStore } from '../../store/AppStoreProvider';
import { TagChip, normalizeTagColor } from './TagChip';
import { countTagUsage } from './tagUsage';
import { FilterLinesIcon, MoreHorizontalIcon, PlusIcon, SearchIcon, TagIcon } from '../../components/icons/knowra';
import { useCompactLayout } from '../../shell/useCompactLayout';
import { notesIndexAppearanceProps } from '../notes/NotesIndexAppearance';
import { useNotesIndexAppearance } from '../notes/notesIndexAppearanceModel';
import { PathTrail } from '../../shell/PathTrail';
import { WorkspacePanel, WorkspacePanelBody, WorkspacePanelFooter, WorkspacePanelHeader } from '../../components/workspace/WorkspacePanel';
import styles from './TagManagerView.module.css';

type SortMode = 'manual' | 'name' | 'usage';
type EditTarget = { kind: 'tag'; value?: Tag } | { kind: 'group'; value?: TagGroup } | null;

export function TagManagerView() {
  const data = useAppStore((state) => state.serverData);
  const canWrite = useAppStore((state) => state.canWriteWorkspace());
  const createTag = useAppStore((state) => state.createTag);
  const updateTag = useAppStore((state) => state.updateTag);
  const deleteTag = useAppStore((state) => state.deleteTag);
  const mergeTags = useAppStore((state) => state.mergeTags);
  const reorderTags = useAppStore((state) => state.reorderTags);
  const createTagGroup = useAppStore((state) => state.createTagGroup);
  const updateTagGroup = useAppStore((state) => state.updateTagGroup);
  const deleteTagGroup = useAppStore((state) => state.deleteTagGroup);
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState('all');
  const [sort, setSort] = useState<SortMode>('manual');
  const [unusedOnly, setUnusedOnly] = useState(false);
  const [editTarget, setEditTarget] = useState<EditTarget>(null);
  const [deleteTarget, setDeleteTarget] = useState<Tag | null>(null);
  const [pendingDeletion, setPendingDeletion] = useState<{ tag: Tag; mergeTargetId: string } | null>(null);
  const [deletionError, setDeletionError] = useState('');
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [draggedTagId, setDraggedTagId] = useState('');
  const compact = useCompactLayout();
  const theme = notesIndexAppearanceProps(useNotesIndexAppearance());
  const usage = useMemo(() => countTagUsage(data.tags, data.notes), [data.notes, data.tags]);
  const unusedCount = Object.values(usage).filter((count) => count === 0).length;

  const sections = data.tagGroups
    .slice().sort((a, b) => a.sortOrder - b.sortOrder)
    .filter((group) => groupFilter === 'all' || group.id === groupFilter)
    .map((group) => {
      const items = data.tags.filter((tag) => tag.groupId === group.id && tag.id !== pendingDeletion?.tag.id)
        .filter((tag) => (tag.name ?? '').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
        .filter((tag) => !unusedOnly || (usage[tag.id] ?? 0) === 0)
        .sort((a, b) => sort === 'name'
          ? (a.name ?? '').localeCompare(b.name ?? '', 'zh-CN')
          : sort === 'usage'
            ? (usage[b.id] ?? 0) - (usage[a.id] ?? 0)
            : (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      return { group, items };
    }).filter(({ items }) => items.length > 0 || (!query && !unusedOnly));
  const visibleTagCount = sections.reduce((count, section) => count + section.items.length, 0);

  function scheduleDeletion(tag: Tag, targetId: string) {
    if (deleteTimer.current) throw new Error('请先完成或撤销上一项标签删除。');
    setPendingDeletion({ tag, mergeTargetId: targetId });
    setDeleteTarget(null);
    deleteTimer.current = setTimeout(() => {
      deleteTimer.current = null;
      void (targetId ? mergeTags(tag.id, targetId) : deleteTag(tag.id))
        .catch(cause => setDeletionError(cause instanceof Error ? cause.message : '标签删除失败'))
        .finally(() => setPendingDeletion(null));
    }, 10000);
  }

  function undoDeletion() {
    if (deleteTimer.current) clearTimeout(deleteTimer.current);
    deleteTimer.current = null;
    setPendingDeletion(null);
  }

  async function move(tag: Tag, direction: -1 | 1) {
    const siblings = data.tags.filter((item) => item.groupId === tag.groupId).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const index = siblings.findIndex((item) => item.id === tag.id);
    const swap = index + direction;
    if (swap < 0 || swap >= siblings.length) return;
    [siblings[index], siblings[swap]] = [siblings[swap], siblings[index]];
    await reorderTags(siblings.map((item) => item.id));
  }

  async function dropBefore(target: Tag) {
    const siblings = data.tags.filter((item) => item.groupId === target.groupId).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const sourceIndex = siblings.findIndex((item) => item.id === draggedTagId);
    const targetIndex = siblings.findIndex((item) => item.id === target.id);
    setDraggedTagId('');
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
    const [source] = siblings.splice(sourceIndex, 1);
    siblings.splice(targetIndex, 0, source);
    await reorderTags(siblings.map((item) => item.id));
  }

  const filtering = groupFilter !== 'all' || unusedOnly;
  const groupOptions = [{ id: 'all', label: '全部分组' }, ...data.tagGroups.map((group) => ({ id: group.id, label: group.name }))];
  const sortOptions: Array<{ id: SortMode; label: string }> = [{ id: 'manual', label: '手动顺序' }, { id: 'name', label: '按名称' }, { id: 'usage', label: '按使用量' }];
  const usageFilter = <SegmentedControl density="compact" aria-label="使用情况筛选"><SegmentedButton aria-pressed={!unusedOnly} count={data.tags.length} onPress={() => setUnusedOnly(false)}>全部</SegmentedButton><SegmentedButton aria-pressed={unusedOnly} count={unusedCount} onPress={() => setUnusedOnly(true)}>未使用</SegmentedButton></SegmentedControl>;
  const search = <div className={styles.searchSlot}><SearchBox label="搜索标签" icon={<SearchIcon size={15} />} name="tag-manager-search" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标签…" onClear={query ? () => setQuery('') : undefined} /></div>;
  const optionsActive = filtering || sort !== 'manual';
  /* 筛选与排序合为一个入口：分组、使用情况、排序都收进同一个浮层，有生效项时按钮带小圆点。 */
  const options = <PopoverTrigger>
    <IconButton size={compact ? 40 : 30} className={styles.dotHost} data-on={optionsActive || undefined} aria-label="筛选与排序" title="筛选与排序"><FilterLinesIcon size={16} /></IconButton>
    <Popover placement="bottom end" offset={6} {...theme}><PopoverDialog aria-label="筛选与排序" className={styles.optionsPanel}>
      <div className={styles.field}><span>分组</span><div className={styles.selectBox}><Select presentation="toolbar" label="按分组筛选" name="tag-group-filter" selectedKey={groupFilter} onSelectionChange={(key) => setGroupFilter(String(key))} options={groupOptions} /></div></div>
      <div className={styles.field}><span>使用情况</span>{usageFilter}</div>
      <div className={styles.field}><span>排序</span>
        <SegmentedControl density="compact" aria-label="标签排序">{sortOptions.map((option) => <SegmentedButton key={option.id} aria-pressed={sort === option.id} onPress={() => setSort(option.id)}>{option.label}</SegmentedButton>)}</SegmentedControl>
      </div>
    </PopoverDialog></Popover>
  </PopoverTrigger>;
  const header = (actions: ReactNode, className?: string) => <WorkspacePanelHeader title="标签管理" code="TAGS" titleId="tag-manager-title" icon={<TagIcon size={13} />} className={className}
    breadcrumb={<PathTrail path={[{ id: 'materials', label: '笔记库', onNavigate: () => navigate('/materials') }, { id: 'tags', label: '标签管理', current: true }]} variant="top" />}
    breadcrumbTitle="笔记库 / 标签管理" actionsLabel="标签操作" actions={actions} />;
  return <WorkspacePanel as="main" aria-labelledby="tag-manager-title">
    {compact
      /* 平板/手机版：标题与工具合为一行——筛选与排序、搜索（默认图标）、新建。 */
      ? header(<div className={styles.compactTools} role="toolbar" aria-label="筛选标签">
        {options}
        {search}
        {canWrite ? <MenuTrigger>
          <IconButton tone="floating" aria-label="新建" title="新建"><PlusIcon size={16} /></IconButton>
          <MenuPopover {...theme}><Menu ariaLabel="新建" onAction={(key) => setEditTarget({ kind: key === 'group' ? 'group' : 'tag' })}>
            <MenuItem id="tag" icon={<TagIcon size={14} />}>新建标签</MenuItem>
            <MenuItem id="group" icon={<PlusIcon size={14} />}>新建分组</MenuItem>
          </Menu></MenuPopover>
        </MenuTrigger> : null}
      </div>, styles.compactHeader)
      /* 桌面版：标题、搜索、筛选与排序、新建同在一行。 */
      : header(<div className={styles.deskTools} role="toolbar" aria-label="筛选标签">
        {search}
        {options}
        {canWrite ? <><Button size="workspace" onPress={() => setEditTarget({ kind: 'group' })}>新建分组</Button><Button size="workspace" variant="primary" onPress={() => setEditTarget({ kind: 'tag' })}><PlusIcon size={17} />新建标签</Button></> : null}
      </div>)}
    <WorkspacePanelBody grid className={styles.content}>
      {pendingDeletion ? <p role="status" className={styles.meta}>“{pendingDeletion.tag.name}”将在 10 秒后删除。<Button variant="ghost" onPress={undoDeletion}>撤销删除</Button></p> : null}
      {deletionError ? <p role="alert" className={styles.error}>{deletionError}</p> : null}
      <div className={styles.groups}>{sections.map(({ group, items }, groupIndex) => <section className={styles.group} key={group.id} aria-labelledby={`group-${group.id}`}>
        <header className={styles.groupHeader}>
          <div className={styles.groupTitle}><span className={styles.groupNumber}>{String(groupIndex + 1).padStart(2, '0')}</span><h2 id={`group-${group.id}`}>{group.name}</h2><span className={styles.groupCount}>{items.length} 个标签</span><span className={styles.meta}>{group.selectionMode === 'single' ? '单选' : '多选'}</span>{group.isSystem ? <span className={styles.system}>内置</span> : null}</div>
          {canWrite ? (compact
            ? <MenuTrigger>
              <IconButton size={28} className={styles.groupMenu} aria-label={`分组“${group.name}”的更多操作`}><MoreHorizontalIcon size={16} /></IconButton>
              <MenuPopover placement="bottom end" {...theme}><Menu ariaLabel={`${group.name}的操作`} onAction={(key) => {
                if (key === 'edit') setEditTarget({ kind: 'group', value: group });
                else if (key === 'delete') void deleteTagGroup(group.id);
              }}>
                <MenuItem id="edit">编辑分组</MenuItem>
                {!group.isSystem ? <MenuItem id="delete" isDanger isDisabled={data.tags.some((tag) => tag.groupId === group.id)}>删除分组</MenuItem> : null}
              </Menu></MenuPopover>
            </MenuTrigger>
            : <div className={styles.groupActions}><Button size="compact" onPress={() => setEditTarget({ kind: 'group', value: group })}>编辑分组</Button>{!group.isSystem ? <Button size="compact" variant="danger" isDisabled={data.tags.some((tag) => tag.groupId === group.id)} onPress={() => void deleteTagGroup(group.id)}>删除分组</Button> : null}</div>) : null}
        </header>
        <div className={styles.cards}>{items.map((tag, index) => <article className={styles.card} data-dragging={draggedTagId === tag.id || undefined} draggable={canWrite && sort === 'manual'} onDragStart={() => setDraggedTagId(tag.id)} onDragEnd={() => setDraggedTagId('')} onDragOver={(event) => { if (draggedTagId && draggedTagId !== tag.id) event.preventDefault(); }} onDrop={() => void dropBefore(tag)} key={tag.id}>
          <div className={styles.cardHead}>
            <PressableButton type="button" className={styles.cardOpen} aria-label={`查看“${tag.name ?? '未命名标签'}”的笔记`}
              onPress={() => navigate(`/materials?tags=${encodeURIComponent(tag.id)}&match=all`)}>
              <TagChip tag={tag} className={styles.tagChip} />
            </PressableButton>
            {canWrite ? <MenuTrigger>
              <IconButton size={28} className={styles.cardMenu} aria-label={`标签“${tag.name ?? '未命名标签'}”的更多操作`}><MoreHorizontalIcon size={16} /></IconButton>
              <MenuPopover placement="bottom end" {...theme}><Menu ariaLabel={`${tag.name ?? '未命名标签'}的操作`} onAction={(key) => {
                if (key === 'edit') setEditTarget({ kind: 'tag', value: tag });
                else if (key === 'up') void move(tag, -1);
                else if (key === 'down') void move(tag, 1);
                else if (key === 'delete') { setDeleteTarget(tag); setMergeTargetId(''); }
              }}>
                <MenuItem id="edit">编辑</MenuItem>
                <MenuItem id="up" isDisabled={index === 0 || sort !== 'manual'}>上移</MenuItem>
                <MenuItem id="down" isDisabled={index === items.length - 1 || sort !== 'manual'}>下移</MenuItem>
                {!tag.isSystem ? <MenuItem id="delete" isDanger isDisabled={Boolean(pendingDeletion)}>删除…</MenuItem> : null}
              </Menu></MenuPopover>
            </MenuTrigger> : null}
          </div>
          <div className={styles.cardInfo}><span className={styles.usage}><strong>{usage[tag.id] ?? 0}</strong> 篇笔记</span><span className={styles.color} data-color={normalizeTagColor(tag.color)} title={`${colorLabel(normalizeTagColor(tag.color))}色`}><i aria-hidden="true" /></span></div>
        </article>)}{items.length === 0 ? <p className={styles.empty}>该分组暂无符合条件的标签</p> : null}</div>
      </section>)}</div>
      {sections.length === 0 ? <p className={styles.empty}>没有符合条件的标签。</p> : null}
    </WorkspacePanelBody>
    <WorkspacePanelFooter><span>显示 {visibleTagCount} / {data.tags.length} 个标签</span><span>{data.tagGroups.length} 个分组 · {unusedCount} 个未使用</span></WorkspacePanelFooter>
    <TagEditDialog target={editTarget} groups={data.tagGroups} canWrite={canWrite} onOpenChange={(open) => { if (!open) setEditTarget(null); }} onCreateTag={createTag} onUpdateTag={updateTag} onCreateGroup={createTagGroup} onUpdateGroup={updateTagGroup} />
    <TagDeleteDialog tag={deleteTarget} usageCount={deleteTarget && Object.hasOwn(usage, deleteTarget.id) ? usage[deleteTarget.id] : 0} candidates={data.tags.filter((tag) => tag.id !== deleteTarget?.id)} mergeTargetId={mergeTargetId} onMergeTargetChange={setMergeTargetId} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }} onDelete={async () => { if (deleteTarget) scheduleDeletion(deleteTarget, mergeTargetId); }} />
  </WorkspacePanel>;
}

function TagEditDialog({ target, groups, canWrite, onOpenChange, onCreateTag, onUpdateTag, onCreateGroup, onUpdateGroup }: { target: EditTarget; groups: TagGroup[]; canWrite: boolean; onOpenChange(open: boolean): void; onCreateTag(input: { name: string; color: TagColor; groupId: string }): Promise<Tag>; onUpdateTag(id: string, input: { name?: string; color?: TagColor; groupId?: string }): Promise<Tag>; onCreateGroup(input: { name: string; selectionMode: 'single' | 'multiple' }): Promise<TagGroup>; onUpdateGroup(id: string, input: { name?: string; selectionMode?: 'single' | 'multiple' }): Promise<TagGroup> }) {
  const [name, setName] = useState(''); const [groupId, setGroupId] = useState(''); const [color, setColor] = useState<TagColor>('blue'); const [selectionMode, setSelectionMode] = useState<'single' | 'multiple'>('multiple'); const [pending, setPending] = useState(false); const [error, setError] = useState('');
  useEffect(() => {
    if (!target) return;
    setName(target.value?.name ?? '');
    setGroupId(target.kind === 'tag' ? target.value?.groupId ?? groups.find((group) => group.code === 'ordinary')?.id ?? groups[0]?.id ?? '' : '');
    setColor(target.kind === 'tag' ? normalizeTagColor(target.value?.color) : 'blue');
    setSelectionMode(target.kind === 'group' ? target.value?.selectionMode ?? 'multiple' : 'multiple');
    setError('');
  }, [groups, target]);
  if (!target) return null;
  const currentTarget = target;
  async function submit() { setPending(true); setError(''); try { if (currentTarget.kind === 'tag') { if (currentTarget.value) await onUpdateTag(currentTarget.value.id, { name: name.trim(), color, groupId }); else await onCreateTag({ name: name.trim(), color, groupId }); } else if (currentTarget.value) await onUpdateGroup(currentTarget.value.id, { name: name.trim(), selectionMode }); else await onCreateGroup({ name: name.trim(), selectionMode }); onOpenChange(false); } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败'); } finally { setPending(false); } }
  return <Dialog title={`${target.value ? '编辑' : '新建'}${target.kind === 'tag' ? '标签' : '分组'}`} isOpen onOpenChange={onOpenChange} isPending={pending}><DialogBody><div className={styles.form}>
    <TextField label="名称" autoFocus value={name} maxLength={30} onChange={setName} />
    {target.kind === 'tag' ? <>
      <Select label="所属分组" selectedKey={groupId} isDisabled={target.value?.isSystem} onSelectionChange={(key) => setGroupId(String(key))} options={groups.map((group) => ({ id: group.id, label: group.name }))} />
      <Select label="颜色" selectedKey={color} onSelectionChange={(key) => setColor(String(key) as TagColor)} options={(['neutral', 'blue', 'green', 'orange', 'red', 'violet'] as TagColor[]).map((item) => ({ id: item, label: colorLabel(item) }))} />
    </> : <Select label="选择模式" selectedKey={selectionMode} isDisabled={Boolean(target.value?.isSystem)} onSelectionChange={(key) => setSelectionMode(String(key) as 'single' | 'multiple')} options={[{ id: 'multiple', label: '多选' }, { id: 'single', label: '单选' }]} />}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
  </div></DialogBody><DialogFooter><DialogClose variant="ghost">取消</DialogClose><Button variant="primary" isPending={pending} isDisabled={!canWrite || !name.trim() || (target.kind === 'tag' && !groupId)} onPress={() => void submit()}>保存</Button></DialogFooter></Dialog>;
}

function TagDeleteDialog({ tag, usageCount, candidates, mergeTargetId, onMergeTargetChange, onOpenChange, onDelete }: { tag: Tag | null; usageCount: number; candidates: Tag[]; mergeTargetId: string; onMergeTargetChange(id: string): void; onOpenChange(open: boolean): void; onDelete(): Promise<void> }) {
  const [pending, setPending] = useState(false); const [error, setError] = useState(''); if (!tag) return null;
  return <Dialog title={`删除标签“${tag.name}”？`} description={usageCount ? `该标签被 ${usageCount} 篇笔记引用。可先合并，或从所有笔记中移除后删除。` : '该标签尚未使用，可直接删除。'} isOpen onOpenChange={onOpenChange} isPending={pending}><DialogBody><div className={styles.form}>{usageCount > 0 ? <Select label="合并到（可选）" selectedKey={mergeTargetId} onSelectionChange={(key) => onMergeTargetChange(String(key))} options={[{ id: '', label: '不合并，仅移除引用' }, ...candidates.map((candidate) => ({ id: candidate.id, label: candidate.name ?? '' }))]} /> : null}{error ? <p className={styles.error} role="alert">{error}</p> : null}</div></DialogBody><DialogFooter><DialogClose variant="ghost">取消</DialogClose><Button variant="danger" isPending={pending} onPress={() => { setPending(true); setError(''); void onDelete().catch((cause) => setError(cause instanceof Error ? cause.message : '删除失败')).finally(() => setPending(false)); }}>{mergeTargetId ? '合并并删除' : usageCount ? `移除 ${usageCount} 处引用并删除` : '删除标签'}</Button></DialogFooter></Dialog>;
}

function colorLabel(color: TagColor) { return ({ neutral: '中性', blue: '蓝', green: '绿', orange: '橙', red: '红', violet: '紫' })[color]; }
