import type { KeyboardEvent, MouseEvent } from 'react';
import type { KnowledgeItem } from '@study-accelerator/web-core';
import { MathText } from '../../components/math/MathText';
import { ChevronDownIcon, KnowledgeIcon } from '../../components/icons/knowra';
import { formatUpdatedAt } from '../notes/notesIndexModel';
import type { KnowledgeProperties, KnowledgeSection, KnowledgeView } from './knowledgeIndexModel';
import { knowledgeStatusLabel, knowledgeTypeLabel } from './knowledgeViewModel';
import styles from './KnowledgeIndex.module.css';

export interface KnowledgeIndexItemHandlers {
  selectedItemId?: string | null;
  disabled: boolean;
  properties: KnowledgeProperties;
  onSelect(id: string): void;
  onOpenMenu(item: KnowledgeItem, point: { x: number; y: number }): void;
}

function statusKey(item: KnowledgeItem) { return item.deletedAt ? 'trash' : item.reviewStatus ?? 'candidate'; }

function StatusTag({ item }: { item: KnowledgeItem }) {
  return <span className={styles.status} data-status={statusKey(item)}><i aria-hidden="true" />{item.deletedAt ? '回收站' : knowledgeStatusLabel(item.reviewStatus)}</span>;
}

function openMenuFromKey(event: KeyboardEvent<HTMLElement>, item: KnowledgeItem, handlers: KnowledgeIndexItemHandlers) {
  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
  event.preventDefault();
  const rect = event.currentTarget.getBoundingClientRect();
  handlers.onOpenMenu(item, { x: rect.left + 24, y: rect.bottom - 8 });
}

function KnowledgeEntry({ item, view, ...handlers }: { item: KnowledgeItem; view: KnowledgeView } & KnowledgeIndexItemHandlers) {
  const { properties } = handlers;
  const title = item.title ? <MathText text={item.title} inlineOnly /> : '未命名知识';
  const statement = item.canonicalStatement ? <MathText text={item.canonicalStatement} inlineOnly /> : '尚未填写核心陈述';
  const onContextMenu = (event: MouseEvent) => { event.preventDefault(); handlers.onOpenMenu(item, { x: event.clientX, y: event.clientY }); };
  return <li className={view === 'card' ? styles.cardItem : styles.rowItem} data-entry-item data-entry-key={item.id}>
    <button type="button" className={view === 'card' ? styles.card : styles.row} aria-current={handlers.selectedItemId === item.id ? 'true' : undefined}
      disabled={handlers.disabled} onClick={() => handlers.onSelect(item.id)} onContextMenu={onContextMenu} onKeyDown={event => openMenuFromKey(event, item, handlers)}>
      {view === 'card' ? <>
        <span className={styles.cardTop}>{properties.status ? <StatusTag item={item} /> : <span />}{properties.type ? <span className={styles.type}>{knowledgeTypeLabel(item.knowledgeType)}</span> : null}</span>
        <strong className={styles.cardTitle}>{title}</strong>
        {properties.statement ? <span className={styles.cardStatement}>{statement}</span> : null}
        {properties.updated ? <small className={styles.updated}>{formatUpdatedAt(item.updatedAt)}</small> : null}
      </> : <>
        <span className={styles.entryIcon} aria-hidden="true"><KnowledgeIcon size={16} /></span>
        <span className={styles.rowText}><strong>{title}</strong>{properties.statement ? <span className={styles.rowStatement}>{statement}</span> : null}</span>
        {properties.type ? <span className={styles.type}>{knowledgeTypeLabel(item.knowledgeType)}</span> : null}
        {properties.status ? <StatusTag item={item} /> : null}
        {properties.updated ? <small className={styles.updated}>{formatUpdatedAt(item.updatedAt)}</small> : null}
      </>}
    </button>
  </li>;
}

export function KnowledgeIndexSections({ sections, view, showHeadings, collapsed, onToggle, ...handlers }: {
  sections: KnowledgeSection[]; view: KnowledgeView; showHeadings: boolean; collapsed: ReadonlySet<string>; onToggle(id: string): void;
} & KnowledgeIndexItemHandlers) {
  return <>{sections.map(section => <section key={section.id} aria-label={section.label}>
    {showHeadings ? <button type="button" className={styles.groupHeading} aria-expanded={!collapsed.has(section.id)} onClick={() => onToggle(section.id)}>
      <ChevronDownIcon size={13} /><strong>{section.label}</strong><span>{section.items.length}</span>
    </button> : null}
    {!collapsed.has(section.id) ? <ul className={view === 'card' ? styles.cardGrid : styles.rows} aria-label={view === 'card' ? '知识卡片视图' : '知识列表视图'}>
      {section.items.map(item => <KnowledgeEntry key={item.id} item={item} view={view} {...handlers} />)}
    </ul> : null}
  </section>)}</>;
}

/** 列表快捷键：J/K 在条目间移动焦点，Enter 沿用按钮自身的“查看”。 */
export function handleKnowledgeListKeys(event: KeyboardEvent<HTMLElement>) {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
  const target = event.target as Element;
  if (target.closest('input, textarea, select, [contenteditable="true"], [role="menu"], [role="dialog"]')) return;
  const entry = target.closest<HTMLElement>('[data-entry-item]');
  const key = event.key.toLowerCase();
  if (key !== 'j' && key !== 'k') return;
  const entries = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-entry-item]'));
  event.preventDefault();
  const index = entry ? entries.indexOf(entry) : -1;
  const next = entries[index < 0 ? 0 : index + (key === 'j' ? 1 : -1)];
  next?.querySelector<HTMLElement>('button:not([disabled])')?.focus();
}
