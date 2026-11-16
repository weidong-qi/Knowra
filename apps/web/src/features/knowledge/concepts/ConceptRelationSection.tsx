import { useState } from 'react';
import {
  conceptRelationProjections,
  conceptVisibleRelations,
  type KnowledgeConcept,
  type KnowledgeConceptRelation,
  type KnowledgeItem
} from '@study-accelerator/web-core';
import { Button } from '../../../components/ui';
import { useConceptState, type ConceptStore } from './conceptStore';
import { ConceptRelationDialog } from './ConceptRelationDialog';
import { CONCEPT_RELATION_LABELS, isSymmetricRelation, type RelationEditor } from './conceptRelationModel';
import styles from './ConceptRelations.module.css';

export function ConceptRelationSection({
  concept,
  items,
  store,
  canWrite,
  onOpenConcept,
  onOpenItem
}: {
  concept: KnowledgeConcept;
  items: KnowledgeItem[];
  store: ConceptStore;
  canWrite: boolean;
  onOpenConcept(id: string): void;
  onOpenItem(id: string): void;
}) {
  const state = useConceptState(store);
  const [editor, setEditor] = useState<RelationEditor | null>(null);
  const relations = conceptVisibleRelations(state, items).filter(
    row => row.fromConceptId === concept.id || row.toConceptId === concept.id
  );
  const projections = conceptRelationProjections(state, items).filter(
    row => row.fromConceptId === concept.id || row.toConceptId === concept.id
  );
  const names = new Map(state.concepts.map(row => [row.id, `${row.name}${row.sense ? ` · ${row.sense}` : ''}`]));
  const itemNames = new Map(items.map(row => [row.id, row.title]));
  const open = (relation: KnowledgeConceptRelation, deleting = false) => {
    const owner = state.concepts.find(row => row.id === relation.fromConceptId && !row.deletedAt);
    if (owner) setEditor({ owner, relation, deleting });
  };
  const endpoints = (from: string, to: string, label: string, bidirectional = false) => (
    <span className={styles.endpoints}>
      <Button variant="ghost" size="compact" onPress={() => onOpenConcept(from)}>
        {names.get(from) ?? '不可用概念'}
      </Button>
      <span>
        {bidirectional ? '↔' : '→'} {label} {bidirectional ? '↔' : '→'}
      </span>
      <Button variant="ghost" size="compact" onPress={() => onOpenConcept(to)}>
        {names.get(to) ?? '不可用概念'}
      </Button>
    </span>
  );
  return (
    <section className={styles.section} aria-label="概念关系">
      <div className={styles.heading}>
        <h3>关系</h3>
        {canWrite ? (
          <Button size="compact" isDisabled={state.pending} onPress={() => setEditor({ owner: concept })}>
            建立关系
          </Button>
        ) : null}
      </div>
      <p className={styles.hint}>实线表示已记录的关系；虚线是条目产生的待定类型提示，选择类型后才会保存。</p>
      {relations.length ? (
        <ul className={styles.rows}>
          {relations.map(row => (
            <li key={row.id}>
              {endpoints(
                row.fromConceptId,
                row.toConceptId,
                CONCEPT_RELATION_LABELS[row.type],
                isSymmetricRelation(row.type)
              )}
              {row.reviewStatus === 'candidate' ? <span>候选关系</span> : null}
              {row.basisItemId ? (
                <Button
                  variant="ghost"
                  size="compact"
                  className={styles.basis}
                  onPress={() => onOpenItem(row.basisItemId!)}
                >
                  依据：{itemNames.get(row.basisItemId) || '查看知识点'}
                </Button>
              ) : (
                <span className={styles.hint}>手工骨架（无依据知识点）</span>
              )}
              {canWrite ? (
                <div className={styles.actions}>
                  <Button size="compact" variant="ghost" isDisabled={state.pending} onPress={() => open(row)}>
                    编辑关系
                  </Button>
                  <Button size="compact" variant="danger" isDisabled={state.pending} onPress={() => open(row, true)}>
                    删除关系
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p>还没有正式关系。</p>
      )}
      <h4>条目投影 · 待定类型（{projections.length}）</h4>
      {projections.length ? (
        <ul className={styles.rows}>
          {projections.map(row => (
            <li key={row.id} className={styles.projection}>
              {endpoints(row.fromConceptId, row.toConceptId, '待定类型')}
              <Button
                variant="ghost"
                size="compact"
                className={styles.basis}
                onPress={() => onOpenItem(row.basisItemId)}
              >
                来自：{itemNames.get(row.basisItemId) || '查看知识点'}
              </Button>
              {canWrite ? (
                <Button
                  size="compact"
                  isDisabled={state.pending}
                  onPress={() => {
                    const owner = state.concepts.find(value => value.id === row.fromConceptId && !value.deletedAt);
                    if (owner) setEditor({ owner, projection: row });
                  }}
                >
                  选择类型并确认
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.hint}>一条知识点以主体挂靠此概念、同时提及另一个概念时，会产生提示。</p>
      )}
      {editor ? (
        <ConceptRelationDialog
          key={`${editor.owner.id}:${editor.relation?.id ?? editor.projection?.id ?? 'new'}:${Boolean(editor.deleting)}`}
          editor={editor}
          items={items}
          store={store}
          canWrite={canWrite}
          onClose={() => setEditor(null)}
        />
      ) : null}
    </section>
  );
}
