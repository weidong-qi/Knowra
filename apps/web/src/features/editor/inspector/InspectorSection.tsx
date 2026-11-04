import type { ReactNode, MouseEvent } from 'react';
import type { Note } from '@study-accelerator/web-core';
import { NoteIcon } from '../../../components/icons/knowra';
import styles from '../EditorInspector.module.css';

export function InspectorSection({ icon, title, count, action, emptyHint, children }: {
  icon: ReactNode;
  title: string;
  count?: number;
  action?: ReactNode;
  /** 提供后，区块折叠成一行：图标、标题、提示与操作；不渲染 children。 */
  emptyHint?: string;
  children?: ReactNode;
}) {
  if (emptyHint !== undefined) {
    return <section className={`${styles.section} ${styles.sectionEmpty}`}>
      <h3>{icon}<span>{title}</span><em>{emptyHint}</em>{action}</h3>
    </section>;
  }
  return <section className={styles.section}>
    <h3>{icon}<span>{title}</span>{count !== undefined ? <small>{count}</small> : null}{action}</h3>
    {children}
  </section>;
}

export function Metadata({ label, value }: { label: string; value: ReactNode }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

export function NoteLinks({ notes, onOpenNote, empty }: {
  notes: Note[];
  onOpenNote(noteId: string): void;
  empty: string;
}) {
  if (notes.length === 0) return <p className={styles.emptyInline}>{empty}</p>;
  return <div className={styles.noteLinks}>{notes.map((note) => (
    <a
      key={note.id}
      href={`#/materials/notes/${encodeURIComponent(note.id)}`}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onOpenNote(note.id);
      }}
    >
      <NoteIcon size={16} /><span>{note.title || '无标题笔记'}</span>
    </a>
  ))}</div>;
}
