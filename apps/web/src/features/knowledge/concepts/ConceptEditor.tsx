import { useState } from 'react';
import type { KnowledgeConcept } from '@study-accelerator/web-core';
import { Button, Dialog, DialogBody, DialogFooter, TextField } from '../../../components/ui';
import { randomId } from '../../../browser/randomId';
import { useConceptState, type ConceptStore } from './conceptStore';
import styles from './Concepts.module.css';
export function ConceptEditor({
  concept,
  itemId,
  initialName = '',
  canWrite,
  store,
  onClose
}: {
  concept?: KnowledgeConcept;
  itemId?: string;
  initialName?: string;
  canWrite: boolean;
  store: ConceptStore;
  onClose(): void;
}) {
  const [name, setName] = useState(concept?.name ?? initialName);
  const [sense, setSense] = useState(concept?.sense ?? '');
  const [aliases, setAliases] = useState(concept?.aliases.join('、') ?? '');
  const [id] = useState(() => concept?.id ?? randomId());
  const [operationId] = useState(() => randomId());
  const state = useConceptState(store);
  const submit = async () => {
    if (!canWrite) return;
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
          ? { type: 'updateConcept', operationId, id, expectedRevision: concept.revision, patch: fields }
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
      onClose();
    } catch {
      /* 错误在弹窗中展示，保留输入。 */
    }
  };
  return (
    <Dialog
      isOpen
      title={concept ? '编辑概念' : '新建概念'}
      isPending={state.pending}
      onOpenChange={open => {
        if (!open && !state.pending) onClose();
      }}
    >
      <DialogBody>
        <div className={styles.form}>
          <TextField label="概念名称" value={name} onChange={setName} maxLength={80} isRequired />
          <TextField
            label="区分标签"
            value={sense}
            onChange={setSense}
            maxLength={80}
            description="同名概念用不同语境区分，例如“线性代数”。"
          />
          <TextField label="别名" value={aliases} onChange={setAliases} description="用顿号或逗号分隔，最多 20 个。" />
          {itemId ? <p>创建后，会将当前知识点作为主体挂入。</p> : null}
          {state.error ? <p role="alert">{state.error}</p> : null}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" isDisabled={state.pending} onPress={onClose}>
          取消
        </Button>
        <Button
          variant="primary"
          isDisabled={!canWrite || !name.trim()}
          isPending={state.pending}
          onPress={() => void submit()}
        >
          保存概念
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
