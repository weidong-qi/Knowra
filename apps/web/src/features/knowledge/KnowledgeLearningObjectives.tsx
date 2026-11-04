import { MathText } from '../../components/math/MathText';
import { useEffect, useState } from 'react';
import type { KnowledgeItem, TrainingAssetRecord } from '@study-accelerator/web-core';
import { Button } from '../../components/ui';
import { useAppStore } from '../../store/AppStoreProvider';
import { workspaceCapabilities } from '../../store/workspaceCapabilities';
import { LearningObjectiveReviewDialog } from '../training/LearningObjectiveReviewDialog';
import { objectiveActionLabel, objectiveLevelLabel, objectiveStatus } from '../training/learningObjectiveModel';
import styles from './KnowledgeWorkspaceView.module.css';

export function KnowledgeLearningObjectives({ item }: { item: KnowledgeItem }) {
  const list = useAppStore(s => s.listTrainingAssets);
  const dataMode = useAppStore(s => s.dataMode);
  const persistenceMode = useAppStore(s => s.persistenceMode);
  const workspaceWritable = useAppStore(s => s.canWriteWorkspace);
  const generation = useAppStore(s => s.knowledgeGeneration);
  const canWrite = dataMode === 'api' && workspaceCapabilities(persistenceMode).writeTraining && workspaceWritable();
  const [records, setRecords] = useState<TrainingAssetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [review, setReview] = useState<{ knowledgeId: string; record?: TrainingAssetRecord } | null>(null);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setRecords([]);
    if (!list || dataMode !== 'api') { setLoading(false); setError('当前服务无法读取关联学习目标，请连接资料库后重试。'); return; }
    void Promise.resolve().then(() => list('learningObjective')).then(result => { if (active) setRecords(result.filter(record => record.knowledgeItemId === item.id)); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : '学习目标读取失败，请重试。'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [item.id, list, dataMode, refresh, generation]);
  return <section className={styles.detailSection} aria-label="关联学习目标">
    <div className={styles.sectionHeading}><h3>学习目标</h3><Button variant="ghost" isDisabled={!canWrite || loading || Boolean(error) || item.reviewStatus !== 'confirmed' || Boolean(item.deletedAt)} onPress={() => setReview({ knowledgeId: item.id })}>新建学习目标候选</Button></div>
    {!canWrite ? <p className={styles.hint}>当前资料只读，可查看目标；请重新连接并加载资料后操作。</p> : null}
    {item.reviewStatus !== 'confirmed' || item.deletedAt ? <p className={styles.hint}>请先核对并确认知识，再创建和确认学习目标。</p> : null}
    {loading ? <p role="status">正在读取关联学习目标…</p> : error ? <><p role="alert" className={styles.error}>{error}</p><Button onPress={() => setRefresh(n => n + 1)}>重试读取学习目标</Button></> : records.length === 0 ? <p className={styles.hint}>尚无关联学习目标。</p> : <ul className={styles.evidenceList}>{records.map(record => <li key={record.id} className={styles.evidence}>
      <div className={styles.meta}><strong>{record.objective ? <MathText text={record.objective} inlineOnly /> : '尚未填写目标'}</strong><span>{objectiveStatus(record)}</span></div>
      <p className={styles.hint}>动作：{objectiveActionLabel(record.actionVerb)} · 认知层级：{objectiveLevelLabel(record.cognitiveLevel)}</p>
      {record.reviewNote ? <p className={styles.notice}>{String(record.reviewNote)}</p> : null}
      <Button variant="ghost" onPress={() => setReview({ knowledgeId: item.id, record })}>查看并审阅目标</Button>
    </li>)}</ul>}
    {review?.knowledgeId === item.id ? <LearningObjectiveReviewDialog key={`${item.id}:${review.record?.id ?? 'new'}`} record={review.record} knowledge={item} onClose={() => setReview(null)} onSaved={() => setRefresh(n => n + 1)} /> : null}
  </section>;
}
