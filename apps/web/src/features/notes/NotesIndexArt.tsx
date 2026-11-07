import { useId, type CSSProperties } from 'react';
import type { Tag } from '@study-accelerator/web-core';
import { tagColorStyle } from '../tags';
import type { IndexItem } from './notesIndexPresentation';
import { notePreview } from './NotesIndexItemMeta';
import styles from './NotesIndexArt.module.css';

/** Decorative paper marks describe no invented content type and expose no extra controls. */
export function NotesIndexArt({
  item,
  tags = [],
  cover = false,
  folderStyle = 'illustrated',
  noteCount = 0
}: {
  item: IndexItem;
  tags?: Tag[];
  cover?: boolean;
  folderStyle?: 'illustrated' | 'paper';
  noteCount?: number;
}) {
  const gradientId = `ni-folder-${useId()}`;
  const folder = item.kind === 'folder';
  const pdf = item.kind === 'note' && item.note.contentKind === 'pdf';
  const text = folder ? '' : notePreview(item.note);
  const color = folder ? 'folder' : tags[0]?.color || 'neutral';
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
  const paperCount = !noteCount ? 0 : noteCount < 3 ? 1 : noteCount < 8 ? 2 : 3;
  return (
    <span
      className={`${styles.art} ${cover && !pdf ? styles.cover : ''}`}
      data-color={color}
      style={folder ? undefined : tagColorStyle(tags[0]?.color, '--art-color')}
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
        <svg className={styles.document} width="54" height="76" viewBox="0 0 58 80" fill="none">
          <path className={styles.paper} d="M5 1h30l18 18v57a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V4a3 3 0 0 1 3-3Z" />
          <path className={styles.fold} d="M35 1v14a4 4 0 0 0 4 4h14Z" />
          {pdf ? (
            <>
              <rect className={styles.pdfBadge} x="8" y="25" width="39" height="13" rx="3" />
              <text className={styles.pdfLabel} x="13" y="35">
                PDF
              </text>
              {[35, 30, 33].map((length, index) => (
                <rect
                  key={index}
                  className={styles.paperLine}
                  x="10"
                  y={46 + index * 7}
                  width={length}
                  height="3"
                  rx="1.5"
                />
              ))}
            </>
          ) : (
            <>
              <path className={styles.noteAccent} d="M38 1h9v19l-4.5-3-4.5 3Z" />
              <rect className={styles.paperTitle} x="10" y="27" width="24" height="4" rx="2" />
              {lengths.map((length, index) => (
                <rect
                  key={index}
                  className={styles.paperLine}
                  x="10"
                  y={37 + index * 7}
                  width={Math.min(index === 4 ? 26 : 35, length)}
                  height="3"
                  rx="1.5"
                />
              ))}
              <circle className={styles.noteAccent} cx="42" cy="66" r="3.5" />
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
