import { applySourceEdit, calculateContentHash, sourceEdit, sourceEdits, type AnnotationMapping, type SourceEdit } from '@study-accelerator/content-anchor';
export interface AnnotationEditIntent { history?: boolean; moveId?: string; moveKind?: 'cut' | 'paste'; preserveEmptyBlock?: boolean; deletedEmptyAnnotationIds?: string[] }
export interface EditEntry { sequence: number; operationId?: string; before: string; after: string; edit: SourceEdit }
export function buildEditMapping(before: string, after: string, entries: EditEntry[]): AnnotationMapping | undefined {
  if (!entries.length || entries[0].before !== before) return undefined;
  let value = before;
  const edits: SourceEdit[] = [];
  for (const entry of entries) {
    if (entry.before !== value) return undefined;
    value = applySourceEdit(value, entry.edit);
    edits.push(entry.edit);
  }
  if (value !== after) return undefined;
  return { formatVersion: 1, operationId: `${entries[0].operationId ?? calculateContentHash(before)}:${calculateContentHash(after)}`, baseContentHash: calculateContentHash(before), targetContentHash: calculateContentHash(after), edits };
}
export function appendEdit(entries: EditEntry[], before: string, after: string, intent?: AnnotationEditIntent): EditEntry[] {
  if (before === after && !intent?.deletedEmptyAnnotationIds?.length && !intent?.preserveEmptyBlock) return entries;
  const result = [...entries];
  const changes = sourceEdits(before, after);
  if (!changes.length) changes.push(sourceEdit(before, after));
  let source = before;
  const operationId = crypto.randomUUID();
  for (const change of changes) {
    const next = applySourceEdit(source, change);
    result.push({ operationId, sequence: (result.at(-1)?.sequence ?? 0) + 1, before: source, after: next, edit: { ...change, ...intent } });
    source = next;
  }
  return result;
}

export function validRecoveredEdits(value: unknown): value is EditEntry[] {
  if (!Array.isArray(value) || value.length > 10000) return false;
  try {
    return value.every((entry, index) => entry && Number.isInteger(entry.sequence)
      && typeof entry.before === 'string' && typeof entry.after === 'string'
      && (index === 0 || value[index-1].after === entry.before)
      && applySourceEdit(entry.before, entry.edit) === entry.after);
  } catch { return false; }
}
