import { useEffect, useState } from 'react';
import type { Note, Tag, TagGroup } from '@study-accelerator/web-core';
import { Button, Checkbox, Dialog, DialogBody, DialogClose, DialogFooter } from '../../components/ui';
import styles from './NotesIndexView.module.css';

export function BatchTagDialog({ isOpen, tags, groups, notes, count, pending, error, onOpenChange, onSave }: {
  isOpen: boolean;
  tags: Tag[];
  groups: TagGroup[];
  notes: Note[];
  count: number;
  pending: boolean;
  error: string;
  onOpenChange(open: boolean): void;
  onSave(addTagIds: string[], removeTagIds: string[]): Promise<void>;
}) {
  const [changes, setChanges] = useState<Map<string, 'add' | 'remove'>>(new Map());

  useEffect(() => {
    if (isOpen) setChanges(new Map());
  }, [isOpen]);

  function originalState(tagId: string): 'all' | 'some' | 'none' {
    const included = notes.filter((note) => note.tagIds.includes(tagId)).length;
    return included === 0 ? 'none' : included === notes.length ? 'all' : 'some';
  }
  function effectiveState(tagId: string): 'all' | 'some' | 'none' {
    return changes.get(tagId) === 'add' ? 'all' : changes.get(tagId) === 'remove' ? 'none' : originalState(tagId);
  }
  function toggle(tag: Tag) {
    const nextAction = effectiveState(tag.id) === 'all' ? 'remove' : 'add';
    setChanges((current) => {
      const next = new Map(current);
      if (nextAction === 'add') {
        const group = groups.find((item) => item.id === tag.groupId);
        if (group?.selectionMode === 'single') {
          tags.filter((item) => item.groupId === group.id && item.id !== tag.id)
            .forEach((item) => next.set(item.id, 'remove'));
        }
      }
      next.set(tag.id, nextAction);
      return next;
    });
  }
  const addTagIds = [...changes].filter(([, action]) => action === 'add').map(([id]) => id);
  const removeTagIds = [...changes].filter(([, action]) => action === 'remove').map(([id]) => id);

  return (
    <Dialog title="批量编辑标签" description={`同时整理选中的 ${count} 篇笔记。半选表示仅部分笔记包含。`} size="md" isOpen={isOpen} onOpenChange={onOpenChange} isPending={pending}>
      <DialogBody>
        {groups.map((group) => <section className={styles.batchTagGroup} key={group.id}>
          <h3>{group.name}<small>{group.selectionMode === 'single' ? '单选' : '多选'}</small></h3>
          {tags.filter((tag) => tag.groupId === group.id).map((tag) => {
            const state = effectiveState(tag.id);
            return <Checkbox key={tag.id} isSelected={state === 'all'} isIndeterminate={state === 'some'} onChange={() => toggle(tag)}>
              {tag.name || '未命名标签'}<span className={styles.triState}>{state === 'all' ? '全部包含' : state === 'some' ? '部分包含' : '均不包含'}</span>
            </Checkbox>;
          })}
        </section>)}
        {tags.length === 0 ? <p className={styles.dialogHint}>当前笔记库还没有可用标签。</p> : null}
        {changes.size > 0 ? <p className={styles.dialogHint} role="status">将添加 {addTagIds.length} 个标签，移除 {removeTagIds.length} 个标签。</p> : null}
        {error ? <p className={styles.batchError} role="alert">{error}</p> : null}
      </DialogBody>
      <DialogFooter>
        <DialogClose variant="ghost">取消</DialogClose>
        <Button variant="primary" isPending={pending} isDisabled={changes.size === 0} onPress={() => void onSave(addTagIds, removeTagIds)}>保存批量更改</Button>
      </DialogFooter>
    </Dialog>
  );
}
