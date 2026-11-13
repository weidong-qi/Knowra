import { useRef, useState } from 'react';
import type { ConceptState, KnowledgeConcept } from '@study-accelerator/web-core';
import { Button, Dialog, DialogBody, DialogFooter, Select } from '../../../components/ui';
import { randomId } from '../../../browser/randomId';
import { useConceptState, type ConceptStore } from './conceptStore';
import styles from './Concepts.module.css';
function impactSnapshot(state: ConceptState, id: string) {
  return {
    concept: state.concepts.find(row => row.id === id),
    links: state.links.filter(row => !row.deletedAt && row.conceptId === id).sort((a, b) => a.id.localeCompare(b.id)),
    relations: state.relations
      .filter(row => !row.deletedAt && [row.fromConceptId, row.toConceptId].includes(id))
      .sort((a, b) => a.id.localeCompare(b.id))
  };
}
/** 合并和删除的影响确认独立于列表，避免详情页同时承载表单与提交状态。 */
export function ConceptActionDialog({
  concept,
  action,
  canWrite,
  store,
  onSelect,
  onClose
}: {
  concept: KnowledgeConcept;
  action: 'merge' | 'delete';
  canWrite: boolean;
  store: ConceptStore;
  onSelect(id: string | null): void;
  onClose(): void;
}) {
  const state = useConceptState(store);
  const [opened] = useState(() => ({
    action,
    ...structuredClone(impactSnapshot(state, concept.id)),
    owner: structuredClone(concept)
  }));
  const [target, setTarget] = useState<ReturnType<typeof impactSnapshot> | null>(null);
  const operationId = useRef<string | null>(null);
  const targetId = target?.concept?.id ?? '';
  const staleSnapshot = (current: ConceptState) => {
    const owner = current.concepts.find(row => row.id === opened.owner.id);
    if (action !== opened.action || concept.id !== opened.owner.id || !owner || owner.deletedAt || owner.mergedInto)
      return true;
    if (
      JSON.stringify(impactSnapshot(current, owner.id)) !==
      JSON.stringify({ concept: opened.concept, links: opened.links, relations: opened.relations })
    )
      return true;
    if (target) {
      const currentTarget = current.concepts.find(row => row.id === targetId);
      if (
        !currentTarget ||
        currentTarget.deletedAt ||
        currentTarget.mergedInto ||
        currentTarget.reviewStatus === 'archived'
      )
        return true;
      if (JSON.stringify(impactSnapshot(current, targetId)) !== JSON.stringify(target)) return true;
    }
    return false;
  };
  const stale = staleSnapshot(state);
  const submit = async () => {
    const current = store.getState();
    if (!canWrite || current.pending || current.status !== 'ready' || current.unavailable || staleSnapshot(current))
      return;
    const base = {
      id: opened.owner.id,
      expectedRevision: opened.owner.revision,
      operationId: (operationId.current ??= randomId())
    };
    try {
      if (action === 'merge' && target?.concept) {
        await store.execute({
          ...base,
          type: 'mergeConcept',
          targetId: target.concept.id,
          expectedTargetRevision: target.concept.revision
        });
        onSelect(target.concept.id);
      } else if (action === 'delete') {
        await store.execute({ ...base, type: 'deleteConcept' });
        onSelect(null);
      } else return;
      onClose();
    } catch {
      /* 保留输入和错误，允许重新核对。 */
    }
  };
  return (
    <Dialog
      isOpen
      title={action === 'merge' ? '合并概念？' : '删除概念？'}
      isPending={state.pending}
      onOpenChange={open => {
        if (!open && !state.pending) onClose();
      }}
    >
      <DialogBody>
        <div className={styles.form}>
          {action === 'merge' ? (
            <>
              <p>
                将“{opened.owner.name}
                ”的知识点关联和关系迁到目标概念，并把原名称保留为别名。重复关联按主体优先去重，重复关系合为一条，概念内部的关系会删除。合并不可撤销。
              </p>
              <Select
                isDisabled={!canWrite || state.pending || stale}
                label="合并目标"
                value={targetId || null}
                onChange={key => {
                  setTarget(key ? structuredClone(impactSnapshot(store.getState(), String(key))) : null);
                  operationId.current = null;
                }}
                options={state.concepts
                  .filter(row => !row.deletedAt && row.id !== concept.id && row.reviewStatus !== 'archived')
                  .map(row => ({ id: row.id, label: `${row.name}${row.sense ? ` · ${row.sense}` : ''}` }))}
              />
            </>
          ) : (
            <p>
              将删除“{opened.owner.name}”、它的 {opened.links.length} 条挂靠，以及 {opened.relations.length}{' '}
              条关系（边）。知识点正文保留。
            </p>
          )}
          {stale ? (
            <p role="status">概念或关联范围已变化，旧确认已失效。请取消并重新打开，核对最新影响后再确认。</p>
          ) : null}
          {state.error ? <p role="alert">{state.error}</p> : null}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" isDisabled={state.pending} onPress={onClose}>
          取消
        </Button>
        <Button
          variant="danger"
          isPending={state.pending}
          isDisabled={
            !canWrite || stale || state.status !== 'ready' || state.unavailable || (action === 'merge' && !targetId)
          }
          onPress={() => void submit()}
        >
          {action === 'merge' ? '确认合并' : '删除概念及关系'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
