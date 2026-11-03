import { MathText } from '../../components/math/MathText';
import { useEffect, useState } from 'react';
import { Button, Dialog, DialogBody, DialogClose, DialogFooter } from '../../components/ui';
import { sourceStatusLabel, sourceTypeLabel, type QuestionSource } from './questionDetailModel';
import type { QuestionSourceContent } from './questionSourceModel';
import styles from './QuestionDetailPanel.module.css';

export function QuestionSourceComparison({ source, onLoad, onClose, onOpenNote, onOpenKnowledge }: {
  source: QuestionSource; onLoad(source: QuestionSource): Promise<QuestionSourceContent>; onClose(): void;
  onOpenNote(id: string): void; onOpenKnowledge(id: string): void;
}) {
  const [content, setContent] = useState<QuestionSourceContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setContent(null); setError('');
    void onLoad(source).then(value => { if (active) setContent(value); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : '来源读取失败，请重试。'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [source, onLoad, generation]);
  return <Dialog title="题目来源对照" size="md" isOpen onOpenChange={open => { if (!open) onClose(); }} description="核对保存的依据与关联内容；来源变化后的题目需人工复核。">
    <DialogBody>
      <div className={styles.meta}><strong>{sourceTypeLabel(source.sourceType)}</strong><span>{sourceStatusLabel(source.status)}</span></div>
      <div className={styles.comparison}>
        <section aria-label="编题时保存的摘录"><h3>编题时保存的摘录</h3><blockquote className={styles.prose}>{source.quote ? <MathText text={source.quote} /> : '该来源未保存文字摘录。'}</blockquote></section>
        <section aria-label="来源内容"><h3>{content?.contentLabel || '关联来源内容'}</h3>
          {loading ? <p role="status" className={styles.hint}>正在读取来源…</p> : null}
          {error ? <><p role="alert" className={styles.error}>{error}</p><Button size="compact" onPress={() => setGeneration(value => value + 1)}>重新读取来源</Button></> : null}
          {content ? <><p className={styles.meta}>{content.title}</p><pre className={styles.prose}>{content.content || '该来源内容为空。'}</pre></> : null}
        </section>
      </div>
      {content?.notice ? <p className={styles.notice}>{content.notice}</p> : null}
    </DialogBody>
    <DialogFooter>
      {content?.noteId ? <Button variant="ghost" onPress={() => onOpenNote(content.noteId!)}>打开当前笔记</Button> : null}
      {content?.knowledgeItemId ? <Button variant="ghost" onPress={() => onOpenKnowledge(content.knowledgeItemId!)}>查看关联知识</Button> : null}
      <DialogClose variant="primary">关闭</DialogClose>
    </DialogFooter>
  </Dialog>;
}
