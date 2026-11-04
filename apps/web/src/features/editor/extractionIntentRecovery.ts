import { readRuntimeConfig } from '../../app/runtimeConfig';

export interface ExtractionIntent { scopeId: string; taskKey: string; submitted: boolean; jobId?: string }
const memory = new Map<string, ExtractionIntent>();

/** Only opaque intent identifiers are stored. Web's data source is its origin; the API rechecks its epoch. */
export function extractionIntentKey(spaceId: string, noteId: string) {
  const runtime = readRuntimeConfig();
  return `knowra:extraction-intent:v1:${JSON.stringify([location.origin, runtime.persistenceMode,
    runtime.datasetId ?? 'server', spaceId, noteId])}`;
}
function valid(value: unknown): value is ExtractionIntent {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).every(key => ['scopeId', 'taskKey', 'submitted', 'jobId'].includes(key))
    && [v.scopeId, v.taskKey].every(item => typeof item === 'string' && item.length > 0 && item.length <= 512)
    && typeof v.submitted === 'boolean' && (v.jobId === undefined || typeof v.jobId === 'string' && v.jobId.length > 0 && v.jobId.length <= 512);
}
export function readExtractionIntent(key: string): { intent: ExtractionIntent | null; failed: boolean } {
  if (memory.has(key)) return { intent: memory.get(key)!, failed: false };
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    if (value === null) return { intent: null, failed: false };
    if (!valid(value)) { sessionStorage.removeItem(key); return { intent: null, failed: true }; }
    memory.set(key, value);
    return { intent: value, failed: false };
  } catch { return { intent: null, failed: true }; }
}
export function saveExtractionIntent(key: string, intent: ExtractionIntent | null): boolean {
  if (intent) memory.set(key, intent); else memory.delete(key);
  try {
    if (intent) sessionStorage.setItem(key, JSON.stringify(intent)); else sessionStorage.removeItem(key);
    return true;
  } catch { return false; }
}
