import { escapeHtml } from '../src/app/formatting.js';

const EDITOR_HEADING_MAX_LEVEL = 4;
const MARKDOWN_HEADING_MAX_LEVEL = 6;

function renderInlineMarkdown(text) {
  let html = escapeHtml(text);
  html = html.replace(/\\&lt;br\s*\/?&gt;/gi, '<br />');
  html = html.replace(/&lt;br\s*\/?&gt;/gi, '<br />');
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, src) => (
    /^http:\/\//i.test(src.trim())
      ? `<span class="preview-blocked-image">[已阻止不安全图片：${alt || '未命名图片'}]</span>`
      : `<img src="${src}" alt="${alt}" />`
  ));
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  return html;
}

function isMarkdownTable(lines) {
  if (lines.length < 2) {
    return false;
  }

  const separatorLine = lines[1].trim();
  if (!/^\|?[\s:-]+\|[\s|:-]*$/.test(separatorLine)) {
    return false;
  }

  return lines.every((line) => /\|/.test(line));
}

function parseMarkdownTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function renderMarkdownTable(lines) {
  const [headerLine, , ...bodyLines] = lines;
  const headers = parseMarkdownTableRow(headerLine);
  const bodyRows = bodyLines
    .filter((line) => line.trim().length > 0)
    .map(parseMarkdownTableRow);

  return `
    <table>
      <thead>
        <tr>${headers.map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`).join('')}</tr>
      </thead>
      <tbody>
        ${bodyRows.map((row) => `<tr>${row.map((cell) => `<td>${renderInlineMarkdown(cell)}</td>`).join('')}</tr>`).join('')}
      </tbody>
    </table>
  `.replace(/\n\s*/g, '');
}

function slugifyHeading(text, fallbackIndex) {
  const slug = String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || `section-${fallbackIndex}`;
}

export function extractMarkdownHeadings(markdown, { maxLevel = EDITOR_HEADING_MAX_LEVEL } = {}) {
  const source = String(markdown ?? '').replace(/\r\n/g, '\n');
  const headings = [];
  const slugCounts = new Map();
  const normalizedMaxLevel = Math.min(
    MARKDOWN_HEADING_MAX_LEVEL,
    Math.max(1, Number(maxLevel) || EDITOR_HEADING_MAX_LEVEL)
  );

  source.split('\n').forEach((line) => {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (!headingMatch || headingMatch[1].length > normalizedMaxLevel) {
      return;
    }

    const title = headingMatch[2].trim();
    const baseId = slugifyHeading(title, headings.length + 1);
    const duplicateCount = slugCounts.get(baseId) ?? 0;
    slugCounts.set(baseId, duplicateCount + 1);

    headings.push({
      index: headings.length,
      level: headingMatch[1].length,
      title,
      id: duplicateCount ? `${baseId}-${duplicateCount + 1}` : baseId
    });
  });

  return headings;
}

export function renderMarkdownPreview(markdown) {
  const source = String(markdown ?? '').replace(/\r\n/g, '\n').trim();

  if (!source) {
    return '<p class="preview-empty">Nothing to preview yet.</p>';
  }

  const blocks = source.split(/\n\s*\n/);
  const headings = extractMarkdownHeadings(source, { maxLevel: MARKDOWN_HEADING_MAX_LEVEL });
  let headingIndex = 0;

  return blocks
    .map((block) => {
      const lines = block.split('\n');

      if (lines.every((line) => /^\s*>\s?/.test(line))) {
        const content = lines.map((line) => line.replace(/^\s*>\s?/, '')).join(' ');
        return `<blockquote>${renderInlineMarkdown(content)}</blockquote>`;
      }

      if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
        const items = lines.map((line) => line.replace(/^\s*[-*]\s+/, '').trim());
        return `<ul>${items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</ul>`;
      }

      if (lines.every((line) => /^\s*\d+\.\s+/.test(line))) {
        const items = lines.map((line) => line.replace(/^\s*\d+\.\s+/, '').trim());
        return `<ol>${items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</ol>`;
      }

      if (lines.length === 1 && /^\s*([-*_])(?:\s*\1){2,}\s*$/.test(lines[0])) {
        return '<hr />';
      }

      if (lines[0].startsWith('```') && lines[lines.length - 1].startsWith('```')) {
        const code = lines.slice(1, -1).join('\n');
        return `<pre><code>${escapeHtml(code)}</code></pre>`;
      }

      if (isMarkdownTable(lines)) {
        return renderMarkdownTable(lines);
      }

      const headingMatch = lines[0].match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const content = renderInlineMarkdown(headingMatch[2]);
        const heading = headings[headingIndex];
        headingIndex += 1;
        const rest = lines.slice(1).join(' ').trim();
        const paragraph = rest ? `<p>${renderInlineMarkdown(rest)}</p>` : '';
        return `<h${level} id="${heading?.id ?? `section-${headingIndex}`}">${content}</h${level}>${paragraph}`;
      }

      return `<p>${renderInlineMarkdown(lines.join('<br />'))}</p>`;
    })
    .join('');
}

export function applyMarkdownFormat(text, selectionStart, selectionEnd, format) {
  const before = text.slice(0, selectionStart);
  const selected = text.slice(selectionStart, selectionEnd);
  const after = text.slice(selectionEnd);

  const wrap = (prefix, suffix = prefix) => ({
    nextValue: `${before}${prefix}${selected || '文本'}${suffix}${after}`,
    nextSelectionStart: before.length + prefix.length,
    nextSelectionEnd: before.length + prefix.length + (selected || '文本').length
  });

  switch (format) {
    case 'heading-1':
      return {
        nextValue: `${before}# ${selected || '标题'}${after}`,
        nextSelectionStart: before.length + 2,
        nextSelectionEnd: before.length + 2 + (selected || '标题').length
      };
    case 'heading-2':
      return {
        nextValue: `${before}## ${selected || '标题'}${after}`,
        nextSelectionStart: before.length + 3,
        nextSelectionEnd: before.length + 3 + (selected || '标题').length
      };
    case 'bold':
      return wrap('**');
    case 'italic':
      return wrap('*');
    case 'quote':
      return {
        nextValue: `${before}> ${selected || '引用内容'}${after}`,
        nextSelectionStart: before.length + 2,
        nextSelectionEnd: before.length + 2 + (selected || '引用内容').length
      };
    case 'code':
      return wrap('`');
    case 'bullet':
      return {
        nextValue: `${before}- ${selected || '列表项'}${after}`,
        nextSelectionStart: before.length + 2,
        nextSelectionEnd: before.length + 2 + (selected || '列表项').length
      };
    case 'link':
      return {
        nextValue: `${before}[${selected || '链接文本'}](https://example.com)${after}`,
        nextSelectionStart: before.length + 1,
        nextSelectionEnd: before.length + 1 + (selected || '链接文本').length
      };
    case 'codeblock':
      return {
        nextValue: `${before}\`\`\`\n${selected || '代码块内容'}\n\`\`\`${after}`,
        nextSelectionStart: before.length + 4,
        nextSelectionEnd: before.length + 4 + (selected || '代码块内容').length
      };
    default:
      return {
        nextValue: text,
        nextSelectionStart: selectionStart,
        nextSelectionEnd: selectionEnd
      };
  }
}
