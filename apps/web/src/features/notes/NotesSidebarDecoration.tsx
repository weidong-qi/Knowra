import styles from './NotesContextSidebar.module.css';

export function NotesTrashDecoration({ full }: { full: boolean }) {
  return (
    <svg
      className={styles.trashIcon}
      data-full={full || undefined}
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <g className={styles.trashLid}>
        <path d="M3 6h18M9 6V3h6v3" />
      </g>
      <path d="M19 6l-1 14H6L5 6" />
      {full ? <path className={styles.trashScrap} d="m9.6 8.2 1.4 1.6m2.6-2.2.9 2" /> : null}
    </svg>
  );
}

/** 笔记库：三本并排的书脊，线性单色，与文件夹、笔记图标同一线宽。 */
export function NotesLibraryDecoration() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4.5 4.5h4.2v15H4.5Z" />
      <path d="M10.8 4.5H15v15h-4.2Z" />
      <path d="m16.9 5.9 3.9-.9 2.6 14.2-3.9.9Z" transform="translate(-2.2 0)" />
    </svg>
  );
}
