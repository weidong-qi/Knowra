import { useEffect, useState } from 'react';
import type { KnowledgeConcept, KnowledgeItem } from '@study-accelerator/web-core';
import { Button, Dialog, DialogBody, DialogFooter, Select } from '../../../components/ui';
import { randomId } from '../../../browser/randomId';
import { useNavigate } from '../../../app/router';
import { sharedConceptStore, useConceptState } from './conceptStore';
import { ConceptEditor } from './ConceptEditor';
import { RemoveLinksDialog } from './ConceptLinkDialogs';
import styles from './Concepts.module.css';
export function KnowledgeItemConcepts({ item, canWrite }: { item: KnowledgeItem; canWrite: boolean }) {
  const navigate = useNavigate();
  const store = sharedConceptStore();
  const state = useConceptState(store);
  const [creating, setCreating] = useState(false);
  const [adding, setAdding] = useState(false);
  const [targetId, setTargetId] = useState('');
  const [role, setRole] = useState<'subject' | 'mentions'>('subject');
  const [removal, setRemoval] = useState<{ concept: KnowledgeConcept; id: string } | null>(null);
  useEffect(() => {
    void store.load();
  }, [store, item.id]);
  const links = state.links.filter(row => !row.deletedAt && row.knowledgeItemId === item.id);
  const write = canWrite && !item.deletedAt && state.status === 'ready' && !state.unavailable;
  const add = async () => {
    const target = state.concepts.find(row => row.id === targetId && !row.deletedAt);
    if (!target || !write) return;
    try {
      await store.execute({
        type: 'linkItems',
        operationId: randomId(),
        id: target.id,
        expectedRevision: target.revision,
        itemIds: [item.id],
        role
      });
      setAdding(false);
    } catch {
      /* 保留弹窗。 */
    }
  };
  return (
    <section aria-label="所属概念">
      <h3>所属概念</h3>
      <div className={styles.membership}>
        {links.map(link => {
          const concept = state.concepts.find(row => row.id === link.conceptId && !row.deletedAt);
          return concept ? (
            <span key={link.id}>
              <Button
                variant="ghost"
                onPress={() => navigate(`/knowledge/concepts?concept=${encodeURIComponent(concept.id)}`)}
              >
                {concept.name} · {link.role === 'subject' ? '主体' : '提及'}
              </Button>
              {write ? (
                <Button variant="ghost" isDisabled={state.pending} onPress={() => setRemoval({ concept, id: link.id })}>
                  移除
                </Button>
              ) : null}
            </span>
          ) : null;
        })}
        {!links.length ? <span>{state.unavailable ? '当前资料库暂不支持概念' : '尚未归入概念'}</span> : null}
        {write ? (
          <>
            <Button
              isDisabled={state.pending}
              onPress={() => {
                setTargetId('');
                setAdding(true);
              }}
            >
              添加概念
            </Button>
            {item.knowledgeType === 'concept' ? (
              <Button isDisabled={state.pending} onPress={() => setCreating(true)}>
                由此创建概念
              </Button>
            ) : null}
          </>
        ) : null}
      </div>
      {creating ? (
        <ConceptEditor
          initialName={item.title}
          itemId={item.id}
          canWrite={write}
          store={store}
          onClose={() => setCreating(false)}
        />
      ) : null}
      {removal ? (
        <RemoveLinksDialog
          concept={removal.concept}
          linkIds={[removal.id]}
          canWrite={write}
          store={store}
          onClose={() => setRemoval(null)}
        />
      ) : null}
      {adding ? (
        <Dialog
          isOpen
          title="添加所属概念"
          isPending={state.pending}
          onOpenChange={open => {
            if (!open && !state.pending) setAdding(false);
          }}
        >
          <DialogBody>
            <div className={styles.form}>
              <Select
                label="选择概念"
                value={targetId || null}
                onChange={key => setTargetId(String(key ?? ''))}
                options={state.concepts
                  .filter(
                    row =>
                      !row.deletedAt &&
                      row.reviewStatus !== 'archived' &&
                      !links.some(link => link.conceptId === row.id)
                  )
                  .map(row => ({ id: row.id, label: `${row.name}${row.sense ? ` · ${row.sense}` : ''}` }))}
              />
              <Select
                label="关联角色"
                value={role}
                onChange={key => setRole(key as typeof role)}
                options={[
                  { id: 'subject', label: '主体' },
                  { id: 'mentions', label: '提及' }
                ]}
              />
              {state.error ? <p role="alert">{state.error}</p> : null}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" isDisabled={state.pending} onPress={() => setAdding(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              isDisabled={!write || !targetId}
              isPending={state.pending}
              onPress={() => void add()}
            >
              添加
            </Button>
          </DialogFooter>
        </Dialog>
      ) : null}
    </section>
  );
}
