import { escapeHtml } from '../../src/app/formatting.js';

function normalizeExistingTitles(items) {
  return new Set((items ?? []).map((item) => String(item ?? '').trim()).filter(Boolean));
}

export function getSiblingNamesForFolder({ folderId = null, foldersById = {}, folderTree = [], notes = [] } = {}) {
  const folderNames = (folderId ? foldersById[folderId]?.children ?? [] : folderTree)
    .map((folder) => folder.name);
  const noteNames = notes
    .filter((note) => note.folderId === folderId)
    .map((note) => note.title);

  return [...folderNames, ...noteNames];
}

export function createUntitledName(existingTitles, baseLabel) {
  const taken = normalizeExistingTitles(existingTitles);
  const trimmedBase = String(baseLabel ?? '').trim() || 'Untitled Note';

  if (!taken.has(trimmedBase)) {
    return trimmedBase;
  }

  let index = 2;
  while (taken.has(`${trimmedBase} ${index}`)) {
    index += 1;
  }

  return `${trimmedBase} ${index}`;
}

export function createDuplicateTitle(existingTitles, sourceTitle) {
  const taken = normalizeExistingTitles(existingTitles);
  const baseTitle = String(sourceTitle ?? '').trim() || 'Untitled Note';
  const copyBase = `${baseTitle} Copy`;

  if (!taken.has(copyBase)) {
    return copyBase;
  }

  let index = 2;
  while (taken.has(`${copyBase} ${index}`)) {
    index += 1;
  }

  return `${copyBase} ${index}`;
}

export function createLocalDuplicateNoteInput({
  note,
  title,
  markdown,
  id = `note-${Date.now().toString(36)}`,
  updatedAt = new Date().toISOString()
}) {
  return {
    ...note,
    id,
    title,
    rawMarkdown: markdown,
    updatedAt
  };
}

export function buildExportFileName(title, extension) {
  const safeBase = String(title ?? '')
    .trim()
    .replace(/\//g, ' - ')
    .replace(/[\\:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Untitled Note';

  return `${safeBase}.${String(extension ?? '').trim() || 'txt'}`;
}

export function deriveNoteTitleFromMarkdown(markdown, fallbackTitle = 'Untitled Note') {
  const headingMatch = String(markdown ?? '').match(/^\s*#\s+(.+)$/m);
  if (headingMatch?.[1]?.trim()) {
    return headingMatch[1].trim();
  }

  const firstLine = String(markdown ?? '')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);

  return firstLine || fallbackTitle;
}

export function deriveMarkdownImportTitle(fileName, markdown) {
  const fallbackTitle = String(fileName ?? '')
    .replace(/\.[^.]+$/, '')
    .trim() || 'Imported Note';

  return deriveNoteTitleFromMarkdown(markdown, fallbackTitle);
}

export async function buildMarkdownImportItems(files, {
  now = () => Date.now()
} = {}) {
  const normalizedFiles = Array.from(files ?? []).filter(Boolean);

  if (normalizedFiles.length === 0) {
    throw new Error('请先选择 Markdown 文件');
  }

  const importStamp = now().toString(36);
  return Promise.all(normalizedFiles.map(async (file, index) => {
    const rawMarkdown = await file.text();
    return {
      id: `note-import-${importStamp}-${index.toString(36)}`,
      title: deriveMarkdownImportTitle(file.name, rawMarkdown),
      rawMarkdown,
      sourceType: 'markdown-import'
    };
  }));
}

export function getMarkdownImportStatusMessage(importedItems, firstImported = null) {
  return importedItems.length > 1
    ? `已导入 ${importedItems.length} 个 Markdown 文件`
    : `已导入 Markdown 笔记：${firstImported?.title ?? importedItems[0]?.title ?? ''}`;
}

function renderExportStyles({ rich = false } = {}) {
  // 导出 HTML 为独立文档，运行时无 CSS 变量可用，需内联具体颜色值
  const richStyles = rich
    ? `
          pre { border-radius: 12px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 8px 10px; border: 1px solid #d0d7e2; text-align: left; }
          th { background: #f0f4fa; }
          li[data-item-type="task"] { list-style: none; position: relative; padding-left: 1.6em; }
          li[data-item-type="task"]::before { content: '☐'; position: absolute; left: 0; font-size: 1.1em; }
          li[data-item-type="task"][data-checked="true"]::before { content: '☑'; }
    `
    : '';

  return `
          body { font-family: "Segoe UI", "PingFang SC", sans-serif; margin: 40px auto; max-width: 760px; color: #142033; line-height: 1.8; }
          h1, h2, h3 { line-height: 1.3; }
          pre { padding: 16px; background: #10182b; color: #eff4ff; overflow: auto; }
          code { font-family: Consolas, monospace; }
          blockquote { border-left: 3px solid #4c72ff; padding-left: 14px; color: #51607a; }
          img { max-width: 100%; }
${richStyles}`;
}

function renderPrintScript({ delayed = false } = {}) {
  if (delayed) {
    return `
        <script>
          window.addEventListener('load', function () {
            window.setTimeout(function () {
              window.focus();
              window.print();
            }, 120);
          });
        </script>`;
  }

  return `
        <script>
          window.addEventListener('load', function () {
            window.print();
          });
        </script>`;
}

export function buildNoteExportHtml({
  title,
  previewHtml,
  rich = false,
  print = false,
  delayedPrint = false
} = {}) {
  return `
    <!doctype html>
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(title)}</title>
        <style>${renderExportStyles({ rich })}</style>
      </head>
      <body>
        <article>${previewHtml ?? ''}</article>${print ? renderPrintScript({ delayed: delayedPrint }) : ''}
      </body>
    </html>
  `;
}
