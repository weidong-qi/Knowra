import { useState } from 'react';
import type { KnowledgeConcept } from '@study-accelerator/web-core';
import { Button, Dialog, DialogBody, DialogFooter, Select } from '../../../components/ui';
import { randomId } from '../../../browser/randomId';
import { useConceptState, type ConceptStore } from './conceptStore';
import styles from './Concepts.module.css';
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
  const [targetId, setTargetId] = useState('');
  const submit = async () => {
    if (!canWrite) return;
    const target = state.concepts.find(row => row.id === targetId && !row.deletedAt);
    const base = { id: concept.id, expectedRevision: concept.revision, operationId: randomId() };
    try {
      if (action === 'merge' && target) {
        await store.execute({
          ...base,
          type: 'mergeConcept',
          targetId: target.id,
          expectedTargetRevision: target.revision
        });
        onSelect(target.id);
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
                将“{concept.name}
                ”的知识点关联和关系迁到目标概念，并把原名称保留为别名。重复关联按主体优先去重，重复关系合为一条，概念内部的关系会删除。合并不可撤销。
              </p>
              <Select
                label="合并目标"
                value={targetId || null}
                onChange={key => setTargetId(String(key ?? ''))}
                options={state.concepts
                  .filter(row => !row.deletedAt && row.id !== concept.id && row.reviewStatus !== 'archived')
                  .map(row => ({ id: row.id, label: `${row.name}${row.sense ? ` · ${row.sense}` : ''}` }))}
              />
            </>
          ) : (
            <p>
              将删除“{concept.name}”、它的{' '}
              {state.links.filter(row => !row.deletedAt && row.conceptId === concept.id).length} 条挂靠，以及{' '}
              {
                state.relations.filter(
                  row => !row.deletedAt && [row.fromConceptId, row.toConceptId].includes(concept.id)
                ).length
              }{' '}
              条关系（边）。知识点正文保留。
            </p>
          )}
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
          isDisabled={!canWrite || (action === 'merge' && !targetId)}
          onPress={() => void submit()}
        >
          {action === 'merge' ? '确认合并' : '删除概念及关系'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
