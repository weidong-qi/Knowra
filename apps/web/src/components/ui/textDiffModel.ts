export interface DiffLine { kind: 'same' | 'removed' | 'added'; text: string; beforeLine?: number; afterLine?: number }
export interface TextDiffResult { lines: DiffLine[]; limited: boolean; simplified: boolean }

const MAX_CHARACTERS = 120_000;
const MAX_LINES = 2_000;
const MAX_CELLS = 250_000;

function splitText(text: string) {
  const sample = text.slice(0, MAX_CHARACTERS);
  const lines = sample === '' ? [] : sample.split('\n');
  return { lines: lines.slice(0, MAX_LINES), limited: text.length > MAX_CHARACTERS || lines.length > MAX_LINES };
}

/** 对比较长的正文时限制矩阵大小，避免同步面板阻塞编辑器。 */
export function buildTextDiff(before: string, after: string): TextDiffResult {
  const left = splitText(before);
  const right = splitText(after);
  const a = left.lines;
  const b = right.lines;
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - suffix - 1] === b[b.length - suffix - 1]) suffix++;
  const lines: DiffLine[] = [];
  const same = (i: number, j: number) => lines.push({ kind: 'same', text: a[i], beforeLine: i + 1, afterLine: j + 1 });
  const removed = (i: number) => lines.push({ kind: 'removed', text: a[i], beforeLine: i + 1 });
  const added = (j: number) => lines.push({ kind: 'added', text: b[j], afterLine: j + 1 });
  for (let i = 0; i < prefix; i++) same(i, i);
  const n = a.length - prefix - suffix;
  const m = b.length - prefix - suffix;
  const simplified = (n + 1) * (m + 1) > MAX_CELLS;
  if (simplified) {
    for (let i = prefix; i < a.length - suffix; i++) removed(i);
    for (let j = prefix; j < b.length - suffix; j++) added(j);
  } else {
    const width = m + 1;
    const matrix = new Uint16Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
      matrix[i * width + j] = a[prefix + i] === b[prefix + j]
        ? matrix[(i + 1) * width + j + 1] + 1
        : Math.max(matrix[(i + 1) * width + j], matrix[i * width + j + 1]);
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[prefix + i] === b[prefix + j]) { same(prefix + i++, prefix + j++); }
      else if (i < n && (j === m || matrix[(i + 1) * width + j] >= matrix[i * width + j + 1])) removed(prefix + i++);
      else added(prefix + j++);
    }
  }
  for (let i = 0; i < suffix; i++) same(a.length - suffix + i, b.length - suffix + i);
  return { lines, limited: left.limited || right.limited, simplified };
}

export type DiffDisplayRow = { line: DiffLine } | { omitted: number };
export function collapseUnchanged(lines: DiffLine[]): DiffDisplayRow[] {
  const result: DiffDisplayRow[] = [];
  for (let i = 0; i < lines.length;) {
    if (lines[i].kind !== 'same') { result.push({ line: lines[i++] }); continue; }
    let end = i;
    while (end < lines.length && lines[end].kind === 'same') end++;
    if (end - i <= 8) for (let j = i; j < end; j++) result.push({ line: lines[j] });
    else {
      for (let j = i; j < i + 3; j++) result.push({ line: lines[j] });
      result.push({ omitted: end - i - 6 });
      for (let j = end - 3; j < end; j++) result.push({ line: lines[j] });
    }
    i = end;
  }
  return result;
}
