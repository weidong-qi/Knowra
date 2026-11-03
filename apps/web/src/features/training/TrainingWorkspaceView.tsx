import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TrainingAssetKind, TrainingAssetRecord, TrainingPurgePreview, KnowledgeItem } from '@study-accelerator/web-core';
import { Button, Dialog, DialogBody, DialogClose, DialogFooter, SearchBox, SegmentedButton, SegmentedControl, Select, TextAreaField, TextField } from '../../components/ui';
import { WorkspacePanel, WorkspacePanelBody, WorkspacePanelFooter, WorkspacePanelHeader, WorkspacePanelToolbar } from '../../components/workspace/WorkspacePanel';
import { PathTrail } from '../../shell/PathTrail';
import { QuestionIcon, PlusIcon, SearchIcon } from '../../components/icons/knowra';
import { useAppStore } from '../../store/AppStoreProvider';
import { useNavigate } from '../../app/router';
import { QuestionDetailPanel } from './QuestionDetailPanel';
import { QuestionSourceComparison } from './QuestionSourceComparison';
import { loadQuestionSource } from './questionSourceModel';
import { questionSources, type QuestionSource } from './questionDetailModel';
import { QuestionValue } from './QuestionValue';
import { LearningObjectiveReviewDialog } from './LearningObjectiveReviewDialog';
import { objectiveActionLabel, objectiveLevelLabel } from './learningObjectiveModel';
import styles from './TrainingWorkspaceView.module.css';
import { LOCAL_ASSET_PURGE_REASON, workspaceCapabilities } from '../../store/workspaceCapabilities';
import { isPurgeResultPending, PURGE_PENDING_MESSAGE, purgeConfirmation, purgeResultMessage } from '../../store/assetPurge';
import type { AuthoritativePurgeResult } from '@study-accelerator/web-core';

const KINDS: TrainingAssetKind[] = ['learningObjective', 'examProfile', 'examFocus', 'question'];
const LABELS: Record<TrainingAssetKind, string> = { learningObjective: '学习目标', examProfile: '考试配置', examFocus: '考点', question: '题目' };
const STATUS: Record<string, string> = { candidate: '待确认', confirmed: '已确认', archived: '已归档', draft: '草稿', validating: '待校验' };

type FormTarget = { kind: TrainingAssetKind; value?: TrainingAssetRecord } | null;
type ActionTarget = { kind: TrainingAssetKind; value: TrainingAssetRecord; action: 'trash' | 'purge' } | null;
function label(record: TrainingAssetRecord, kind: TrainingAssetKind) {
  return String(record.name ?? record.objective ?? record.stem ?? record.description ?? `${LABELS[kind]} ${record.id}`);
}
function errorText(error: unknown) { return error instanceof Error ? error.message : '操作失败，请重试。'; }

