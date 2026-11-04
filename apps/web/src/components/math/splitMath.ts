export type MathSegment =
  | { type: 'text'; value: string }
  | { type: 'math'; source: string; display: boolean; raw: string };

/**
 * 把一段纯文本切成“文字”和“公式”。规则与编辑器保持一致：
 * - `$…$` 的内容不能以空白开头或结尾，结束符后不能紧跟数字（`$5 和 $10` 仍是金额）；
 * - `$$…$$`、`\[…\]` 为块公式，`\(…\)` 为行内公式；
 * - 没有闭合的定界符一律当普通文字，流式输出到一半时不会出现错误提示；
 * - `\$` 是字面美元符号。
 */
export function splitMath(input: string): MathSegment[] {
  const segments: MathSegment[] = [];
  let text = '';
  const flush = () => { if (text) { segments.push({ type: 'text', value: text }); text = ''; } };
  const pushMath = (source: string, display: boolean, raw: string) => { flush(); segments.push({ type: 'math', source, display, raw }); };

  for (let i = 0; i < input.length;) {
    const char = input[i]!;
    if (char === '\\') {
      const next = input[i + 1];
      if (next === '$') { text += '$'; i += 2; continue; }
      if (next === '(' || next === '[') {
        const close = input.indexOf(next === '(' ? '\\)' : '\\]', i + 2);
        const body = close < 0 ? '' : input.slice(i + 2, close);
        if (close >= 0 && body.trim()) { pushMath(body, next === '[', input.slice(i, close + 2)); i = close + 2; continue; }
      }
      text += char; i++; continue;
    }
    if (char === '$') {
      if (input[i + 1] === '$') {
        const close = input.indexOf('$$', i + 2);
        const body = close < 0 ? '' : input.slice(i + 2, close);
        if (close >= 0 && body.trim()) { pushMath(body, true, input.slice(i, close + 2)); i = close + 2; continue; }
        text += '$$'; i += 2; continue;
      }
      const end = findInlineEnd(input, i + 1);
      if (end > 0) { pushMath(input.slice(i + 1, end), false, input.slice(i, end + 1)); i = end + 1; continue; }
    }
    text += char; i++;
  }
  flush();
  return segments;
}

/** 返回行内公式结束符 `$` 的位置；不合法时返回 -1。 */
function findInlineEnd(input: string, from: number): number {
  if (from >= input.length || /\s/.test(input[from]!)) return -1;
  for (let j = from; j < input.length; j++) {
    const char = input[j]!;
    if (char === '\\') { j++; continue; }
    if (char === '\n') return -1;
    if (char !== '$') continue;
    if (j === from || /\s/.test(input[j - 1]!)) return -1;
    if (/\d/.test(input[j + 1] ?? '')) return -1;
    return j;
  }
  return -1;
}

export function hasMath(input: string): boolean {
  return input.includes('$') || input.includes('\\(') || input.includes('\\[');
}
