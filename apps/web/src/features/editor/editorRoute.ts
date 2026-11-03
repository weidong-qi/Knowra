export function getEditorNoteId(pathname: string): string | null {
  const match = pathname.match(/^\/materials\/notes\/([^/]+)$/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}
