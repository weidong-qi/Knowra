import { useSyncExternalStore } from 'react';
export interface ConceptDisplay {
  view: 'list' | 'card';
  sort: 'updated-desc' | 'updated-asc' | 'name-asc';
  properties: { sense: boolean; counts: boolean; status: boolean; updated: boolean };
}
const key = 'knowra:concept-index-display:v1';
export const DEFAULT_CONCEPT_DISPLAY: ConceptDisplay = {
  view: 'list',
  sort: 'updated-desc',
  properties: { sense: true, counts: true, status: true, updated: true }
};
export function parseConceptDisplay(value: unknown): ConceptDisplay {
  const input = value && typeof value === 'object' ? (value as Partial<ConceptDisplay>) : {};
  return {
    view: input.view === 'card' ? 'card' : 'list',
    sort: input.sort === 'name-asc' || input.sort === 'updated-asc' ? input.sort : 'updated-desc',
    properties: Object.fromEntries(
      Object.keys(DEFAULT_CONCEPT_DISPLAY.properties).map(name => [
        name,
        typeof input.properties?.[name as keyof ConceptDisplay['properties']] === 'boolean'
          ? input.properties[name as keyof ConceptDisplay['properties']]
          : true
      ])
    ) as ConceptDisplay['properties']
  };
}
function read() {
  try {
    return parseConceptDisplay(JSON.parse(localStorage.getItem(key) ?? 'null'));
  } catch {
    return parseConceptDisplay(null);
  }
}
let state = read();
const listeners = new Set<() => void>();
export function setConceptDisplay(
  patch: Partial<Omit<ConceptDisplay, 'properties'>> & { properties?: Partial<ConceptDisplay['properties']> }
) {
  state = parseConceptDisplay({ ...state, ...patch, properties: { ...state.properties, ...patch.properties } });
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    /* 本次会话保留。 */
  }
  listeners.forEach(fn => fn());
}
export function useConceptDisplay() {
  return useSyncExternalStore(
    fn => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => state
  );
}
