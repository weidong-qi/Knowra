import { useEffect, useRef, useState } from 'react';
import type { KnowledgeItem, TrainingAssetRecord } from '@study-accelerator/web-core';
import { Button, Dialog, DialogBody, DialogFooter, Select } from '../../components/ui';
import { useAppStore } from '../../store/AppStoreProvider';
import { workspaceCapabilities } from '../../store/workspaceCapabilities';
import { downloadTextFile } from '../../browser/downloadFile';
import { useKnowledgeFormSafety } from '../knowledge/KnowledgeItemForm';
import { LearningObjectiveForm, type LearningObjectiveFormValue } from './LearningObjectiveForm';
import { objectiveActionLabel, objectiveConfirmable, objectiveError, objectiveFieldsValid, objectiveLevelLabel, objectiveStatus } from './learningObjectiveModel';
import styles from './TrainingWorkspaceView.module.css';

function fields(record?: TrainingAssetRecord): LearningObjectiveFormValue { return { objective: record?.objective ?? '', actionVerb: record?.actionVerb ?? '', cognitiveLevel: record?.cognitiveLevel ?? '' }; }

export function LearningObjectiveReviewDialog({ record, knowledge, knowledgeItems = [], onClose, onSaved }: {
  record?: TrainingAssetRecord; knowledge?: KnowledgeItem; knowledgeItems?: KnowledgeItem[]; onClose(): void; onSaved(): void;
}) {
  const getKnowledge = useAppStore(s => s.getKnowledgeItem);
  const list = useAppStore(s => s.listTrainingAssets);
  const create = useAppStore(s => s.createTrainingAsset);
  const update = useAppStore(s => s.updateTrainingAsset);
  const mutate = useAppStore(s => s.mutateTrainingAsset);
  const dataMode = useAppStore(s => s.dataMode);
  const persistenceMode = useAppStore(s => s.persistenceMode);
  const workspaceWritable = useAppStore(s => s.canWriteWorkspace);
  const generation = useAppStore(s => s.knowledgeGeneration);
  const canWrite = dataMode === 'api' && workspaceCapabilities(persistenceMode).writeTraining && workspaceWritable();
  const [knowledgeId, setKnowledgeId] = useState(record?.knowledgeItemId ?? knowledge?.id ?? knowledgeItems.find(item => item.reviewStatus === 'confirmed' && !item.deletedAt)?.id ?? '');
  const [baseline, setBaseline] = useState(record);
  const [parent, setParent] = useState<KnowledgeItem | null>(null);
  const [value, setValue] = useState(() => fields(record));
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [latest, setLatest] = useState<{ parent: KnowledgeItem; objective?: TrainingAssetRecord } | null>(null);
  const [reload, setReload] = useState(0);
  const [discardOpen, setDiscardOpen] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const initialGeneration = useRef(generation);
  const current = useRef({ generation, knowledgeId, canWrite, dataMode, persistenceMode });
  current.current = { generation, knowledgeId, canWrite, dataMode, persistenceMode };
  const initialLoad = useRef(true);

  useEffect(() => {
    if (generation !== initialGeneration.current) { setStale(true); setError('资料已刷新，原审阅版本已保留。请重新加载并核对。'); }
  }, [generation]);
  useEffect(() => {
    let active = true;
    setLoading(true); setLatest(null);
    if (!knowledgeId) { setLoading(false); setParent(null); return; }
    // 每支读取独立进入 Promise，避免同步拒绝跳过聚合并遗留另一支异步错误。
    void Promise.all([
      Promise.resolve().then(() => getKnowledge(knowledgeId)),
      Promise.resolve().then(() => record ? list('learningObjective') : [])
    ])
      .then(([item, objectives]) => {
        if (!active) return;
        const objective = record ? objectives.find(row => row.id === record.id) : undefined;
        if (record && !objective) throw new Error('学习目标已不存在，请关闭后重新核对列表。');
        if (initialLoad.current) {
          setParent(knowledge ?? item);
          // 原条目保持打开时的基线；后台新版本必须明确重新审阅。
          if ((record && objective?.updatedAt !== record.updatedAt) || (knowledge && item.updatedAt !== knowledge.updatedAt) || reload > 0 || generation !== initialGeneration.current) { setStale(true); setLatest({ parent: item, objective }); setError('学习目标或父知识需重新核对，请明确采用当前版本后继续。'); }
          initialLoad.current = false;
        } else setLatest({ parent: item, objective });
      }).catch(cause => { if (active) { setError(objectiveError(cause)); setStale(true); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [knowledgeId, getKnowledge, list, reload, record?.id, generation, dataMode, persistenceMode]);

  const dirty = JSON.stringify(value) !== JSON.stringify(fields(baseline));
  const releaseSafety = useKnowledgeFormSafety(dirty || pending, undefined, '学习目标仍有未保存的输入，请先保存或明确放弃输入，再退出。');
  const parentReady = parent?.reviewStatus === 'confirmed' && !parent.deletedAt;
  const editable = canWrite && !loading && !pending && !baseline?.deletedAt && baseline?.reviewStatus !== 'archived';
  const ready = editable && !stale && parentReady && objectiveFieldsValid(value);
  function closeWithoutDraft() { releaseSafety(); onClose(); }
  function requestClose() { if (!pending) { if (dirty) setDiscardOpen(true); else closeWithoutDraft(); } }
  async function submit(confirm: boolean) {
    if (!ready || (confirm && (!baseline || dirty || !objectiveConfirmable(value)))) return;
    const operationScope = { ...current.current };
    setPending(true); setError('');
    const reviewBaseline = { knowledgeUpdatedAt: parent!.updatedAt, ...(baseline ? { objectiveUpdatedAt: baseline.updatedAt } : {}) };
    try {
      if (confirm) await mutate('learningObjective', baseline!.id, 'confirm', { reviewBaseline });
      else if (baseline) await update('learningObjective', baseline.id, { ...value, reviewBaseline });
      else await create('learningObjective', { ...value, knowledgeItemId: knowledgeId, reviewBaseline });
      if (!mounted.current || current.current.generation !== operationScope.generation || current.current.knowledgeId !== operationScope.knowledgeId || current.current.canWrite !== operationScope.canWrite || current.current.dataMode !== operationScope.dataMode || current.current.persistenceMode !== operationScope.persistenceMode) return;
      releaseSafety(); onSaved(); onClose();
    } catch (cause) {
      if (!mounted.current || current.current.generation !== operationScope.generation || current.current.knowledgeId !== operationScope.knowledgeId || current.current.canWrite !== operationScope.canWrite || current.current.dataMode !== operationScope.dataMode || current.current.persistenceMode !== operationScope.persistenceMode) return;
      setError(`${objectiveError(cause)} 输入草稿与原审阅版本已保留。`);
      if ((cause as { code?: string })?.code === 'LEARNING_OBJECTIVE_UPDATE_CONFLICT') setStale(true);
    } finally { setPending(false); }
  }
  return <><Dialog title={record ? '审阅学习目标' : '新建学习目标候选'} size="md" isOpen isPending={pending} onOpenChange={open => { if (!open) requestClose(); }}>
    <DialogBody><div className={styles.form}>
      {!canWrite ? <p role="status">当前资料只读，请重新连接并加载资料后操作。</p> : null}
      {!record && !knowledge ? <Select label="所属知识" selectedKey={knowledgeId || null} options={knowledgeItems.filter(item => item.reviewStatus === 'confirmed' && !item.deletedAt).map(item => ({ id: item.id, label: item.title }))} isDisabled={pending} onSelectionChange={key => { initialLoad.current = true; setParent(null); setError(''); setStale(false); setKnowledgeId(String(key)); }} /> : null}
      {loading ? <p role="status">正在读取审阅版本…</p> : null}
      {parent ? <section aria-label="审阅的父知识"><h3>{parent.title}</h3><p>{parent.canonicalStatement}</p>{parent.userExplanation ? <p>{parent.userExplanation}</p> : null}<p>知识版本：{parent.updatedAt} · {parentReady ? '已确认' : '尚未确认或已删除'}</p></section> : null}
      {baseline ? <p>目标状态：{objectiveStatus(baseline)} · 目标版本：{baseline.updatedAt}</p> : null}
      <LearningObjectiveForm value={value} disabled={!editable} onChange={setValue} />
      <p>这是人工整理的目标。保存与确认分开；保存后请重新打开，核对已保存内容与父知识，再明确确认。</p>
      {dirty && baseline ? <p>有未保存修改，先保存后重新审阅；不能直接确认这些修改。</p> : null}
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      {stale ? <Button isDisabled={loading || pending} onPress={() => setReload(n => n + 1)}>重新加载当前版本以核对</Button> : null}
      {latest ? <section aria-label="重新加载的当前版本"><h3>当前父知识：{latest.parent.title}</h3><p>{latest.parent.canonicalStatement}</p><p>知识版本：{latest.parent.updatedAt}</p>{latest.objective ? <><p>当前目标：{latest.objective.objective}</p><p>动作：{objectiveActionLabel(latest.objective.actionVerb)} · 认知层级：{objectiveLevelLabel(latest.objective.cognitiveLevel)} · {objectiveStatus(latest.objective)}</p></> : null}<p>输入草稿仍在上方。采用后请逐项核对，保存修改与确认仍分开。</p><Button isDisabled={loading || pending} onPress={() => { setParent(latest.parent); setBaseline(latest.objective); setStale(false); setLatest(null); setError(''); initialGeneration.current = generation; }}>采用当前版本重新审阅</Button></section> : null}
    </div></DialogBody>
    <DialogFooter className={styles.objectiveFooter}><Button variant="ghost" isDisabled={pending} onPress={() => downloadTextFile('学习目标-输入草稿.json', JSON.stringify({ knowledgeItemId: knowledgeId, value, reviewBaseline: { knowledgeUpdatedAt: parent?.updatedAt, objectiveUpdatedAt: baseline?.updatedAt } }, null, 2), 'application/json;charset=utf-8')}>导出输入草稿</Button><Button variant="ghost" isDisabled={pending} onPress={requestClose}>关闭</Button><Button isDisabled={!ready} isPending={pending} onPress={() => void submit(false)}>保存候选</Button>{baseline?.reviewStatus === 'candidate' ? <Button variant="primary" isDisabled={!ready || dirty || !objectiveConfirmable(value)} onPress={() => void submit(true)}>确认已审阅目标</Button> : null}</DialogFooter>
  </Dialog>{discardOpen ? <Dialog title="放弃未保存的学习目标输入？" isOpen onOpenChange={open => { if (!open) setDiscardOpen(false); }}><DialogBody><p>输入尚未保存，可返回继续编辑或导出输入草稿。</p></DialogBody><DialogFooter><Button onPress={() => setDiscardOpen(false)}>继续编辑</Button><Button variant="danger" onPress={closeWithoutDraft}>放弃输入并关闭</Button></DialogFooter></Dialog> : null}</>;
}
