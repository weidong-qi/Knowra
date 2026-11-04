import { MathText } from '../../components/math/MathText';
import { ExtractionDemoNotice } from '../editor/ExtractionEnvironment';
import { useEffect, useState } from 'react';
import type { KnowledgeEvidence, KnowledgeItem, KnowledgeProvenance, NoteVersion } from '@study-accelerator/web-core';
import { Button, Dialog, DialogBody, DialogClose, DialogFooter } from '../../components/ui';
import { useAppStore } from '../../store/AppStoreProvider';
import { knowledgeStatusLabel } from './knowledgeViewModel';
import { evidenceApplicabilityLabel, evidenceHealthLabel, sourceVersionError } from './knowledgeSourceViewModel';
import styles from './KnowledgeSourceComparisonDialog.module.css';

interface ComparisonProps {
  item: KnowledgeItem;
  evidence: KnowledgeEvidence;
  onClose(): void;
  onOpenNote(noteId: string): void;
}

/** 只连接已有的历史版本读取能力；不改变来源、知识或笔记。 */
export function KnowledgeSourceComparison(props: ComparisonProps) {
  const getNoteVersion = useAppStore(state => state.getNoteVersion);
  const getKnowledgeProvenance = useAppStore(state => state.getKnowledgeProvenance);
  return <KnowledgeSourceComparisonDialog {...props} onGetVersion={getNoteVersion} onGetProvenance={getKnowledgeProvenance} />;
}

/** 旧 AI 知识可能没有 Evidence，仍应能读到明确的来源缺失记录。 */
export function KnowledgeProvenanceNotice({ item }: { item: KnowledgeItem }) {
  const getKnowledgeProvenance = useAppStore(state => state.getKnowledgeProvenance);
  return getKnowledgeProvenance ? <KnowledgeProvenanceSummary key={`${item.id}:${item.updatedAt}`}
    itemId={item.id} evidenceId="" onRead={getKnowledgeProvenance} /> : null;
}

interface DialogProps extends ComparisonProps {
  onGetVersion(noteId: string, versionId: string): Promise<NoteVersion>;
  onGetProvenance?(itemId: string): Promise<KnowledgeProvenance>;
}

type Snapshot = { key: string; version?: NoteVersion; error?: string };

export function KnowledgeSourceComparisonDialog({ item, evidence, onGetVersion, onGetProvenance, onClose, onOpenNote }: DialogProps) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [retry, setRetry] = useState(0);
  const { noteId, noteVersionId } = evidence;
  const requestKey = JSON.stringify([noteId, noteVersionId, retry]);
  const current = snapshot?.key === requestKey ? snapshot : null;
  const canLoadVersion = Boolean(noteId && noteVersionId);

  useEffect(() => {
    if (!noteId || !noteVersionId) return;
    let active = true;
    void Promise.resolve().then(() => active ? onGetVersion(noteId, noteVersionId) : undefined)
      .then(version => {
        if (!active) return;
        if (!version || version.id !== noteVersionId || version.noteId !== noteId || typeof version.content !== 'string') {
          setSnapshot({ key: requestKey, error: '返回的历史版本与来源记录不一致，请重试并核对来源。' });
          return;
        }
        setSnapshot({ key: requestKey, version });
      })
      .catch(error => { if (active) setSnapshot({ key: requestKey, error: sourceVersionError(error) }); });
    return () => { active = false; };
  }, [noteId, noteVersionId, onGetVersion, requestKey]);

  return <Dialog title="来源对照" size="md" isOpen onOpenChange={open => { if (!open) onClose(); }}
    description="对照知识陈述与来源绑定的历史版本，核对依据和适用性。">
    <DialogBody>
      <ExtractionDemoNotice />
      <div className={styles.columns}>
        <section className={styles.section} aria-label="待核对知识">
          <header className={styles.heading}><h3>知识陈述</h3><span>{knowledgeStatusLabel(item.reviewStatus)}</span></header>
          <h4 className={styles.title}>{item.title ? <MathText text={item.title} inlineOnly /> : '未命名知识'}</h4>
          <p className={styles.prose}>{item.canonicalStatement ? <MathText text={item.canonicalStatement} /> : '尚未填写核心陈述'}</p>
          {item.userExplanation ? <><h4 className={styles.label}>我的解释</h4><p className={styles.prose}><MathText text={item.userExplanation} /></p></> : null}
        </section>
        <section className={styles.section} aria-label="保存的来源">
          <header className={styles.heading}><h3>来源依据</h3></header>
          <div className={styles.statuses} aria-label="来源状态">
            <span>{evidenceHealthLabel(evidence.status)}</span>
            <span>{evidenceApplicabilityLabel(evidence.applicabilityStatus)}</span>
            {evidence.sourceAnnotationRemoved ? <span>原标注已移除</span> : null}
          </div>
          {evidence.headingPath?.length ? <p className={styles.path}>{evidence.headingPath.join(' / ')}</p> : null}
          <h4 className={styles.label}>保存的摘录</h4>
          <blockquote className={styles.quote}>{evidence.quoteText ? <MathText text={evidence.quoteText} /> : '该来源没有文字摘录'}</blockquote>
          {evidence.status !== 'valid' || evidence.applicabilityStatus === 'withdrawn' || evidence.applicabilityStatus === 'needsReview' ?
            <p className={styles.hint}>历史内容用于核对依据，来源的健康状态与适用性需要单独核对。</p> : null}
        </section>
      </div>
      {onGetProvenance ? <KnowledgeProvenanceSummary key={JSON.stringify([item.id, item.updatedAt, evidence.id, evidence.updatedAt])}
        itemId={item.id} evidenceId={evidence.id} onRead={onGetProvenance} /> : null}
      <section className={styles.snapshot} aria-label="绑定的历史版本">
        <header className={styles.heading}><h3>绑定的历史版本</h3></header>
        {noteVersionId ? <p className={styles.versionId}>版本 ID：{noteVersionId}</p> : null}
        {!canLoadVersion ? <p className={styles.hint}>{evidence.sourceType === 'manual' ? '手动来源未绑定笔记历史版本，可核对上方保存的摘录。' : '这条来源未关联完整的笔记版本信息，可核对上方保存的摘录。'}</p> :
          !current ? <p role="status" className={styles.hint}>正在加载来源的历史版本…</p> :
          current.error ? <div className={styles.failure}><p role="alert">{current.error}</p><Button variant="ghost" onPress={() => setRetry(value => value + 1)}>重试历史版本</Button></div> :
          current.version ? <>
            <p className={styles.hint}>保存于 <time dateTime={current.version.createdAt}>{new Date(current.version.createdAt).toLocaleString('zh-CN')}</time> · {current.version.content.length.toLocaleString('zh-CN')} 字符</p>
            <pre className={styles.prose} aria-label="历史版本正文">{current.version.content || '（空白版本）'}</pre>
          </> : null}
      </section>
    </DialogBody>
    <DialogFooter>
      <DialogClose variant="ghost">关闭</DialogClose>
      {noteId ? <Button onPress={() => { onClose(); onOpenNote(noteId); }}>打开当前笔记</Button> : null}
    </DialogFooter>
  </Dialog>;
}

