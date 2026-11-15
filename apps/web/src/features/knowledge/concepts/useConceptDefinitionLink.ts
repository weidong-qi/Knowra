import { useRef, useState } from 'react';
import type { KnowledgeConcept, KnowledgeItem } from '@study-accelerator/web-core';
import { randomId } from '../../../browser/randomId';
import type { ConceptStore } from './conceptStore';

interface DefinitionLinkTask {
  concept: KnowledgeConcept;
  item: KnowledgeItem;
  operationId: string;
}

/** 创建和挂靠沿用两个既有接口；挂靠失败保留已保存知识，只重试关联。 */
export function useConceptDefinitionLink(store: ConceptStore) {
  const [task, setTask] = useState<DefinitionLinkTask | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const running = useRef(false);
  async function attach(current: DefinitionLinkTask, refresh: boolean) {
    if (running.current) return;
    running.current = true;
    setTask(current);
    setPending(true);
    setError('');
    try {
      if (refresh) await store.load();
      const snapshot = store.getState();
      if (snapshot.status !== 'ready' || snapshot.unavailable)
        throw new Error(snapshot.error || '概念尚未加载完成，请稍后重试。');
      const target = snapshot.concepts.find(row => row.id === current.concept.id && !row.deletedAt);
      if (!target) throw new Error('目标概念已删除或合并，定义知识仍保留在知识库。');
      const linked = snapshot.links.some(
        link =>
          !link.deletedAt &&
          link.conceptId === target.id &&
          link.knowledgeItemId === current.item.id &&
          link.role === 'subject'
      );
      if (!linked)
        await store.execute({
          type: 'linkItems',
          id: target.id,
          expectedRevision: refresh ? target.revision : current.concept.revision,
          operationId: refresh ? randomId() : current.operationId,
          itemIds: [current.item.id],
          role: 'subject'
        });
      setTask(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '挂入概念失败，请重试。');
    } finally {
      running.current = false;
      setPending(false);
    }
  }
  return {
    task,
    pending,
    error,
    start: (concept: KnowledgeConcept, item: KnowledgeItem) =>
      attach({ concept, item, operationId: randomId() }, false),
    retry: () => (task ? attach(task, true) : Promise.resolve()),
    dismiss: () => {
      if (!running.current) {
        setTask(null);
        setError('');
      }
    }
  };
}
