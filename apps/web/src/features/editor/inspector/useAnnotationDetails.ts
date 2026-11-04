import { useEffect, useRef, useState } from 'react';
import type { Annotation, AnnotationPreview, AnnotationKnowledgeLinks } from '@study-accelerator/web-core';
import type { EditorInspectorProps } from './types';

type DetailProps = Pick<EditorInspectorProps, 'canWrite' | 'onPreviewAnnotation' | 'onGetAnnotationKnowledgeLinks' | 'onUpdateAnnotation'>;
type Run = (id: string, action: () => Promise<void>, isCurrent?: () => boolean) => Promise<void>;

/** 最新详情请求拥有展示权；切笔记由面板 key 重挂载，卸载使旧请求失效。 */
export function useAnnotationDetails(props: DetailProps, run: Run) {
  const detailRequest = useRef(0);
  useEffect(() => () => { detailRequest.current += 1; }, []);
  const [detail, setDetail] = useState<{ annotation: Annotation; preview: AnnotationPreview; links: AnnotationKnowledgeLinks } | null>(null);
  const [kind, setKind] = useState<'important' | 'question' | 'supplement' | 'pitfall' | 'temporary'>('important');
  const [importance, setImportance] = useState('normal');
  const [importanceChanged, setImportanceChanged] = useState(false);
  const [comment, setComment] = useState('');
  async function openDetail(annotation: Annotation) {
    if (!props.onPreviewAnnotation || !props.onGetAnnotationKnowledgeLinks) return;
    let request: number | undefined;
    const isCurrent = () => request === detailRequest.current;
    const previewAnnotation = props.onPreviewAnnotation;
    const getKnowledgeLinks = props.onGetAnnotationKnowledgeLinks;
    await run(annotation.id, async () => {
      request = ++detailRequest.current;
      const [preview, links] = await Promise.all([
        previewAnnotation(annotation.id),
        getKnowledgeLinks(annotation.id)
      ]);
      if (!isCurrent()) return;
      setKind(annotation.kind as 'important' | 'question' | 'supplement' | 'pitfall' | 'temporary');
      setImportance(annotation.importance ?? 'normal');
      setImportanceChanged(false);
      setComment(annotation.comment ?? '');
      setDetail({ annotation: preview.annotation, preview, links });
    }, isCurrent);
  }

  async function saveMetadata() {
    if (!detail || !props.canWrite || !props.onUpdateAnnotation) return;
    const updateAnnotation = props.onUpdateAnnotation;
    await run(detail.annotation.id, async () => {
      await updateAnnotation(detail.annotation.id, {
        expectedRevision: detail.annotation.revision ?? 1,
        kind,
        ...(importanceChanged ? { importance: importance as Annotation['importance'] } : {}),
        comment
      });
      setDetail(null);
    });
  }

  return { detail, setDetail, kind, setKind, importance, setImportance, setImportanceChanged, comment, setComment, openDetail, saveMetadata };
}
