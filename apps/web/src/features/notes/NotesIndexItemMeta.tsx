import type { Note, Tag } from '@study-accelerator/web-core';
import { StarIcon } from '../../components/icons/knowra';
import { TagChip } from '../tags';
import { splitMath } from '../../components/math/splitMath';
import { statusClassName } from './notesIndexPresentation';
import styles from './NotesIndexItems.module.css';

/** A bounded, plain-text preview. Never interpret user-authored HTML or Markdown here. */
export function notePreview(note: Note): string {
  const source = typeof note.summary === 'string' && note.summary.trim()
    ? note.summary : note.plainText || note.rawMarkdown || '';
  return clipPreview(stripMarkdown(source.slice(0, 4000)), 200);
}

const PLACEHOLDER = '\u0000';

/** 去掉 Markdown 符号；公式先换成占位符，避免 `x_i`、`a*b` 里的符号被当作排版标记吞掉。 */
function stripMarkdown(source: string): string {
  const formulas: string[] = [];
  const protectedText = splitMath(source).map(segment => {
    if (segment.type === 'text') return segment.value.replace(/\u0000/g, '');
    formulas.push(segment.source.replace(/\s+/g, ' ').trim());
    return `${PLACEHOLDER}${formulas.length - 1}${PLACEHOLDER}`;
  }).join('');
  return protectedText
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+(?:\[[ xX]\]\s*)?)/gm, '')
    .replace(/[`*_~]/g, '').replace(/\s+/g, ' ').trim()
    .replace(/\u0000(\d+)\u0000/g, (_, index: string) => { const body = formulas[Number(index)] ?? ''; return body.includes('$') ? `\\(${body}\\)` : `$${body}$`; });
}

/** 按字符截断，但不把公式从中间切开：放不下的整条公式直接舍弃。 */
function clipPreview(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let out = '';
  for (const segment of splitMath(text)) {
    const piece = segment.type === 'text' ? segment.value : segment.raw;
    if (out.length + piece.length <= limit) { out += piece; continue; }
    if (segment.type === 'text') out += piece.slice(0, limit - out.length);
    break;
  }
  return out.trimEnd();
}

export function itemTags(note: Note, tags: Tag[]): Tag[] {
  const ids = new Set(note.tagIds);
  return tags.filter(tag => ids.has(tag.id));
}

export function ItemTags({ tags, dots = false, limit = 2 }: { tags: Tag[]; dots?: boolean; limit?: number }) {
  if (!tags.length) return null;
  return <span className={styles.tags} data-dots={dots || undefined} title={tags.map(tag => tag.name || '未命名标签').join('、')}>
    {tags.slice(0, dots ? 4 : limit).map(tag => <TagChip key={tag.id} tag={tag} className={styles.tagChip} />)}
    {!dots && tags.length > limit ? <span className={styles.tagMore}>+{tags.length - limit}</span> : null}
  </span>;
}

/** 状态图标：圆环 + 状态符号；颜色由外层状态类提供。 */
export function StatusGlyph({ status, size = 13 }: { status: string; size?: number }) {
  return <svg className={styles.statusGlyph} width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="5.5" />
    {/完成/.test(status) ? <path d="m5 8 2 2 4-4" /> : /草稿|待整理|文稿/.test(status) ? null : <path d="M8 4.5V8l2 1.5" />}
  </svg>;
}

export function ItemStatus({ status, compact = false }: { status: string; compact?: boolean }) {
  return <span className={`${styles.status} ${statusClassName(status)}`} title={status}>
    <StatusGlyph status={status} />
    <span className={compact ? styles.srOnly : undefined}>{status}</span>
  </span>;
}

export function ItemFavorite() {
  return <span className={styles.favorite} title="已收藏" aria-label="已收藏"><StarIcon size={13} /></span>;
}