function KnowledgeProvenanceSummary({ itemId, evidenceId, onRead }: {
  itemId: string; evidenceId: string; onRead(id: string): Promise<KnowledgeProvenance>;
}) {
  const [result, setResult] = useState<KnowledgeProvenance | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setResult(null); setError(false);
    void Promise.resolve().then(() => active ? onRead(itemId) : undefined).then(value => {
      if (!active) return;
      if (!value || value.artifactId !== itemId) { setError(true); return; }
      setResult(value);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [itemId, onRead, retry]);
  if (result?.state === 'absent') return null;
  const record = result?.state === 'recorded' ? result.record : null;
  const source = record?.sources.find(entry => entry.evidenceId === evidenceId);
  const resolved = result?.sources.find(entry => entry.evidenceId === evidenceId);
  return <section className={styles.snapshot} aria-label="生成来源记录">
    <header className={styles.heading}><h3>生成来源记录</h3></header>
    {error ? <div className={styles.failure}><p role="alert">来源摘要暂时无法读取，尚不能核对生成事实。</p>
      <Button variant="ghost" onPress={() => setRetry(value => value + 1)}>重试来源摘要</Button></div> :
      !result ? <p role="status" className={styles.hint}>正在读取保存的来源摘要…</p> :
      result.state === 'legacy-unavailable' ? <p className={styles.hint}>旧知识未保存可校验的生成来源记录，无法确认原模型、生成版本或精确引用位置。</p> :
      record ? <>
        <p className={styles.hint}>模拟生成记录 · 未调用真实模型。保存于 <time dateTime={record.committedAt}>{new Date(record.committedAt).toLocaleString('zh-CN')}</time>。</p>
        <p className={styles.hint}>原模型标识：{record.modelId}</p>
        {source && resolved ? <>
          <h4 className={styles.label}>生成时的精确摘录</h4><blockquote className={styles.quote}><MathText text={source.quoteText} /></blockquote>
          <p className={styles.versionId}>原始版本：{resolved.originalVersionId}</p>
          {resolved.aliasUsed ? <><p className={styles.versionId}>当前解析版本：{resolved.resolvedVersionId}</p>
            <p className={styles.hint}>同步后的版本标识不同，已核对为同一笔记、相同内容的历史版本。</p></> :
            <p className={styles.hint}>当前来源仍绑定原始版本。</p>}
          <p className={styles.hint}>{resolved.sourceState === 'available' ? '生成来源仍可核对。' :
            resolved.sourceState === 'stale' ? '来源笔记已更新，请复核适用性。' : '来源当前不可用；这里保留生成时的事实。'}</p>
        </> : <p className={styles.hint}>这条来源是后续维护记录，不在原生成引用中。</p>}
      </> : null}
  </section>;
}
