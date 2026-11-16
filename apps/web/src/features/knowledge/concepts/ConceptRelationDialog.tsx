import { useRef, useState } from 'react';
import {
  CONCEPT_RELATION_TYPES,
  conceptItemLinks,
  conceptRelationProjections,
  type ConceptRelationType,
  type KnowledgeItem
} from '@study-accelerator/web-core';
import { Button, Dialog, DialogBody, DialogFooter, Select } from '../../../components/ui';
import { randomId } from '../../../browser/randomId';
import { useKnowledgeFormSafety } from '../KnowledgeItemForm';
import { useConceptState, type ConceptStore } from './conceptStore';
import { CONCEPT_RELATION_LABELS, type RelationEditor } from './conceptRelationModel';
import styles from './ConceptRelations.module.css';

export function ConceptRelationDialog({
  editor,
  items,
  store,
  canWrite,
  onClose
}: {
  editor: RelationEditor;
  items: KnowledgeItem[];
  store: ConceptStore;
  canWrite: boolean;
  onClose(): void;
}) {
  const state = useConceptState(store);
  const [baseline, setBaseline] = useState(editor.owner);
  const [relationBaseline, setRelationBaseline] = useState(editor.relation);
  const [toId, setToId] = useState(editor.relation?.toConceptId ?? editor.projection?.toConceptId ?? '');
  const [type, setType] = useState<ConceptRelationType | ''>(editor.relation?.type ?? '');
  const [basisId, setBasisId] = useState(editor.relation?.basisItemId ?? editor.projection?.basisItemId ?? '');
  const [relationId] = useState(() => editor.relation?.id ?? randomId());
  const [error, setError] = useState('');
  const attempt = useRef<{ payload: string; operationId: string } | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const owner = state.concepts.find(row => row.id === baseline.id && !row.deletedAt && !row.mergedInto);
  const currentRelation = editor.relation
    ? state.relations.find(row => row.id === editor.relation!.id && !row.deletedAt)
    : undefined;
  const changed = owner?.revision !== baseline.revision || currentRelation?.revision !== relationBaseline?.revision;
  const missing = !owner || Boolean(editor.relation && !currentRelation);
  const projectionAvailable =
    !editor.projection || conceptRelationProjections(state, items).some(row => row.id === editor.projection!.id);
  const target = state.concepts.find(row => row.id === toId && !row.deletedAt && !row.mergedInto);
  const links = conceptItemLinks(state, items);
  const basisItems = items.filter(
    item =>
      !item.deletedAt &&
      [baseline.id, toId].every(id => links.some(link => link.conceptId === id && link.knowledgeItemId === item.id))
  );
  const validBasis = !basisId || basisItems.some(item => item.id === basisId);
  const dirty =
    !editor.deleting &&
    (toId !== (editor.relation?.toConceptId ?? editor.projection?.toConceptId ?? '') ||
      type !== (editor.relation?.type ?? '') ||
      basisId !== (editor.relation?.basisItemId ?? editor.projection?.basisItemId ?? ''));
  const releaseSafety = useKnowledgeFormSafety(
    dirty || state.pending,
    undefined,
    '关系仍有未保存的修改，请先保存或取消。'
  );
  const close = () => {
    if (state.pending) return;
    if (dirty) setDiscardOpen(true);
    else {
      releaseSafety();
      onClose();
    }
  };
  const allowed =
    canWrite && state.status === 'ready' && !state.unavailable && !missing && !changed && projectionAvailable;
  const submit = async () => {
    if (!allowed || state.pending || (!editor.deleting && (!target || !type || !validBasis))) return;
    setError('');
    try {
      // 同一负载重试必须复用回执键，尤其是服务端已成功但响应丢失时。
      const payload = JSON.stringify({
        id: baseline.id,
        revision: baseline.revision,
        relationRevision: relationBaseline?.revision,
        relationId,
        deleting: editor.deleting,
        toId,
        type,
        basisId
      });
      if (attempt.current?.payload !== payload) attempt.current = { payload, operationId: randomId() };
      const base = { id: baseline.id, expectedRevision: baseline.revision, operationId: attempt.current.operationId };
      if (editor.deleting && relationBaseline) {
        await store.execute({
          ...base,
          type: 'deleteRelation',
          relationId,
          expectedRelationRevision: relationBaseline.revision
        });
      } else if (type) {
        const fields = { ...base, relationId, toConceptId: toId, relationType: type, basisItemId: basisId || null };
        await store.execute(
          relationBaseline
            ? { ...fields, type: 'updateRelation', expectedRelationRevision: relationBaseline.revision }
            : { ...fields, type: 'createRelation' }
        );
      }
      releaseSafety();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败，请重试。');
    }
  };
  return (
    <>
      <Dialog
        isOpen
        title={
          editor.deleting
            ? '删除这条关系？'
            : editor.projection
              ? '确认条目投影的关系类型'
              : editor.relation
                ? '编辑关系'
                : '建立概念关系'
        }
        isPending={state.pending}
        onOpenChange={open => {
          if (!open) close();
        }}
      >
        <DialogBody>
          <div className={styles.form}>
            <p>
              起点：{baseline.name}。
              {editor.deleting
                ? '只删除关系，不删除概念、挂靠或依据知识点。'
                : '方向从起点指向终点；“相关”和“对比”不分方向。'}
            </p>
            {editor.deleting ? (
              <p>
                {baseline.name} → {CONCEPT_RELATION_LABELS[relationBaseline!.type]} →{' '}
                {state.concepts.find(row => row.id === relationBaseline!.toConceptId)?.name}；依据：
                {items.find(row => row.id === relationBaseline!.basisItemId)?.title || '无'}
              </p>
            ) : (
              <>
                <Select
                  label="终点概念"
                  selectedKey={toId || null}
                  isDisabled={!canWrite || state.pending || Boolean(editor.projection)}
                  onSelectionChange={key => setToId(String(key ?? ''))}
                  options={state.concepts
                    .filter(
                      row =>
                        !row.deletedAt &&
                        !row.mergedInto &&
                        row.id !== baseline.id &&
                        (row.reviewStatus !== 'archived' || row.id === toId)
                    )
                    .map(row => ({ id: row.id, label: `${row.name}${row.sense ? ` · ${row.sense}` : ''}` }))}
                />
                <Select
                  label="关系类型"
                  selectedKey={type || null}
                  isDisabled={!canWrite || state.pending}
                  onSelectionChange={key => setType((key ?? '') as typeof type)}
                  options={CONCEPT_RELATION_TYPES.map(id => ({ id, label: CONCEPT_RELATION_LABELS[id] }))}
                />
                <Select
                  label="依据知识点"
                  selectedKey={basisId || '__none__'}
                  isDisabled={!canWrite || state.pending || Boolean(editor.projection)}
                  onSelectionChange={key => setBasisId(key === '__none__' ? '' : String(key ?? ''))}
                  options={[
                    { id: '__none__', label: '无依据，仅建立手工骨架' },
                    ...basisItems.map(item => ({ id: item.id, label: item.title }))
                  ]}
                />
                <p className={styles.hint}>依据必须同时挂靠关系两端；说明文字保存在知识点中。</p>
                {!validBasis ? <p role="alert">当前依据不再同时挂靠两端，请重新选择。</p> : null}
              </>
            )}
            {missing ? (
              <p role="alert">概念或关系已删除、合并，请关闭后重新选择。</p>
            ) : changed ? (
              <div role="alert">
                <p>此概念或关系已在别处修改。你的输入已保留，请先核对最新记录。</p>
                <p>
                  最新起点：{owner?.name}（版本 {owner?.revision}）
                  {currentRelation
                    ? `；最新关系：${CONCEPT_RELATION_LABELS[currentRelation.type]} → ${state.concepts.find(row => row.id === currentRelation.toConceptId)?.name}；依据：${items.find(row => row.id === currentRelation.basisItemId)?.title || '无'}`
                    : ''}
                </p>
                {!editor.deleting ? (
                  <Button
                    size="compact"
                    isDisabled={state.pending}
                    onPress={() => {
                      if (owner) {
                        setBaseline(owner);
                        setRelationBaseline(currentRelation);
                        setError('');
                      }
                    }}
                  >
                    已核对，按最新版本继续
                  </Button>
                ) : (
                  <p>删除影响已经变化，请关闭后重新确认。</p>
                )}
              </div>
            ) : null}
            {!projectionAvailable ? <p role="alert">这条投影已确认或挂靠角色已变化，请关闭后重新查看。</p> : null}
            {error ? <p role="alert">{error}</p> : null}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" isDisabled={state.pending} onPress={close}>
            取消
          </Button>
          <Button
            variant={editor.deleting ? 'danger' : 'primary'}
            isDisabled={!allowed || (!editor.deleting && (!target || !type || !validBasis))}
            isPending={state.pending}
            onPress={() => void submit()}
          >
            {editor.deleting ? '确认删除关系' : editor.projection ? '确认并保存关系' : '保存关系'}
          </Button>
        </DialogFooter>
      </Dialog>
      {discardOpen ? (
        <Dialog
          isOpen
          title="放弃未保存的关系修改？"
          onOpenChange={open => {
            if (!open) setDiscardOpen(false);
          }}
        >
          <DialogBody>
            <p>关闭后，本次关系输入将丢失。</p>
          </DialogBody>
          <DialogFooter>
            <Button onPress={() => setDiscardOpen(false)}>继续编辑</Button>
            <Button
              variant="danger"
              onPress={() => {
                releaseSafety();
                onClose();
              }}
            >
              放弃修改
            </Button>
          </DialogFooter>
        </Dialog>
      ) : null}
    </>
  );
}
