import { useEffect, useRef, useState } from 'react';
import type { AnalysisScopeInput, AnalysisScopePreview } from '@study-accelerator/web-core';
import { Button, Dialog, DialogBody, DialogClose, DialogFooter } from '../../components/ui';
import { ExtractionDemoNotice, useExtractionEnvironment } from './ExtractionEnvironment';
import styles from './KnowledgeExtraction.module.css';

export interface AnalysisIntent { input: AnalysisScopeInput; preview: AnalysisScopePreview; scopeKey: string; taskKey: string }
export function AnalysisScopeDialog({ analysis, onSave, onSaved, onStart, onClose, startDisabledReason }: {
  analysis: AnalysisIntent;
  onSave?(input: AnalysisScopeInput & { previewHash: string; idempotencyKey: string }): Promise<{ id: string }>;
  onSaved(): void;
  onStart(input: { scopeId: string; taskKey: string }): void;
  onClose(): void;
  startDisabledReason?: string;
}) {
  const { capability } = useExtractionEnvironment();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [savedId, setSavedId] = useState<string | null>(null);
  const saved = useRef<string | null>(null);
  const active = useRef(true);
  const busy = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  function close() { active.current = false; onClose(); }
  async function save(start: boolean) {
    if (!onSave || busy.current) return;
    busy.current = true; setPending(true); setError('');
    try {
      if (!saved.current) {
        const result = await onSave({ ...analysis.input, previewHash: analysis.preview.previewHash, idempotencyKey: analysis.scopeKey });
        saved.current = result.id;
        if (active.current) { setSavedId(result.id); onSaved(); }
      }
      if (active.current && start) onStart({ scopeId: saved.current!, taskKey: analysis.taskKey });
      else if (active.current) close();
    } catch { if (active.current) setError('范围保存未完成。若内容已变化，请关闭后重新预览；再次保存将沿用同一范围请求。'); }
    finally { busy.current = false; if (active.current) setPending(false); }
  }
  return <Dialog title="确认分析范围" description="这是已保存版本的固定范围；后续编辑不会悄悄替换来源。" size="md" isOpen onOpenChange={open => { if (!open) close(); }}>
    <DialogBody><div className={styles.body}>
      <ExtractionDemoNotice />
      <strong>{analysis.preview.summary.noteCount} 篇笔记 · {analysis.preview.summary.segmentCount} 个去重片段</strong>
      {analysis.preview.segments.map((segment, index) => <pre key={`${segment.noteId}-${segment.start}`}>{index + 1}. {segment.markdown}</pre>)}
      <section aria-label="分析排除范围">
        <p>已排除 {analysis.preview.exclusions?.length ?? 0} 个局部范围。</p>
        {analysis.preview.exclusions?.length ? <ul>{analysis.preview.exclusions.map((item, index) => <li key={index}>
          {analysis.preview.noteVersions?.find(note => note.noteId === item.noteId)?.title || '所选笔记'}：局部排除 {Math.max(0, item.end - item.start)} 个字符
        </li>)}</ul> : null}
      </section>
      {analysis.preview.omittedItems.length ? <section aria-label="分析遗漏提示">
        <p>{analysis.preview.omittedItems.length} 项未纳入，请在开始前检查。</p>
        <ul>{analysis.preview.omittedItems.map((item, index) => <li key={index}>{omissionReason(item.reason)}</li>)}</ul>
      </section> : null}
      <p role="status">{!onSave ? '当前资料库无法保存分析范围，请恢复连接后重试。' : capability.canStart
        ? '此处只运行模拟流程；候选仍需人工核对和确认。' : '知识提炼暂不可用；仍可保存分析范围和手动整理知识。'}</p>
      {!capability.canStart ? <p className={styles.muted}>提炼服务暂不可用；仍可保存不可变范围快照。</p> : null}
      {savedId ? <p role="status">范围快照已保存，尚未启动新任务。</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {startDisabledReason ? <p role="status">{startDisabledReason}</p> : null}
    </div></DialogBody>
    <DialogFooter className={styles.actions}><DialogClose variant="ghost">关闭</DialogClose>
      <Button isDisabled={!onSave || pending || Boolean(savedId)} onPress={() => void save(false)}>保存范围快照</Button>
      {capability.canStart && capability.executionMode === 'mock' ? <Button variant="primary" isDisabled={!onSave || pending || Boolean(startDisabledReason)} onPress={() => void save(true)}>开始提炼</Button> : null}
    </DialogFooter>
  </Dialog>;
}

function omissionReason(reason: unknown) {
  if (reason === 'imageUnreadable') return '图片内容未读取；请自行核对图片中的信息。';
  if (reason === 'legacyUnverified') return '旧标注范围尚未确认，请先核对原文。';
  if (reason === 'sourceDeleted' || reason === 'sectionDeleted') return '原文或章节已删除，无法纳入。';
  if (reason === 'ambiguousMatch') return '原文存在多个匹配位置，请先确认范围。';
  return '原文内容或范围已变化，需重新核对后纳入。';
}
