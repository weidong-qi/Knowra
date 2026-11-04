import { MathText } from '../../components/math/MathText';
import { useState } from 'react';
import type { KnowledgeEvidence, KnowledgeItem } from '@study-accelerator/web-core';
import { Button } from '../../components/ui';
import { knowledgeStatusLabel, knowledgeTypeLabel } from './knowledgeViewModel';
import { evidenceApplicabilityLabel, evidenceHealthLabel } from './knowledgeSourceViewModel';
import { KnowledgeProvenanceNotice, KnowledgeSourceComparison } from './KnowledgeSourceComparisonDialog';
import { KnowledgeLearningObjectives } from './KnowledgeLearningObjectives';
import styles from './KnowledgeWorkspaceView.module.css';

export function KnowledgeDetail({ item, evidence, canWrite, pending, onEdit, onConfirm, onArchive, onRestore, onTrash, onRestoreDeleted, onPurgePreview, onOpenNote, onAddSource, onReplaceSource, onRetireSource, onReadoptSource }: {
  item: KnowledgeItem; evidence: KnowledgeEvidence[]; canWrite: boolean; pending: boolean;
  onEdit(): void; onConfirm(): void; onArchive(): void; onRestore(): void; onTrash(): void; onRestoreDeleted(): void; onPurgePreview?: () => void; onOpenNote(noteId: string): void;
  onAddSource(): void; onReplaceSource(evidence: KnowledgeEvidence): void; onRetireSource(evidence: KnowledgeEvidence): void; onReadoptSource(evidence: KnowledgeEvidence): void;
}) {
  const [comparisonId, setComparisonId] = useState<string | null>(null);
  const comparisonEvidence = evidence.find(record => record.id === comparisonId);
  const archived = item.reviewStatus === 'archived';
  const sourceReady = item.sourceMode === 'manual' || evidence.some(record => record.status === 'valid' && (record.applicabilityStatus ?? 'active') === 'active');
  return <article className={styles.detail} aria-label="知识详情">
    <header className={styles.detailHeader}>
      <div className={styles.meta}><span className={styles.badge}>{knowledgeStatusLabel(item.reviewStatus)}</span><span>{knowledgeTypeLabel(item.knowledgeType)}</span></div>
      <h2>{item.title ? <MathText text={item.title} inlineOnly /> : '未命名知识'}</h2>
      <div className={styles.actions}>
        {item.deletedAt ? <><Button isDisabled={!canWrite || pending} onPress={onRestoreDeleted}>从回收站恢复</Button>{onPurgePreview ? <Button variant="danger" isDisabled={!canWrite || pending} onPress={onPurgePreview}>永久删除…</Button> : null}</> : <>
        <Button isDisabled={!canWrite || pending || archived} onPress={onEdit}>编辑</Button>
        {archived ? <Button isDisabled={!canWrite || pending} onPress={onRestore}>恢复为候选</Button> : <>
          {item.reviewStatus !== 'confirmed' ? <Button variant="primary" isDisabled={!canWrite || pending || !sourceReady || !item.title.trim() || !item.canonicalStatement.trim()} onPress={onConfirm}>确认知识</Button> : null}
          <Button variant="ghost" isDisabled={!canWrite || pending} onPress={onArchive}>归档</Button>
        </>}
        <Button variant="danger" isDisabled={!canWrite || pending} onPress={onTrash}>移入回收站</Button>
        </>}
      </div>
      {item.reviewStatus === 'needsRevision' ? <p className={styles.notice}>正文或来源已变化，请重新核对后确认。</p> : null}
      {item.reviewStatus === 'candidate' ? <p className={styles.hint}>这是待核对的候选。确认前请补齐标题、核心陈述，并检查下方来源。</p> : null}
      {!sourceReady && !archived ? <p className={styles.notice}>当前没有可用来源，暂不能确认。请在来源笔记中核对标注，再从有效标注建立候选。</p> : null}
    </header>
    <section className={styles.detailSection}><h3>核心陈述</h3><p className={styles.prose}>{item.canonicalStatement ? <MathText text={item.canonicalStatement} /> : '尚未填写核心陈述'}</p></section>
    {item.userExplanation ? <section className={styles.detailSection}><h3>我的解释</h3><p className={styles.prose}><MathText text={item.userExplanation} /></p></section> : null}
    <section className={styles.detailSection} aria-label="知识来源"><div className={styles.sectionHeading}><h3>来源 <span className={styles.count}>{evidence.length}</span></h3>{!item.deletedAt ? <Button variant="ghost" isDisabled={!canWrite || pending || archived} onPress={onAddSource}>添加来源</Button> : null}</div>
      {evidence.length === 0 ? <p className={styles.hint}>{item.sourceMode === 'manual' ? '手动创建的知识，没有关联笔记来源。' : '尚未关联可核对的来源。'}</p> : <ul className={styles.evidenceList}>{evidence.map(record => <li key={record.id} className={styles.evidence}>
        <div className={styles.meta}><strong>{record.sourceType === 'annotation' ? '标注摘录' : record.sourceType === 'noteVersion' ? '笔记快照' : '手动来源'}</strong><span>{evidenceHealthLabel(record.status)}</span><span>{evidenceApplicabilityLabel(record.applicabilityStatus)}</span>{record.sourceAnnotationRemoved ? <span>原标注已移除</span> : null}</div>
        {record.headingPath?.length ? <p className={styles.hint}>{record.headingPath.join(' / ')}</p> : null}
        <blockquote className={styles.prose}>{record.quoteText ? <MathText text={record.quoteText} /> : '该来源没有文字摘录'}</blockquote>
        <div className={styles.evidenceActions}><Button variant="ghost" isDisabled={pending} onPress={() => setComparisonId(record.id)}>对照来源</Button>{record.noteId ? <Button variant="ghost" isDisabled={pending} onPress={() => onOpenNote(record.noteId!)}>打开来源笔记</Button> : null}
          {!item.deletedAt && !archived && record.applicabilityStatus === 'withdrawn' ? <Button variant="ghost" isDisabled={!canWrite || pending || record.status !== 'valid'} onPress={() => onReadoptSource(record)}>重新采用</Button> : null}
          {!item.deletedAt && !archived && record.applicabilityStatus !== 'withdrawn' ? <><Button variant="ghost" isDisabled={!canWrite || pending} onPress={() => onReplaceSource(record)}>更换来源</Button><Button variant="ghost" isDisabled={!canWrite || pending} onPress={() => onRetireSource(record)}>撤回适用性</Button></> : null}
        </div>
        {record.status !== 'valid' ? <p className={styles.notice}>来源需要重新核对；保存的摘录仍可查看。</p> : null}
      </li>)}</ul>}
      {!evidence.length && item.sourceMode === 'ai' ? <KnowledgeProvenanceNotice item={item} /> : null}
    </section>
    <KnowledgeLearningObjectives key={item.id} item={item} />
    {item.updatedAt ? <p className={styles.hint}>更新于 {new Date(item.updatedAt).toLocaleString('zh-CN')}</p> : null}
    {comparisonEvidence ? <KnowledgeSourceComparison key={`${item.id}:${comparisonEvidence.id}`} item={item} evidence={comparisonEvidence} onClose={() => setComparisonId(null)} onOpenNote={onOpenNote} /> : null}
  </article>;
}
