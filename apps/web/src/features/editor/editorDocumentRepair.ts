export interface DocumentRepairReport {
  excessiveBlankLines: number;
  standaloneBackslashes: number;
  total: number;
}

export interface DocumentRepairResult {
  markdown: string;
  changed: boolean;
  report: DocumentRepairReport;
}

export function inspectAndRepairMarkdown(markdown: string): DocumentRepairResult {
  const newline = markdown.includes('\r\n') ? '\r\n' : '\n';
  const lines = markdown.split(/\r?\n/);
  const repaired: string[] = [];
  let fence: { marker: '`' | '~'; length: number } | null = null;
  let previousWasBlank = false;
  let excessiveBlankLines = 0;
  let standaloneBackslashes = 0;

  for (const originalLine of lines) {
    const openingFenceMatch = originalLine.match(/^ {0,3}(`{3,}|~{3,})/);
    if (!fence && openingFenceMatch) {
      const marker = openingFenceMatch[1][0] as '`' | '~';
      fence = { marker, length: openingFenceMatch[1].length };
      repaired.push(originalLine);
      previousWasBlank = false;
      continue;
    }
    const closingFenceMatch = originalLine.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
    if (fence && closingFenceMatch) {
      const marker = closingFenceMatch[1][0] as '`' | '~';
      if (marker === fence.marker && closingFenceMatch[1].length >= fence.length) fence = null;
      repaired.push(originalLine);
      previousWasBlank = false;
      continue;
    }
    if (fence) {
      repaired.push(originalLine);
      continue;
    }

    const standaloneBackslash = originalLine.trim() === '\\';
    if (standaloneBackslash) standaloneBackslashes += 1;
    const line = standaloneBackslash ? '' : originalLine;
    const isBlank = line.trim() === '';
    if (isBlank && previousWasBlank) {
      if (!standaloneBackslash) excessiveBlankLines += 1;
      continue;
    }
    repaired.push(line);
    previousWasBlank = isBlank;
  }

  const repairedMarkdown = repaired.join(newline);
  return {
    markdown: repairedMarkdown,
    changed: repairedMarkdown !== markdown,
    report: {
      excessiveBlankLines,
      standaloneBackslashes,
      total: excessiveBlankLines + standaloneBackslashes
    }
  };
}
