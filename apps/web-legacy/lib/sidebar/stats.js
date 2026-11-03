export function getNoteStats(markdown) {
  const normalized = typeof markdown === 'string' ? markdown : '';
  const characterCount = normalized
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/^>\s?/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~\-|]/g, ' ')
    .replace(/\s+/g, '')
    .length;

  return {
    characterCount
  };
}
