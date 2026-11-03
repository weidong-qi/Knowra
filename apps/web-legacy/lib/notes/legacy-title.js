export function stripLegacyGeneratedTitle({ markdown, title, sourceType }) {
  const documentMarkdown = String(markdown ?? '');
  const documentTitle = String(title ?? '').trim();
  if (sourceType !== 'manual' || !documentTitle) {
    return documentMarkdown;
  }

  const titleLine = `# ${documentTitle}`;
  if (documentMarkdown === titleLine) {
    return '';
  }
  if (!documentMarkdown.startsWith(`${titleLine}\n`)) {
    return documentMarkdown;
  }

  return documentMarkdown
    .slice(titleLine.length + 1)
    .replace(/^\n/, '');
}
