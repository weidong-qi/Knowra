import { useState } from 'react';
import { conceptRemovalRelations, type KnowledgeConcept, type KnowledgeItem } from '@study-accelerator/web-core';
import { Button, Checkbox, Dialog, DialogBody, DialogFooter, SearchBox, Select } from '../../../components/ui';
import { randomId } from '../../../browser/randomId';
import { useConceptState, type ConceptStore } from './conceptStore';
import styles from './Concepts.module.css';
export function LinkItemsDialog({
  concept,
  items,
  canWrite,
  store,
  onClose
}: {
  concept: KnowledgeConcept;
  items: KnowledgeItem[];
  canWrite: boolean;
  store: ConceptStore;
  onClose(): void;
}) {
  const state = useConceptState(store);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [role, setRole] = useState<'subject' | 'mentions'>('subject');
  const candidates = items.filter(
    item =>
      !item.deletedAt &&
      !state.links.some(link => !link.deletedAt && link.conceptId === concept.id && link.knowledgeItemId === item.id) &&
      `${item.title} ${item.canonicalStatement}`.toLowerCase().includes(query.toLowerCase())
  );
  const submit = async () => {
    if (!canWrite) return;
    try {
      await store.execute({
        type: 'linkItems',
        operationId: randomId(),
        id: concept.id,
        expectedRevision: concept.revision,
        itemIds: selected,
        role
      });
      onClose();
    } catch {
      /* 保留选择。 */
    }
  };
  return (
    <Dialog
      isOpen
      title={`挂入“${concept.name}”`}
      isPending={state.pending}
      onOpenChange={open => {
        if (!open && !state.pending) onClose();
      }}
    >
      <DialogBody>
        <div className={styles.form}>
          <SearchBox
            label="搜索已有知识点"
            size="field"
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
          <Select
            label="挂靠角色"
            value={role}
            onChange={key => setRole(key as typeof role)}
            options={[
              { id: 'subject', label: '主体：这条知识讲的是它' },
              { id: 'mentions', label: '提及：这条知识用到了它' }
            ]}
          />
          <div className={styles.choices}>
            {candidates.map(item => (
              <Checkbox
                key={item.id}
                isSelected={selected.includes(item.id)}
                onChange={checked =>
                  setSelected(ids => (checked ? [...ids, item.id] : ids.filter(id => id !== item.id)))
                }
              >
                {item.title}
              </Checkbox>
            ))}
          </div>
          {!candidates.length ? <p>没有可挂入的知识点。</p> : null}
          {state.error ? <p role="alert">{state.error}</p> : null}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" isDisabled={state.pending} onPress={onClose}>
          取消
        </Button>
        <Button
          variant="primary"
          isDisabled={!canWrite || !selected.length}
          isPending={state.pending}
          onPress={() => void submit()}
        >
          挂入 {selected.length} 条知识点
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
export function RemoveLinksDialog({
  concept,
  linkIds,
  move = false,
  canWrite,
  store,
  onClose
}: {
  concept: KnowledgeConcept;
  linkIds: string[];
  move?: boolean;
  canWrite: boolean;
  store: ConceptStore;
  onClose(): void;
}) {
  const state = useConceptState(store);
  const [targetId, setTargetId] = useState('');
  const [affected] = useState(() => conceptRemovalRelations(state, linkIds));
  const target = state.concepts.find(row => row.id === targetId && !row.deletedAt);
  const submit = async () => {
    if (!canWrite || (move && !target)) return;
    try {
      const base = {
        operationId: randomId(),
        id: concept.id,
        expectedRevision: concept.revision,
        linkIds,
        deleteRelationIds: affected.map(row => row.id)
      };
      await store.execute(
        move && target
          ? { ...base, type: 'moveLinks', targetId: target.id, expectedTargetRevision: target.revision }
          : { ...base, type: 'unlinkItems' }
      );
      onClose();
    } catch {
      /* 服务端范围变化时保留弹窗，关闭重开可重新确认。 */
    }
  };
  return (
    <Dialog
      isOpen
      title={move ? '移到其他概念' : '移出知识点？'}
      isPending={state.pending}
      onOpenChange={open => {
        if (!open && !state.pending) onClose();
      }}
    >
      <DialogBody>
        <div className={styles.form}>
          <p>
            将{move ? '移动' : '移出'} {linkIds.length} 条知识点的挂靠，知识点正文会保留。
          </p>
          {move ? (
            <Select
              label="目标概念"
              value={targetId || null}
              onChange={key => setTargetId(String(key ?? ''))}
              options={state.concepts
                .filter(row => !row.deletedAt && row.id !== concept.id && row.reviewStatus !== 'archived')
                .map(row => ({ id: row.id, label: `${row.name}${row.sense ? ` · ${row.sense}` : ''}` }))}
            />
          ) : null}
          {affected.length ? (
            <>
              <p>此操作会同时删除以下 {affected.length} 条关系（边）：</p>
              <ul>
                {affected.map(row => (
                  <li key={row.id}>
                    {state.concepts.find(concept => concept.id === row.fromConceptId)?.name} →{' '}
                    {state.concepts.find(concept => concept.id === row.toConceptId)?.name}（{row.type}）
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>没有关系需要连带删除。</p>
          )}
          {state.error ? <p role="alert">{state.error}。如影响范围已变化，请关闭弹窗后重新操作。</p> : null}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" isDisabled={state.pending} onPress={onClose}>
          取消
        </Button>
        <Button
          variant="danger"
          isDisabled={!canWrite || (move && !target)}
          isPending={state.pending}
          onPress={() => void submit()}
        >
          {move ? '确认移动' : '删除关联'}
          {affected.length ? '并删除关系' : ''}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
