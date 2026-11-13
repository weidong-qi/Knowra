import { useId, type CSSProperties } from 'react';
import type { Tag } from '@study-accelerator/web-core';
import { tagColorStyle } from '../tags';
import { normalizeTagColor } from '../tags/tagColor';
import type { IndexItem } from './notesIndexPresentation';
import { notePreview } from './NotesIndexItemMeta';
import { useNotesIndexAppearance, type DocumentIconStyle } from './notesIndexAppearanceModel';
import styles from './NotesIndexArt.module.css';

const DOCUMENT_LINES = [
  { y: 44, width: 38, opacity: 0.8 },
  { y: 51, width: 32, opacity: 0.55 },
  { y: 58, width: 38, opacity: 0.35 },
  { y: 65, width: 22, opacity: 0.18 }
] as const;

/** Decorative paper marks describe no invented content type and expose no extra controls. */
export function NotesIndexArt({
  item,
  tags = [],
  cover = false,
  folderStyle = 'illustrated',
  noteCount = 0,
  documentStyle
}: {
  item: IndexItem;
  tags?: Tag[];
  cover?: boolean;
  folderStyle?: 'illustrated' | 'paper';
  noteCount?: number;
  documentStyle?: DocumentIconStyle;
}) {
  const appearance = useNotesIndexAppearance();
  const effectiveDocumentStyle = documentStyle ?? appearance.documentIconStyle;
  const gradientId = `ni-folder-${useId()}`;
  const badgeGradientId = `ni-badge-${useId().replace(/:/g, '')}`;
  const folder = item.kind === 'folder';
  const pdf = item.kind === 'note' && item.note.contentKind === 'pdf';
  const text = folder ? '' : notePreview(item.note);
  const tagColor = tags[0]?.color;
  const hasTagColor = !folder && Boolean(tagColor) && normalizeTagColor(tagColor) !== 'neutral';
  const color = folder ? 'folder' : hasTagColor ? tagColor : 'neutral';
  const lengths = text
    ? text
        .match(/.{1,28}/g)
        ?.slice(0, 5)
        .map(line => 12 + line.length) || []
    : [34, 28, 38, 25];
  if (folder && folderStyle === 'paper')
    return (
      <span
        className={`${styles.art} ${styles.cover}`}
        data-color="folder"
        data-art-kind="folder"
        data-folder-style="paper"
        aria-hidden="true"
      >
        {noteCount > 0 ? <span className={styles.folderPeek} /> : null}
        <span className={styles.folderSheet}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false">
            <path d="M0 10a8 8 0 0 1 8-8h30l8 10h46a8 8 0 0 1 8 8V100H0Z" />
          </svg>
          <span className={styles.folderSheetLines}>
            <i />
            <i style={{ width: '90%' }} />
            <i style={{ width: '70%' }} />
          </span>
        </span>
      </span>
    );
  if (pdf && cover)
    return (
      <span
        className={`${styles.art} ${styles.cover}`}
        data-color="pdf"
        data-art-kind="pdf"
        data-pdf-style="stack"
        aria-hidden="true"
      >
        <span className={styles.pdfMark}>PDF</span>
        <span className={styles.pdfPages}>
          {[false, true, false].map((front, index) => (
            <span key={index} className={styles.pdfPageShadow}>
              <span className={styles.pdfPage}>
                {front ? (
                  <>
                    <em>PDF</em>
                    <i style={{ width: '88%' }} />
                    <i style={{ width: '70%' }} />
                    <b />
                    <i style={{ width: '80%' }} />
                  </>
                ) : (
                  <>
                    <i style={{ width: '60%' }} />
                    <i style={{ width: '88%' }} />
                    <i style={{ width: '74%' }} />
                    <b />
                  </>
                )}
              </span>
            </span>
          ))}
        </span>
      </span>
    );
  const paperCount = !noteCount ? 0 : noteCount < 3 ? 1 : noteCount < 8 ? 2 : 3;
  return (
    <span
      className={`${styles.art} ${cover && !pdf ? styles.cover : ''}`}
      data-color={color}
      data-has-tag-color={hasTagColor ? 'true' : undefined}
      style={hasTagColor || (!folder && !cover) ? tagColorStyle(tagColor, '--art-color') : undefined}
      data-art-kind={folder ? 'folder' : pdf ? 'pdf' : 'document'}
      data-folder-style={folder ? 'illustrated' : undefined}
      aria-hidden="true"
    >
      {folder ? (
        <svg className={styles.folder} width="84" height="70" viewBox="0 0 72 60" fill="none">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" className={styles.folderStart} />
              <stop offset="100%" className={styles.folderEnd} />
            </linearGradient>
          </defs>
          <path
            className={styles.folderBack}
            d="M6 9a5 5 0 0 1 5-5h16l6 6h28a5 5 0 0 1 5 5v33a5 5 0 0 1-5 5H11a5 5 0 0 1-5-5Z"
          />
          {[
            [13, 10, -5],
            [19, 7, 3],
            [25, 9, -1]
          ]
            .slice(0, paperCount)
            .map(([x, y, angle], index) => (
              <g key={index} data-folder-paper transform={`rotate(${angle} ${x + 17} ${y + 14})`}>
                <rect className={styles.folderPaper} x={x} y={y} width="34" height="28" rx="2.5" />
                <rect
                  className={styles.folderPaperLine}
                  x={x + 5}
                  y={y + 4.5}
                  width={14 - index * 2}
                  height="1.8"
                  rx=".9"
                />
              </g>
            ))}
          <path
            className={styles.folderFront}
            fill={`url(#${gradientId})`}
            d="M6 21a5 5 0 0 1 5-5h50a5 5 0 0 1 5 5v28a5 5 0 0 1-5 5H11a5 5 0 0 1-5-5Z"
          />
          <path className={styles.folderEdge} d="M11.5 17.3h49" />
        </svg>
      ) : (
        <svg
          className={styles.document}
          width="54"
          height="76"
          viewBox="0 0 58 80"
          fill="none"
          data-document-style={effectiveDocumentStyle}
        >
          <path className={styles.paper} d="M6 3h30l16 16v54a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4Z" />
          <path className={pdf ? styles.pdfFold : styles.noteFold} d="M36 3v12a4 4 0 0 0 4 4h12Z" />
          {effectiveDocumentStyle === 'capsule' ? (
            <>
              <defs>
                {pdf ? (
                  <linearGradient id={badgeGradientId} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#ef4444" />
                    <stop offset="100%" stopColor="#b91c1c" />
                  </linearGradient>
                ) : (
                  <linearGradient id={badgeGradientId} x1="0" y1="0" x2="1" y2="1">
                    <stop className={styles.noteBadgeStart} offset="0%" stopColor="var(--note-accent)" />
                    <stop className={styles.noteBadgeEnd} offset="100%" stopColor="var(--note-accent-dark)" />
                  </linearGradient>
                )}
              </defs>
              {pdf ? (
                <>
                  <rect x="10" y="22" width="38" height="14.5" rx="3.5" fill={`url(#${badgeGradientId})`} />
                  <text className={styles.pdfLabel} x="29" y="32" dominantBaseline="middle" textAnchor="middle">
                    PDF
                  </text>
                </>
              ) : (
                <>
                  <rect x="10" y="22" width="38" height="14.5" rx="3.5" fill={`url(#${badgeGradientId})`} />
                  <text className={styles.noteBadgeLabel} x="29" y="32" dominantBaseline="middle" textAnchor="middle">
                    NOTE
                  </text>
                </>
              )}
              {DOCUMENT_LINES.map((line, index) => (
                <rect
                  key={index}
                  className={pdf ? styles.pdfLine : styles.noteLine}
                  x="10"
                  y={line.y}
                  width={line.width}
                  height="2.5"
                  rx="1.25"
                  opacity={line.opacity}
                />
              ))}
            </>
          ) : (
            <>
              {pdf ? (
                <>
                  <rect className={styles.pdfBadgeSmall} x="10" y="10" width="22" height="8.5" rx="2" />
                  <text className={styles.pdfLabelSmall} x="21" y="15.5" dominantBaseline="middle" textAnchor="middle">
                    PDF
                  </text>
                  <rect className={styles.pdfTitle} x="10" y="25" width="26" height="3" rx="1.5" />
                  {[16, 16, 13, 16, 16, 11].map((length, index) => (
                    <rect
                      key={`left-${index}`}
                      className={styles.paperLine}
                      x="10"
                      y={33 + index * 5}
                      width={length}
                      height="2.2"
                      rx="1.1"
                    />
                  ))}
                  {[16, 16, 16, 16, 12, 16].map((length, index) => (
                    <rect
                      key={`right-${index}`}
                      className={styles.paperLine}
                      x="32"
                      y={33 + index * 5}
                      width={length}
                      height="2.2"
                      rx="1.1"
                    />
                  ))}
                  <line className={styles.pdfDivider} x1="10" y1="66" x2="48" y2="66" />
                </>
              ) : (
                <>
                  <rect className={styles.noteBadgeSmall} x="10" y="10" width="22" height="8.5" rx="2" />
                  <text
                    className={styles.noteBadgeLabelSmall}
                    x="21"
                    y="15.5"
                    dominantBaseline="middle"
                    textAnchor="middle"
                  >
                    NOTE
                  </text>
                  <rect className={styles.paperTitle} x="10" y="25" width="26" height="3" rx="1.5" />
                  <circle className={styles.noteBullet} cx="12.5" cy="35" r="1.5" />
                  <rect className={styles.paperLine} x="17" y="33.8" width="31" height="2.4" rx="1.2" />
                  <circle className={styles.noteBullet} cx="12.5" cy="43" r="1.5" />
                  <rect className={styles.paperLine} x="17" y="41.8" width="31" height="2.4" rx="1.2" />
                  <circle className={styles.noteBulletMuted} cx="12.5" cy="51" r="1.5" />
                  <rect className={styles.paperLine} x="17" y="49.8" width="24" height="2.4" rx="1.2" />
                  <rect className={styles.paperLine} x="10" y="58" width="38" height="2.4" rx="1.2" />
                  <rect className={styles.paperLine} x="10" y="65" width="20" height="2.4" rx="1.2" />
                </>
              )}
            </>
          )}
        </svg>
      )}
      {cover && !folder && !pdf ? (
        <span className={styles.sheet}>
          <span className={styles.sheetTitle} />
          {lengths.map((length, index) => (
            <span
              key={index}
              className={styles.sheetLine}
              style={{ '--line-width': `${length * 2}%` } as CSSProperties}
            />
          ))}
        </span>
      ) : null}
    </span>
  );
}
