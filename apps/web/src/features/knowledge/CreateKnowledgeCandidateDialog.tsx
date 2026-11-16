import { MathText } from '../../components/math/MathText';
import { useState, type ReactNode } from 'react';
import type {
  Annotation,
  CreateKnowledgeCandidateInput,
  KnowledgeEvidence,
  KnowledgeItem
} from '@study-accelerator/web-core';
import { KnowledgeItemDialog } from './KnowledgeItemDialog';
import { knowledgeFormValue, type KnowledgeFormValue } from './KnowledgeItemForm';
import { knowledgeDraftSource, type KnowledgeDraft } from './knowledgeDraftRecovery';
import styles from './KnowledgeWorkspaceView.module.css';

export interface CreateKnowledgeCandidateDialogProps {
  source?: Annotation;
  recoveryDraft?: KnowledgeDraft;
  definitionTarget?: KnowledgeDraft['definitionTarget'];
  canWrite: boolean;
  readOnlyReason?: string;
  title?: string;
  initialValue?: Partial<KnowledgeFormValue>;
  lockKnowledgeType?: boolean;
  children?: ReactNode;
  onClose(): void;
  onCreate(input: CreateKnowledgeCandidateInput): Promise<{ item: KnowledgeItem; evidence: KnowledgeEvidence[] }>;
  onCreated?(item: KnowledgeItem): void;
}

export function CreateKnowledgeCandidateDialog({
  source,
  recoveryDraft,
  definitionTarget,
  canWrite,
  readOnlyReason,
  title,
  initialValue: initialInput,
  lockKnowledgeType,
  children,
  onClose,
  onCreate,
  onCreated
}: CreateKnowledgeCandidateDialogProps) {
  const [draft] = useState<KnowledgeDraft>(() => {
    if (recoveryDraft) return recoveryDraft;
    const initialValue = knowledgeFormValue(
      source
        ? {
            title: source.headingPath.at(-1) ?? '',
            canonicalStatement: source.quoteText,
            userExplanation: source.comment ?? ''
          }
        : initialInput
    );
    return {
      version: 1,
      kind: 'create',
      candidateId: `knowledge-${crypto.randomUUID()}`,
      initialValue,
      value: initialValue,
      ...(definitionTarget ? { definitionTarget } : {}),
      ...(source ? { source: knowledgeDraftSource(source) } : {})
    };
  });
  const origin = draft.source;
  return (
    <KnowledgeItemDialog
      title={title ?? (origin ? '从标注创建知识点' : '新建知识点')}
      draft={draft}
      recovered={Boolean(recoveryDraft)}
      lockKnowledgeType={lockKnowledgeType}
      canWrite={canWrite}
      readOnlyReason={readOnlyReason}
      onClose={onClose}
      onSubmit={async value => {
        const result = await onCreate({
          ...value,
          id: draft.candidateId,
          sourceMode: origin ? 'annotation' : 'manual',
          ...(origin
            ? {
                evidence: [
                  {
                    sourceType: 'annotation',
                    annotationId: origin.annotationId,
                    ...(origin.noteVersionId ? { noteVersionId: origin.noteVersionId } : {}),
                    ...(origin.expectedAnnotationRevision !== undefined
                      ? { expectedAnnotationRevision: origin.expectedAnnotationRevision }
                      : {})
                  }
                ]
              }
            : {})
        });
        return result.item;
      }}
      onSaved={item => {
        if (item) onCreated?.(item);
      }}
    >
      {children}
      {origin ? (
        <section className={styles.sourcePreview} aria-label="来源标注">
          <strong>来源标注</strong>
          {origin.headingPath.length > 0 ? <p>{origin.headingPath.join(' / ')}</p> : null}
          <blockquote>
            <MathText text={origin.quoteText} />
          </blockquote>
          <p className={styles.hint}>保存后保留来源快照。知识陈述可以重新组织，来源摘录保持原文。</p>
        </section>
      ) : null}
    </KnowledgeItemDialog>
  );
}
