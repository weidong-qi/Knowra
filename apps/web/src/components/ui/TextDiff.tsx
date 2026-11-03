import { useMemo, useState } from 'react';
import { downloadTextFile } from '../../browser/downloadFile';
import { Button } from './button';
import { buildTextDiff, collapseUnchanged } from './textDiffModel';
import styles from './TextDiff.module.css';

interface TextDiffProps { before: string; after: string; beforeLabel?: string; afterLabel?: string }

export function TextDiff({ before, after, beforeLabel = '原正文', afterLabel = '新正文' }: TextDiffProps) {
  const [showAll, setShowAll] = useState(false);
  const diff = useMemo(() => buildTextDiff(before, after), [before, after]);
  const rows = useMemo(() => showAll ? diff.lines.map(line => ({ line })) : collapseUnchanged(diff.lines), [diff, showAll]);
  const changed = diff.lines.some(line => line.kind !== 'same');
  const visibleRows = rows.slice(0, 500);
  const hasHidden = rows.length > visibleRows.length;
  return <section className={styles.diff} aria-label={`${beforeLabel}与${afterLabel}的正文差异`}>
    <div className={styles.legend}><span className={styles.removed}>− {beforeLabel}独有</span><span className={styles.added}>+ {afterLabel}独有</span><span>未变内容不着色</span></div>
    {(!changed && !diff.limited) && <p className={styles.hint}>正文一致</p>}
    {diff.simplified && <p className={styles.hint}>改动较多，已按连续文本块显示增删。</p>}
    {(diff.limited || hasHidden) && <p className={styles.notice}>正文较长，当前仅展示部分对比；未显示的内容仍可能存在差异。可下载双方完整正文核对。</p>}
    <div className={styles.lines} tabIndex={0} aria-label="正文差异内容">
      {visibleRows.map((row, index) => 'omitted' in row
        ? <div className={styles.omitted} key={index}>… {row.omitted} 行未变化 …</div>
        : <div className={`${styles.line} ${styles[row.line.kind] ?? ''}`} key={index} data-diff={row.line.kind}>
          <span className={styles.number} aria-hidden="true">{row.line.beforeLine ?? '·'}</span>
          <span className={styles.number} aria-hidden="true">{row.line.afterLine ?? '·'}</span>
          <span className={styles.marker} aria-label={row.line.kind === 'removed' ? '原文独有' : row.line.kind === 'added' ? '新文独有' : '未变化'}>{row.line.kind === 'removed' ? '−' : row.line.kind === 'added' ? '+' : ' '}</span>
          <code>{row.line.text || '\u00a0'}</code>
        </div>)}
    </div>
    <div className={styles.actions}>
      {diff.lines.length > 8 && <Button onPress={() => setShowAll(value => !value)}>{showAll ? '折叠未变内容' : '展开未变内容'}</Button>}
      {(diff.limited || hasHidden) && <><Button onPress={() => downloadTextFile(`${beforeLabel}.md`, before, 'text/markdown')}>下载{beforeLabel}正文</Button><Button onPress={() => downloadTextFile(`${afterLabel}.md`, after, 'text/markdown')}>下载{afterLabel}正文</Button></>}
    </div>
  </section>;
}
