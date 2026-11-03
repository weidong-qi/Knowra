import type { NoteLinkLocator } from '@study-accelerator/content-anchor';

let pending: { noteId: string; scope: string | undefined; locator: NoteLinkLocator; contentHash: string } | null = null;
export function requestNoteLinkNavigation(noteId: string, scope: string | undefined, locator: NoteLinkLocator, contentHash: string) {
  pending = { noteId, scope, locator, contentHash };
}
export function takeNoteLinkNavigation(noteId: string, scope: string | undefined): { locator: NoteLinkLocator; contentHash: string } | null {
  if (!pending) return null;
  if (pending.scope !== scope) { pending = null; return null; }
  if (pending.noteId !== noteId) return null;
  const result = { locator: pending.locator, contentHash: pending.contentHash };
  pending = null;
  return result;
}
