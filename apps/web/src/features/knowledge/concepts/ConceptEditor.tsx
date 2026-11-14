import { useState } from 'react';
import { ApiRequestError, type KnowledgeConcept } from '@study-accelerator/web-core';
import { Button, Dialog, DialogBody, DialogFooter, TextField } from '../../../components/ui';
import { useKnowledgeFormSafety } from '../KnowledgeItemForm';
import { randomId } from '../../../browser/randomId';
import { useConceptState, type ConceptStore } from './conceptStore';
import styles from './Concepts.module.css';
export function ConceptEditor({
  concept,
  itemId,
  initialName = '',
  canWrite,
  store,
  onClose,
  onSaved
}: {
  concept?: KnowledgeConcept;
  itemId?: string;
  initialName?: string;
  canWrite: boolean;
  store: ConceptStore;
  onClose(): void;
  onSaved?(id: string): void;
}) {
  const [name, setName] = useState(concept?.name ?? initialName);
  const [sense, setSense] = useState(concept?.sense ?? '');
  const [aliases, setAliases] = useState(concept?.aliases.join('、') ?? '');
  const [id] = useState(() => concept?.id ?? randomId());
  const [operationId, setOperationId] = useState(() => randomId());
  const [baseline, setBaseline] = useState(concept);
  const [conflicted, setConflicted] = useState(false);
  const state = useConceptState(store);
  const [discardOpen, setDiscardOpen] = useState(false);
  const latest = state.concepts.find(row => row.id === id);
  const targetUnavailable = Boolean(concept && (!latest || latest.deletedAt || latest.mergedInto));
  const needsReview = Boolean(concept && (conflicted || latest?.revision !== baseline?.revision));
  const blocked = state.status !== 'ready' || state.unavailable || targetUnavailable || needsReview;
  const adoptBaseline = () => {
    if (!latest || targetUnavailable || state.pending || state.status !== 'ready') return;
    setBaseline(latest);
    setOperationId(randomId());
    setConflicted(false);
  };
  const dirty =
    name !== (concept?.name ?? initialName) ||
    sense !== (concept?.sense ?? '') ||
    aliases !== (concept?.aliases.join('、') ?? '');
  const releaseSafety = useKnowledgeFormSafety(
    dirty || state.pending,
    undefined,
    '概念仍有未保存的修改，请先保存或取消编辑。'
  );
  const close = () => {
    if (state.pending) return;
    if (dirty) setDiscardOpen(true);
    else {
      releaseSafety();
      onClose();
    }
  };
  const submit = async () => {
    if (!canWrite || state.pending || blocked) return;
    const fields = {
      name,
      sense,
      aliases: aliases
        .split(/[、,，\n]/u)
        .map(value => value.trim())
        .filter(Boolean)
    };
    try {
      await store.execute(
        concept
          ? { type: 'updateConcept', operationId, id, expectedRevision: baseline!.revision, patch: fields }
          : {
              type: 'createConcept',
              operationId,
              id,
              expectedRevision: 0,
              ...fields,
              itemIds: itemId ? [itemId] : undefined,
              role: 'subject'
            }
      );
      releaseSafety();
      onSaved?.(id);
      onClose();
    } catch (error) {
      if (
        error instanceof ApiRequestError &&
        ['CONCEPT_REVISION_CONFLICT', 'CONCEPT_MERGED', 'CONCEPT_NOT_FOUND'].includes(error.code ?? '')
      )
        setConflicted(true);
      /* 错误在弹窗中展示，保留输入。 */
    }
  };
  return (
    <>
      <Dialog
        isOpen
        title={concept ? '编辑概念' : '新建概念'}
        isPending={state.pending}
        onOpenChange={open => {
          if (!open) close();
        }}
      >
        <DialogBody>
          <div className={styles.form}>
            <TextField
              autoFocus
              isDisabled={!canWrite || state.pending}
              label="概念名称"
              value={name}
              onChange={setName}
              maxLength={80}
              isRequired
            />
            <TextField
              isDisabled={!canWrite || state.pending}
              label="区分标签"
              value={sense}
              onChange={setSense}
              maxLength={80}
              description="同名概念用不同语境区分，例如“线性代数”。"
            />
            <TextField
              isDisabled={!canWrite || state.pending}
              label="别名"
              value={aliases}
              onChange={setAliases}
              description="用顿号或逗号分隔，最多 20 个。"
            />
            {itemId ? <p>创建后，会将当前知识点作为主体挂入。</p> : null}
            {state.error ? <p role="alert">{state.error}</p> : null}
            {concept && targetUnavailable ? (
              <p role="status">此概念已删除、合并或不再可用，不能保存旧编辑。草稿仍保留，请复制后关闭。</p>
            ) : concept && needsReview ? (
              <section aria-label="核对概念最新版本">
                <p>
                  远端概念已变化。你的草稿仍保留；请核对最新内容，明确采用新版本为基线后再保存。保存将用当前草稿替换这些字段。
                </p>
                {latest ? (
                  <dl>
                    <dt>最新名称</dt>
                    <dd>{latest.name}</dd>
                    <dt>最新区分标签</dt>
                    <dd>{latest.sense || '无'}</dd>
                    <dt>最新别名</dt>
                    <dd>{latest.aliases.join('、') || '无'}</dd>
                  </dl>
                ) : null}
                <Button
                  isDisabled={
                    !canWrite || state.pending || state.status !== 'ready' || latest?.revision === baseline?.revision
                  }
                  onPress={adoptBaseline}
                >
                  已核对，采用最新版本基线
                </Button>
                <Button
                  variant="ghost"
                  isDisabled={state.pending}
                  onPress={() => void store.load({ preserveError: true })}
                >
                  重新获取最新版本
                </Button>
              </section>
            ) : null}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" isDisabled={state.pending} onPress={close}>
            取消
          </Button>
          <Button
            variant="primary"
            isDisabled={!canWrite || !name.trim() || blocked}
            isPending={state.pending}
            onPress={() => void submit()}
          >
            保存概念
          </Button>
        </DialogFooter>
      </Dialog>
      {discardOpen ? (
        <Dialog
          isOpen
          title="放弃未保存的概念修改？"
          onOpenChange={open => {
            if (!open) setDiscardOpen(false);
          }}
        >
          <DialogBody>
            <p>关闭后，本次修改将丢失。</p>
          </DialogBody>
          <DialogFooter>
            <Button variant="primary" onPress={() => setDiscardOpen(false)}>
              继续编辑
            </Button>
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
