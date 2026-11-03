import { useSyncExternalStore } from 'react';
import type { KnowledgeItem } from '@study-accelerator/web-core';
import { KNOWLEDGE_STATUS_LABELS, knowledgeStatusLabel, knowledgeTypeLabel } from './knowledgeViewModel';

export type KnowledgeView = 'list' | 'card';
export type KnowledgeGroup = 'status' | 'type' | 'updated' | 'none';
export type KnowledgeSort = 'updated-desc' | 'updated-asc' | 'name-asc';
export interface KnowledgeProperties { statement: boolean; type: boolean; status: boolean; updated: boolean }
export interface KnowledgeDisplay { view: KnowledgeView; group: KnowledgeGroup; sort: KnowledgeSort; properties: KnowledgeProperties }
export interface KnowledgeSection { id: string; label: string; items: KnowledgeItem[] }

export const KNOWLEDGE_DISPLAY_KEY = 'knowra:knowledge-index-display:v1';
export const DEFAULT_KNOWLEDGE_DISPLAY: Readonly<KnowledgeDisplay> = {
  view: 'list', group: 'status', sort: 'updated-desc', properties: { statement: true, type: true, status: true, updated: true }
};

const VIEWS: readonly KnowledgeView[] = ['list', 'card'];
const GROUPS: readonly KnowledgeGroup[] = ['status', 'type', 'updated', 'none'];
const SORTS: readonly KnowledgeSort[] = ['updated-desc', 'updated-asc', 'name-asc'];
const STATUS_ORDER = ['candidate', 'needsRevision', 'confirmed', 'archived'] as const;

export function parseKnowledgeDisplay(value: unknown): KnowledgeDisplay {
  const input = value && typeof value === 'object' ? value as Partial<KnowledgeDisplay> : {};
  const properties: Partial<KnowledgeProperties> = input.properties && typeof input.properties === 'object' ? input.properties : {};
  const flag = (key: keyof KnowledgeProperties) => typeof properties[key] === 'boolean' ? properties[key] as boolean : DEFAULT_KNOWLEDGE_DISPLAY.properties[key];
  return {
    view: VIEWS.find(item => item === input.view) ?? DEFAULT_KNOWLEDGE_DISPLAY.view,
    group: GROUPS.find(item => item === input.group) ?? DEFAULT_KNOWLEDGE_DISPLAY.group,
    sort: SORTS.find(item => item === input.sort) ?? DEFAULT_KNOWLEDGE_DISPLAY.sort,
    properties: { statement: flag('statement'), type: flag('type'), status: flag('status'), updated: flag('updated') }
  };
}

function readDisplay(): KnowledgeDisplay {
  try { return parseKnowledgeDisplay(JSON.parse(localStorage.getItem(KNOWLEDGE_DISPLAY_KEY) ?? 'null')); }
  catch { return parseKnowledgeDisplay(null); }
}

const listeners = new Set<() => void>();
let snapshot = readDisplay();

export function setKnowledgeDisplay(patch: Partial<Omit<KnowledgeDisplay, 'properties'>> & { properties?: Partial<KnowledgeProperties> }) {
  snapshot = parseKnowledgeDisplay({ ...snapshot, ...patch, properties: { ...snapshot.properties, ...patch.properties } });
  try { localStorage.setItem(KNOWLEDGE_DISPLAY_KEY, JSON.stringify(snapshot)); } catch { /* 无存储权限时仅保留本次会话。 */ }
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

export function useKnowledgeDisplay() {
  return useSyncExternalStore(subscribe, () => snapshot, () => DEFAULT_KNOWLEDGE_DISPLAY);
}

export function sortKnowledge(items: KnowledgeItem[], sort: KnowledgeSort) {
  const byName = (a: KnowledgeItem, b: KnowledgeItem) => (a.title || '').localeCompare(b.title || '', 'zh-CN');
  const byUpdated = (a: KnowledgeItem, b: KnowledgeItem) => (a.updatedAt ?? '').localeCompare(b.updatedAt ?? '');
  return [...items].sort(sort === 'name-asc' ? byName : sort === 'updated-asc' ? (a, b) => byUpdated(a, b) || byName(a, b) : (a, b) => byUpdated(b, a) || byName(a, b));
}

function updatedBucket(value: string | undefined, now: number): { id: string; label: string; rank: number } {
  const time = value ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(time)) return { id: 'older', label: '更早', rank: 3 };
  const days = (now - time) / 86_400_000;
  if (days < 1) return { id: 'today', label: '今天', rank: 0 };
  if (days < 7) return { id: 'week', label: '近 7 天', rank: 1 };
  if (days < 30) return { id: 'month', label: '近 30 天', rank: 2 };
  return { id: 'older', label: '更早', rank: 3 };
}

/** 分组保持传入顺序（已按排序处理）；空分组不出现。回收站条目统一归入“回收站”。 */
export function groupKnowledge(items: KnowledgeItem[], group: KnowledgeGroup, now = Date.now()): KnowledgeSection[] {
  if (!items.length) return [];
  if (group === 'none') return [{ id: 'all', label: '全部', items }];
  const sections = new Map<string, KnowledgeSection & { rank: number }>();
  for (const item of items) {
    let id: string; let label: string; let rank: number;
    if (item.deletedAt) { id = 'trash'; label = '回收站'; rank = 99; }
    else if (group === 'status') {
      const status = item.reviewStatus ?? 'candidate';
      id = status; label = knowledgeStatusLabel(status);
      rank = Math.max(0, (STATUS_ORDER as readonly string[]).indexOf(status));
    } else if (group === 'type') { id = item.knowledgeType; label = knowledgeTypeLabel(item.knowledgeType); rank = 0; }
    else { const bucket = updatedBucket(item.updatedAt, now); id = bucket.id; label = bucket.label; rank = bucket.rank; }
    const section = sections.get(id) ?? { id, label, items: [], rank };
    section.items.push(item); sections.set(id, section);
  }
  const ordered = [...sections.values()];
  if (group !== 'type') ordered.sort((a, b) => a.rank - b.rank);
  return ordered.map(({ rank: _rank, ...section }) => section);
}

export const KNOWLEDGE_FILTER_OPTIONS: readonly [string, string][] = [
  ['all', '全部未归档'], ...Object.entries(KNOWLEDGE_STATUS_LABELS), ['trash', '回收站']
];
