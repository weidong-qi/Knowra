import { useDeferredValue, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Tag, TagColor, TagGroup } from '@study-accelerator/web-core';
import { normalizeTagColor } from './TagChip';
export const COLORS: TagColor[] = ['neutral', 'blue', 'green', 'orange', 'red', 'violet'];
export type DialogMode = 'select' | 'manage' | 'form' | 'delete';
type ReturnMode = Extract<DialogMode, 'select' | 'manage'>;
export interface TagPickerProps {
  isOpen: boolean;
  /** 弹层锚点：打开面板的“添加/编辑”按钮。 */
  triggerRef: RefObject<Element | null>;
  tags: Tag[];
  groups: TagGroup[];
  selectedTagIds: string[];
  usageCounts?: Record<string, number>;
  canWrite: boolean;
  onOpenChange(open: boolean): void;
  onCreateTag(input: { name: string; color: TagColor; groupId: string }): Promise<Tag>;
  onUpdateTag?(id: string, input: { name?: string; color?: TagColor; groupId?: string }): Promise<Tag>;
  onDeleteTag?(id: string): Promise<void>;
  onMergeTags?(sourceTagId: string, targetTagId: string): Promise<void>;
  onOpenFullManager?(): void;
  onSave(tagIds: string[]): Promise<void>;
}