export function TrainingWorkspaceView() {
  const navigate = useNavigate();
  const dataMode = useAppStore(s => s.dataMode);
  const persistenceMode = useAppStore(s => s.persistenceMode);
  const canWriteWorkspace = useAppStore(s => s.canWriteWorkspace);
  const list = useAppStore(s => s.listTrainingAssets);
  const create = useAppStore(s => s.createTrainingAsset);
  const update = useAppStore(s => s.updateTrainingAsset);
  const mutate = useAppStore(s => s.mutateTrainingAsset);
  const inspect = useAppStore(s => s.inspectTrainingAssetPurge);
  const purge = useAppStore(s => s.purgeTrainingAsset);
  const purgeStatus = useAppStore(s => s.getAuthoritativePurgeStatus);
  const listKnowledgeItems = useAppStore(s => s.listKnowledgeItems);
  const getKnowledgeItem = useAppStore(s => s.getKnowledgeItem);
  const listKnowledgeEvidence = useAppStore(s => s.listKnowledgeEvidence);
  const getNoteVersion = useAppStore(s => s.getNoteVersion);
  const knowledgeGeneration = useAppStore(s => s.knowledgeGeneration);
  const canWrite = dataMode === 'api' && workspaceCapabilities(persistenceMode).writeTraining && canWriteWorkspace();
  const canPurge = dataMode === 'api' && canWriteWorkspace() && workspaceCapabilities(persistenceMode).purgeTraining;
  const [records, setRecords] = useState<Record<TrainingAssetKind, TrainingAssetRecord[]>>({ learningObjective: [], examProfile: [], examFocus: [], question: [] });
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);
  const [kind, setKind] = useState<TrainingAssetKind>('question');
  const [view, setView] = useState<'active' | 'archived' | 'trash'>('active');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState<FormTarget>(null);
  const [objectiveReview, setObjectiveReview] = useState<{ record?: TrainingAssetRecord } | null>(null);
  const [action, setAction] = useState<ActionTarget>(null);
  const [preview, setPreview] = useState<TrainingPurgePreview | null>(null);
  const [purgeAwaiting, setPurgeAwaiting] = useState<{ kind: TrainingAssetKind; id: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [comparedSource, setComparedSource] = useState<QuestionSource | null>(null);

  useEffect(() => {
    if (dataMode !== 'api' || persistenceMode !== 'desktop-local' || !purgeStatus) return;
    let active = true;
    void Promise.resolve().then(() => purgeStatus()).then(status => {
      if (active && status.pending && KINDS.includes(status.pending.type as TrainingAssetKind)) {
        setPurgeAwaiting({ kind: status.pending.type as TrainingAssetKind, id: status.pending.id }); setNotice(PURGE_PENDING_MESSAGE);
      }
    }).catch(() => { /* 预检入口负责说明当前服务不兼容或未连接。 */ });
    return () => { active = false; };
  }, [dataMode, persistenceMode, purgeStatus]);

  const reload = useCallback(async () => {
    const [objectives, profiles, focuses, questions, items] = await Promise.all([
      ...KINDS.map(value => list(value)), listKnowledgeItems({ includeDeleted: false })
    ]);
    return { records: { learningObjective: objectives as TrainingAssetRecord[], examProfile: profiles as TrainingAssetRecord[], examFocus: focuses as TrainingAssetRecord[], question: questions as TrainingAssetRecord[] }, knowledgeItems: items as KnowledgeItem[] };
  }, [list, listKnowledgeItems]);
  useEffect(() => {
    if (dataMode !== 'api') return;
    let active = true;
    setLoading(true); setError('');
    void reload().then(result => { if (active) { setRecords(result.records); setKnowledgeItems(result.knowledgeItems); } })
      .catch(cause => { if (active) setError(errorText(cause)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [dataMode, reload, generation, knowledgeGeneration]);

  const visible = useMemo(() => records[kind].filter(record => {
    if (view === 'trash' && !record.deletedAt) return false;
    if (view === 'trash') return label(record, kind).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
    if (record.deletedAt) return false;
    const archived = record.reviewStatus === 'archived' || Boolean(record.archivedAt);
    if (view === 'archived' ? !archived : archived) return false;
    return label(record, kind).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  }), [records, kind, view, query]);
  const activeObjectives = records.learningObjective.filter(item => !item.deletedAt && item.reviewStatus === 'confirmed');
  const activeProfiles = records.examProfile.filter(item => !item.deletedAt && !item.archivedAt);
  const selectedQuestion = kind === 'question' ? visible.find(record => record.id === selectedQuestionId) : undefined;
  const activeComparedSource = useMemo(() => selectedQuestion && comparedSource ? questionSources(selectedQuestion).find(source => source.id === comparedSource.id) : null, [selectedQuestion, comparedSource]);
  const loadSource = useCallback((source: QuestionSource) => {
    if (!selectedQuestion) return Promise.reject(new Error('请先选择题目。'));
    return loadQuestionSource(source, { question: selectedQuestion, objectives: records.learningObjective,
      onGetKnowledge: getKnowledgeItem, onListEvidence: listKnowledgeEvidence, onGetVersion: getNoteVersion });
  }, [selectedQuestion, records.learningObjective, getKnowledgeItem, listKnowledgeEvidence, getNoteVersion]);
  function closeDetail() {
    setSelectedQuestionId(null); setComparedSource(null);
    document.getElementById(`question-detail-${selectedQuestionId}`)?.focus();
  }

  async function runMutation(value: TrainingAssetRecord, selectedKind: TrainingAssetKind, operation: 'validate' | 'confirm' | 'archive' | 'restore' | 'restore-deleted') {
    setBusy(true); setError(''); setNotice('');
    try { await mutate(selectedKind, value.id, operation); setNotice(`${LABELS[selectedKind]}已更新。`); setGeneration(n => n + 1); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }
  async function openPurge(value: TrainingAssetRecord, selectedKind: TrainingAssetKind) {
    setBusy(true); setError(''); setPreview(null); setAction({ kind: selectedKind, value, action: 'purge' });
    try { setPreview(await inspect(selectedKind, value.id)); setPurgeAwaiting(null); setNotice(''); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }
  function acceptPurgeResult(result: AuthoritativePurgeResult) {
    setNotice(persistenceMode === 'desktop-local' ? purgeResultMessage(result) : '已永久清理。');
    setAction(null); setPreview(null); setPurgeAwaiting(null); setGeneration(n => n + 1);
  }
  async function checkPurgeResult() {
    if (!purgeAwaiting || !purgeStatus || busy) return;
    setBusy(true); setError('');
    try {
      const status = await purgeStatus();
      if (!status.pending && status.result?.asset.id === purgeAwaiting.id && status.result.asset.type === purgeAwaiting.kind) acceptPurgeResult(status.result);
      else setNotice(PURGE_PENDING_MESSAGE);
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (purgeAwaiting) void checkPurgeResult();
    // 只在已同步工作区刷新后核对，不自动重发清理。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [knowledgeGeneration]);
  async function commitAction() {
    if (!action || purgeAwaiting || (action.action === 'purge' && !canPurge)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (action.action === 'trash') await mutate(action.kind, action.value.id, 'trash');
      else if (preview?.decision === 'can-purge-no-history') {
        const result = await purge(action.kind, action.value.id, preview.confirmationToken ? purgeConfirmation(preview) : preview.expectedUpdatedAt);
        acceptPurgeResult(result); return;
      }
      else return;
      setNotice(action.action === 'trash' ? '已移入回收站。' : '已永久清理。');
      setAction(null); setPreview(null); setGeneration(n => n + 1);
    } catch (cause) {
      if (action.action === 'purge' && persistenceMode === 'desktop-local' && isPurgeResultPending(cause)) {
        setPurgeAwaiting({ kind: action.kind, id: action.value.id }); setNotice(PURGE_PENDING_MESSAGE);
      } else { setError(errorText(cause)); if (action.action === 'purge') setPreview(null); }
    }
    finally { setBusy(false); }
  }

  if (dataMode !== 'api') return <section className={styles.gate}><h1>试题库</h1><p role="alert">资料库尚未连接，暂时无法读取训练资产。</p></section>;
  return <WorkspacePanel as="main" aria-labelledby="training-title">
    <WorkspacePanelHeader title="试题库" code="TRAIN" titleId="training-title" icon={<QuestionIcon size={14} />}
      breadcrumb={<PathTrail path={[{ id: 'training', label: '试题库', current: true }]} variant="top" />}
      actionsLabel="训练资产操作" actions={canWrite ? <Button variant="primary" size="workspace" onPress={() => kind === 'learningObjective' ? setObjectiveReview({}) : setForm({ kind })}><PlusIcon size={17} />新建{LABELS[kind]}</Button> : null} />
    <WorkspacePanelToolbar className={styles.toolbar} role="toolbar" aria-label="训练资产筛选">
      <SegmentedControl density="compact" className={styles.filterGroup} aria-label="训练资产类型">{KINDS.map(value => <SegmentedButton key={value} aria-pressed={kind === value} onPress={() => { setKind(value); setQuery(''); }}>{LABELS[value]}</SegmentedButton>)}</SegmentedControl>
      <SearchBox label={`搜索${LABELS[kind]}`} icon={<SearchIcon size={17} />} value={query} onChange={event => setQuery(event.target.value)} onClear={query ? () => setQuery('') : undefined} placeholder={`搜索${LABELS[kind]}…`} />
      <SegmentedControl density="compact" className={styles.filterGroup} aria-label="生命周期状态"><SegmentedButton aria-pressed={view === 'active'} onPress={() => setView('active')}>使用中</SegmentedButton><SegmentedButton aria-pressed={view === 'archived'} onPress={() => setView('archived')}>已归档</SegmentedButton><SegmentedButton aria-pressed={view === 'trash'} onPress={() => setView('trash')}>回收站</SegmentedButton></SegmentedControl>
    </WorkspacePanelToolbar>
    <WorkspacePanelBody className={`${styles.body} ${kind === 'question' ? styles.questionBody : ''}`}>
      {!canWrite ? <p className={styles.info}>当前资料只读，可查看训练资产；请重新连接并加载资料后操作。</p> : null}
      {persistenceMode === 'desktop-local' && view === 'trash' ? <p className={styles.info}>{LOCAL_ASSET_PURGE_REASON}</p> : null}
      {error ? <div><p role="alert" className={styles.error}>{error}</p>{!form && !action ? <Button size="compact" onPress={() => setGeneration(value => value + 1)}>重新加载训练资产</Button> : null}</div> : null}
      {notice ? <p role="status" className={styles.info}>{notice}</p> : null}
      {purgeAwaiting && !action ? <Button isDisabled={busy} onPress={() => void checkPurgeResult()}>核对清理结果</Button> : null}
      {loading ? <p role="status">正在加载训练资产…</p> : <div className={kind === 'question' ? styles.questionLayout : undefined}>
      <section className={kind === 'question' ? styles.questionList : undefined} aria-label={`${LABELS[kind]}列表`}>
      {visible.length === 0 ? <p className={styles.empty}>当前筛选下没有{LABELS[kind]}。</p> : <div className={kind === 'question' ? styles.questionRows : styles.cards}>{visible.map(record => <article className={`${styles.card} ${record.id === selectedQuestion?.id ? styles.selected : ''}`} key={record.id}>
        <div className={styles.cardTop}><h2>{label(record, kind)}</h2><span>{record.deletedAt ? '回收站' : record.archivedAt ? '已归档' : STATUS[record.reviewStatus ?? ''] ?? '使用中'}</span></div>
        <p className={styles.meta}>{kind === 'learningObjective' ? `知识 ${knowledgeItems.find(item => item.id === record.knowledgeItemId)?.title ?? record.knowledgeItemId ?? '—'} · ${objectiveActionLabel(record.actionVerb)} / ${objectiveLevelLabel(record.cognitiveLevel)}` : kind === 'examFocus' ? `配置 ${record.examProfileId ?? '—'} · 目标 ${record.learningObjectiveId ?? '—'}` : kind === 'question' ? `${record.learningObjectiveIds?.length ?? 0} 个学习目标` : record.description || '考试语境配置'}</p>
        <div className={styles.actions} aria-label={`${label(record, kind)}的操作`}>
          {kind === 'question' ? <Button id={`question-detail-${record.id}`} size="compact" emphasis="soft" aria-pressed={selectedQuestionId === record.id} onPress={() => { setSelectedQuestionId(record.id); setComparedSource(null); }}>查看详情</Button> : null}
          {record.deletedAt ? <>{canWrite ? <Button size="compact" isDisabled={busy} onPress={() => void runMutation(record, kind, 'restore-deleted')}>恢复</Button> : null}{canPurge ? <Button size="compact" variant="danger" isDisabled={busy} onPress={() => void openPurge(record, kind)}>永久清理…</Button> : null}</> : <>
            {canWrite ? <Button size="compact" isDisabled={busy} onPress={() => kind === 'learningObjective' ? setObjectiveReview({ record }) : setForm({ kind, value: record })}>编辑</Button> : null}
            {canWrite && kind === 'question' && record.reviewStatus === 'draft' ? <Button size="compact" isDisabled={busy} onPress={() => void runMutation(record, kind, 'validate')}>校验</Button> : null}
            {canWrite && record.reviewStatus === 'candidate' && kind !== 'examProfile' ? <Button size="compact" isDisabled={busy} onPress={() => kind === 'learningObjective' ? setObjectiveReview({ record }) : void runMutation(record, kind, 'confirm')}>确认</Button> : null}
            {canWrite ? <Button size="compact" isDisabled={busy} onPress={() => void runMutation(record, kind, record.reviewStatus === 'archived' || record.archivedAt ? 'restore' : 'archive')}>{record.reviewStatus === 'archived' || record.archivedAt ? '取消归档' : '归档'}</Button> : null}
            {canWrite ? <Button size="compact" variant="danger" isDisabled={busy} onPress={() => setAction({ kind, value: record, action: 'trash' })}>删除…</Button> : null}
          </>}
        </div>
      </article>)}</div>}
      </section>
      {kind === 'question' ? <section className={styles.detailPanel} aria-label="题目检查器">
        {selectedQuestion ? <QuestionDetailPanel key={selectedQuestion.id} question={selectedQuestion} objectives={records.learningObjective} knowledgeItems={knowledgeItems}
          onClose={closeDetail} onCompare={setComparedSource} onOpenKnowledge={id => navigate(`/knowledge?item=${encodeURIComponent(id)}`)}
          onOpenObjective={objective => { setKind('learningObjective'); setView(objective.deletedAt ? 'trash' : objective.reviewStatus === 'archived' ? 'archived' : 'active'); setQuery(label(objective, 'learningObjective')); setComparedSource(null); }} />
          : <div className={styles.emptyDetail}><h2>选择题目查看详情</h2><p>核对题干、关联目标、参考答案、评分标准与来源。</p></div>}
      </section> : null}
      </div>}
    </WorkspacePanelBody>
    <WorkspacePanelFooter><span>显示 {visible.length} 个{LABELS[kind]}</span><span>{persistenceMode === 'desktop-local' ? '回收站对象独立于归档；永久清理需联网预检，离线保留原件' : view === 'trash' ? '保留至手动清理；永久清理前会复核引用' : '回收站对象独立于归档；永久清理前会复核引用'}</span></WorkspacePanelFooter>
    {selectedQuestion && activeComparedSource ? <QuestionSourceComparison key={`${selectedQuestion.id}-${selectedQuestion.updatedAt}-${activeComparedSource.id}`} source={activeComparedSource} onLoad={loadSource} onClose={() => setComparedSource(null)}
      onOpenNote={id => navigate(`/materials/notes/${encodeURIComponent(id)}`)} onOpenKnowledge={id => navigate(`/knowledge?item=${encodeURIComponent(id)}`)} /> : null}
    {objectiveReview ? <LearningObjectiveReviewDialog key={objectiveReview.record?.id ?? 'new'} record={objectiveReview.record} knowledgeItems={knowledgeItems} onClose={() => setObjectiveReview(null)} onSaved={() => { setNotice('学习目标已更新，请核对当前状态。'); setGeneration(n => n + 1); }} /> : null}
    {form ? <TrainingForm key={`${form.kind}-${form.value?.id ?? 'new'}`} target={form} knowledgeItems={knowledgeItems} objectives={activeObjectives} profiles={activeProfiles} pending={busy} error={error} onClose={() => { setForm(null); setError(''); }} onSave={async input => {
      setBusy(true); setError('');
      try { if (form.value) await update(form.kind, form.value.id, input); else await create(form.kind, input); setForm(null); setNotice(`${LABELS[form.kind]}已保存。`); setGeneration(n => n + 1); }
      catch (cause) { setError(errorText(cause)); }
      finally { setBusy(false); }
    }} /> : null}
    {action ? <Dialog title={action.action === 'trash' ? `删除${LABELS[action.kind]}？` : `永久清理${LABELS[action.kind]}？`} isOpen onOpenChange={open => { if (!open && !busy) { setAction(null); setPreview(null); setError(''); } }} isPending={busy}>
      <DialogBody><div className={styles.dialogContent}><p>“{label(action.value, action.kind)}”{action.action === 'trash' ? '将移入回收站，相关资产不会自动删除。' : '将被永久清理。备份与离线设备副本仍按各自保留规则处理。'}</p>
        {action.action === 'purge' && persistenceMode === 'desktop-local' ? <p>{LOCAL_ASSET_PURGE_REASON}</p> : null}
        {action.action === 'purge' && preview ? <><p>预检结果：{preview.decision === 'can-purge-no-history' ? '可以清理' : '需要先处理关联引用'}</p>{preview.references.length ? <ul>{preview.references.map(ref => <li key={`${ref.collection}-${ref.id}`}>{ref.collection} / {ref.id} · {ref.action} {ref.relatedAsset ? <Button variant="ghost" size="mini" onPress={() => {
          const target = records[ref.relatedAsset!.kind].find(item => item.id === ref.relatedAsset!.id);
          setKind(ref.relatedAsset!.kind);
          setView(target?.deletedAt ? 'trash' : target?.reviewStatus === 'archived' || target?.archivedAt ? 'archived' : 'active');
          setQuery(target ? label(target, ref.relatedAsset!.kind) : '');
          setAction(null); setPreview(null);
        }}>查看{LABELS[ref.relatedAsset.kind]}</Button> : null}</li>)}</ul> : null}</> : null}
        {error ? <p role="alert" className={styles.error}>{error}</p> : null}</div></DialogBody>
      <DialogFooter><DialogClose variant="ghost">取消</DialogClose>{action.action === 'purge' ? purgeAwaiting ? <Button isDisabled={busy} onPress={() => void checkPurgeResult()}>核对清理结果</Button> : <Button isDisabled={busy} onPress={() => void openPurge(action.value, action.kind)}>重新预检</Button> : null}<Button variant="danger" isDisabled={busy || Boolean(purgeAwaiting) || (action.action === 'purge' && (!canPurge || preview?.decision !== 'can-purge-no-history'))} onPress={() => void commitAction()}>{action.action === 'trash' ? '移入回收站' : '确认永久清理'}</Button></DialogFooter>
    </Dialog> : null}
  </WorkspacePanel>;
}

function TrainingForm({ target, knowledgeItems, objectives, profiles, pending, error, onClose, onSave }: {
  target: NonNullable<FormTarget>; knowledgeItems: KnowledgeItem[]; objectives: TrainingAssetRecord[]; profiles: TrainingAssetRecord[];
  pending: boolean; error: string; onClose(): void; onSave(input: Record<string, unknown>): Promise<void>;
}) {
  const current = target.value;
  const [name, setName] = useState(String(current?.name ?? ''));
  const [description, setDescription] = useState(String(current?.description ?? ''));
  const [stem, setStem] = useState(String(current?.stem ?? ''));
  const [answer, setAnswer] = useState(typeof current?.referenceAnswer === 'string' ? current.referenceAnswer : '');
  const [objectiveId, setObjectiveId] = useState(String(current?.learningObjectiveId ?? current?.learningObjectiveIds?.[0] ?? objectives[0]?.id ?? ''));
  const [profileId, setProfileId] = useState(String(current?.examProfileId ?? profiles[0]?.id ?? ''));
  const kind = target.kind;
  const structuredAnswer = current?.referenceAnswer !== null && current?.referenceAnswer !== undefined && typeof current.referenceAnswer !== 'string';
  async function submit() {
    const input: Record<string, unknown> = kind === 'examProfile' ? { name, description }
      : kind === 'examFocus' ? { description, ...(current ? {} : { examProfileId: profileId, learningObjectiveId: objectiveId }) }
      : { stem, ...(structuredAnswer ? {} : { referenceAnswer: answer }), ...(current ? {} : { questionType: 'shortAnswer', learningObjectiveIds: [objectiveId], sources: [{ sourceType: 'manual', quote: '人工编题' }] }) };
    await onSave(input);
  }
  const valid = kind === 'examProfile' ? Boolean(name.trim()) : kind === 'examFocus' ? Boolean(current || (profileId && objectiveId)) : Boolean(stem.trim() && (current || objectiveId));
  return <Dialog title={`${current ? '编辑' : '新建'}${LABELS[kind]}`} isOpen onOpenChange={open => { if (!open && !pending) onClose(); }} isPending={pending}>
    <DialogBody><div className={styles.form}>
      {kind === 'examProfile' ? <><TextField label="配置名称" value={name} onChange={setName} isRequired /><TextAreaField label="说明" value={description} onChange={setDescription} /></> : null}
      {kind === 'examFocus' ? <>{!current ? <><Select label="考试配置" selectedKey={profileId} onSelectionChange={key => setProfileId(String(key))} options={profiles.map(item => ({ id: item.id, label: label(item, 'examProfile') }))} /><Select label="学习目标" selectedKey={objectiveId} onSelectionChange={key => setObjectiveId(String(key))} options={objectives.map(item => ({ id: item.id, label: label(item, 'learningObjective') }))} /></> : null}<TextAreaField label="考点说明" value={description} onChange={setDescription} /></> : null}
      {kind === 'question' ? <>{!current ? <Select label="学习目标" selectedKey={objectiveId} onSelectionChange={key => setObjectiveId(String(key))} options={objectives.map(item => ({ id: item.id, label: label(item, 'learningObjective') }))} /> : null}<TextAreaField label="题干" value={stem} onChange={setStem} isRequired />{structuredAnswer ? <section aria-label="已有参考答案"><p>此题的参考答案为结构化内容，当前编辑器只修改题干。</p><QuestionValue value={current?.referenceAnswer} /></section> : <TextAreaField label="参考答案" value={answer} onChange={setAnswer} />}</> : null}
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    </div></DialogBody><DialogFooter><DialogClose variant="ghost">取消</DialogClose><Button variant="primary" isPending={pending} isDisabled={!valid} onPress={() => void submit()}>保存</Button></DialogFooter>
  </Dialog>;
}