/** 标签草稿与全局操作编排；每次打开拥有独立异步会话。 */
export function useTagPickerController({ isOpen, tags, groups, selectedTagIds, usageCounts = {}, canWrite, onOpenChange, onCreateTag, onUpdateTag, onDeleteTag, onMergeTags, onSave }: TagPickerProps) {
  const [mode, setModeState] = useState<DialogMode>('select');
  const [returnMode, setReturnMode] = useState<ReturnMode>('select');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [managerQuery, setManagerQuery] = useState('');
  const [editingTag, setEditingTag] = useState<Tag | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Tag | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState('');
  const [color, setColor] = useState<TagColor>('blue');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const defaultGroupId = groups.find((group) => group.code === 'ordinary')?.id ?? groups[0]?.id ?? '';
  const deferredQuery = useDeferredValue(query);
  const deferredManagerQuery = useDeferredValue(managerQuery);

  const session = useRef(0);
  const pendingRef = useRef(false);
  const setMode = (value: DialogMode) => { if (!pendingRef.current) setModeState(value); };
  const requestOpenChange = (open: boolean) => { if (!pendingRef.current) onOpenChange(open); };
  useEffect(() => {
    session.current += 1;
    pendingRef.current = false;
    setPending(false);
    if (!isOpen) return;

    setMode('select');
    setReturnMode('select');
    setSelected(new Set(selectedTagIds));
    setQuery('');
    setManagerQuery('');
    setEditingTag(null);
    setDeleteTarget(null);
    setMergeTargetId('');
    setError('');
    setNotice('');
    setGroupId(defaultGroupId);
    return () => { session.current += 1; };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || groupId || !defaultGroupId) return;
    setGroupId(defaultGroupId);
  }, [defaultGroupId, groupId, isOpen]);

  const orderedGroups = useMemo(() => groups.slice().sort((a, b) => a.sortOrder - b.sortOrder), [groups]);
  const visibleGroups = useMemo(() => orderedGroups.map((group) => ({
    group,
    tags: tags.filter((tag) => tag.groupId === group.id && (tag.name ?? '').toLocaleLowerCase().includes(deferredQuery.trim().toLocaleLowerCase()))
  })).filter((entry) => entry.tags.length > 0), [deferredQuery, orderedGroups, tags]);
  const managedGroups = useMemo(() => orderedGroups.map((group) => ({
    group,
    tags: tags.filter((tag) => tag.groupId === group.id && (tag.name ?? '').toLocaleLowerCase().includes(deferredManagerQuery.trim().toLocaleLowerCase()))
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
  })).filter((entry) => entry.tags.length > 0), [deferredManagerQuery, orderedGroups, tags]);
  const selectedTags = tags.filter((tag) => selected.has(tag.id));
  const exactMatch = tags.some((tag) => (tag.name ?? '').trim().toLocaleLowerCase() === query.trim().toLocaleLowerCase());
  const deleteUsageCount = deleteTarget ? usageCounts[deleteTarget.id] ?? 0 : 0;

  function addTagRespectingGroup(current: Set<string>, tag: Tag) {
    const next = new Set(current);
    const group = groups.find((item) => item.id === tag.groupId);
    if (group?.selectionMode === 'single') {
      const previous = tags.find((item) => item.groupId === group.id && next.has(item.id));
      tags.filter((item) => item.groupId === group.id).forEach((item) => next.delete(item.id));
      if (previous && previous.id !== tag.id) setNotice(`已用“${tag.name}”替换“${previous.name}”`);
    }
    next.add(tag.id);
    return next;
  }

  function toggle(tag: Tag) {
    if (!canWrite || pendingRef.current) return;
    setSelected((current) => {
      if (current.has(tag.id)) {
        const next = new Set(current);
        next.delete(tag.id);
        return next;
      }
      return addTagRespectingGroup(current, tag);
    });
  }

  function openCreate(from: ReturnMode, suggestedName = '') {
    if (!canWrite || pendingRef.current) return;
    setReturnMode(from);
    setEditingTag(null);
    setName(suggestedName);
    setGroupId(defaultGroupId);
    setColor(COLORS[tags.length % COLORS.length]);
    setError('');
    setMode('form');
  }

  function openEdit(tag: Tag) {
    if (!canWrite || pendingRef.current) return;
    setReturnMode('manage');
    setEditingTag(tag);
    setName(tag.name ?? '');
    setGroupId(tag.groupId ?? defaultGroupId);
    setColor(normalizeTagColor(tag.color));
    setError('');
    setMode('form');
  }

  function openDelete(tag: Tag) {
    if (!canWrite || pendingRef.current) return;
    setDeleteTarget(tag);
    setMergeTargetId('');
    setError('');
    setMode('delete');
  }

  async function submitTag() {
    const normalized = name.trim();
    if (!normalized || !groupId) return;
    if (!canWrite || pendingRef.current) return;
    const operationSession = session.current;
    const current = () => operationSession === session.current;
    pendingRef.current = true;
    setPending(true);
    setError('');
    try {
      if (editingTag) {
        if (!onUpdateTag) throw new Error('当前模式不支持编辑标签');
        const updated = await onUpdateTag(editingTag.id, { name: normalized, color, groupId });
        if (!current()) return;
        setNotice(`已更新标签“${updated.name}”`);
      } else {
        const tag = await onCreateTag({ name: normalized, color, groupId });
        if (!current()) return;
        if (returnMode === 'select') setSelected((current) => addTagRespectingGroup(current, tag));
        setNotice(returnMode === 'select' ? `已创建并添加“${tag.name}”` : `已创建标签“${tag.name}”`);
      }
      setName('');
      setEditingTag(null);
      setQuery('');
      setModeState(returnMode);
    } catch (cause) {
      if (!current()) return;
      setError(cause instanceof Error ? cause.message : '标签保存失败，请检查后重试');
    } finally {
      if (current()) { pendingRef.current = false; setPending(false); }
    }
  }

  async function deleteTag() {
    if (!deleteTarget) return;
    if (!canWrite || pendingRef.current) return;
    const operationSession = session.current;
    const current = () => operationSession === session.current;
    pendingRef.current = true;
    setPending(true);
    setError('');
    try {
      const sourceId = deleteTarget.id;
      if (mergeTargetId) {
        if (!onMergeTags) throw new Error('当前模式不支持合并标签');
        await onMergeTags(sourceId, mergeTargetId);
      } else {
        if (!onDeleteTag) throw new Error('当前模式不支持删除标签');
        await onDeleteTag(sourceId);
      }
      if (!current()) return;
      setSelected((current) => {
        const next = new Set(current);
        const sourceWasAssigned = next.has(sourceId) || selectedTagIds.includes(sourceId);
        next.delete(sourceId);
        const target = tags.find((tag) => tag.id === mergeTargetId);
        return sourceWasAssigned && target ? addTagRespectingGroup(next, target) : next;
      });
      setNotice(mergeTargetId ? `已合并并删除“${deleteTarget.name}”` : `已删除标签“${deleteTarget.name}”`);
      setDeleteTarget(null);
      setMergeTargetId('');
      setModeState('manage');
    } catch (cause) {
      if (!current()) return;
      setError(cause instanceof Error ? cause.message : '删除标签失败，请重试');
    } finally {
      if (current()) { pendingRef.current = false; setPending(false); }
    }
  }

  async function save() {
    if (!canWrite || pendingRef.current) return;
    const operationSession = session.current;
    const current = () => operationSession === session.current;
    pendingRef.current = true;
    setPending(true);
    setError('');
    try {
      await onSave([...selected]);
      if (!current()) return;
      onOpenChange(false);
    } catch (cause) {
      if (!current()) return;
      setError(cause instanceof Error ? cause.message : '标签保存失败，请重试');
    } finally {
      if (current()) { pendingRef.current = false; setPending(false); }
    }
  }

  return { mode, setMode, returnMode, selected, query, setQuery, managerQuery, setManagerQuery, editingTag, deleteTarget, mergeTargetId, setMergeTargetId, name, setName, groupId, setGroupId, color, setColor, pending, error, setError, notice, orderedGroups, visibleGroups, managedGroups, selectedTags, exactMatch, deleteUsageCount, toggle, openCreate, openEdit, openDelete, submitTag, deleteTag, save, requestOpenChange };
}
