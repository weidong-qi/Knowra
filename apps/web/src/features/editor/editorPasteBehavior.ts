import { convertTexMathDelimiters, shouldPasteAsSource } from './editorMathPaste';
import { Fragment, Slice } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import { parserCtx, remarkCtx } from '@milkdown/kit/core';
import { parseMarkdownSlice } from './editorMarkdownSlice';
import { assertInlineImageFile } from './attachmentFiles';
import { hasPastedKnowraMarks, insertKnowraSource, knowraClipboardIntent, KNOWRA_CLIPBOARD_PASTE, KNOWRA_CLIPBOARD_PLAIN, parseKnowraClipboardSlice, recallKnowraClipboard } from './editorKnowraClipboard';

const MARKDOWN_BLOCK_PATTERNS = [
  /^\s{0,3}#{1,6}\s+/m,
  /^\s{0,3}(?:```|~~~)/m,
  /^\s{0,3}>\s+/m,
  /^\s{0,3}(?:[-*+] |\d+\. )/m,
  /^\s{0,3}\|.+\|\s*$/m
];

export function looksLikeMarkdown(text: string): boolean {
  return MARKDOWN_BLOCK_PATTERNS.some((pattern) => pattern.test(text));
}

export function shouldPreferPlainMarkdown(input: {
  text: string;
  html: string;
  vscodeData: string;
}): boolean {
  return Boolean(input.text)
    && !input.vscodeData
    && (!input.html || looksLikeMarkdown(input.text));
}

export function stripPastedInlineStyles(html: string): string {
  if (!html || typeof DOMParser === 'undefined') return html;
  const document = new DOMParser().parseFromString(html, 'text/html');
  for (const element of document.body.querySelectorAll('[style]')) element.removeAttribute('style');
  for (const pre of document.body.querySelectorAll('pre')) {
    pre.querySelectorAll('[data-code-toolbar]').forEach((toolbar) => toolbar.remove());
    const code = pre.querySelector('code');
    const languageClass = [...(code?.classList ?? []), ...pre.classList]
      .find((name) => /^(?:language|lang)-/.test(name));
    pre.dataset.language ??= languageClass?.replace(/^(?:language|lang)-/, '') ?? '';
  }
  return Array.from(document.body.childNodes).map(serializeHtmlNode).join('');
}

export function removeSpuriousEmptyCodeBlocks(slice: Slice): Slice {
  const content = sanitizeFragment(slice.content);
  return content === slice.content ? slice : new Slice(content, slice.openStart, slice.openEnd);
}

export function findUnsupportedPasteSources(html: string, text: string): string[] {
  const sources = new Set<string>();
  for (const source of [html, text]) {
    for (const match of source.matchAll(/(?:src\s*=\s*["']?|!\[[^\]]*\]\(\s*)(http:\/\/[^\s"')>]+)/gi)) {
      if (match[1]) sources.add(match[1]);
    }
  }
  return [...sources];
}

export interface UploadedEditorImage {
  url: string;
  alt: string;
}

export function createEditorPasteBehavior(
  onStatus: (message: string) => void,
  onUploadImage?: (file: File) => Promise<UploadedEditorImage>
) {
  return $prose((ctx) => new Plugin({
    key: new PluginKey('V4_EDITOR_PASTE_BEHAVIOR'),
    props: {
      transformPastedHTML: stripPastedInlineStyles,
      handlePaste(view, event, preProcessedSlice) {
        const clipboardData = event.clipboardData;
        if (!clipboardData) return false;
        if (shouldPasteAsSource(view.state)) {
          const source = clipboardData.getData('text/plain');
          if (!source) return false;
          event.preventDefault();
          // ProseMirror 在代码上下文会预先把 HTML 解析成纯文本，需用 schema 单独读回重点载体。
          const payload = recallKnowraClipboard(source);
          const html = payload?.html ?? clipboardData.getData('text/html');
          let slice = preProcessedSlice;
          if (html.includes('data-knowra-mark')) {
            slice = parseKnowraClipboardSlice(view.state.schema, stripPastedInlineStyles(html));
          }
          const text = payload?.plain ?? source;
          const marked = insertKnowraSource(view.state, slice, text);
          view.dispatch((marked ?? view.state.tr.insertText(text.replace(/\r\n?/g, '\n')).setMeta('uiEvent', 'paste').setMeta(KNOWRA_CLIPBOARD_PLAIN, true))
            .setMeta(KNOWRA_CLIPBOARD_PASTE, knowraClipboardIntent(source, slice)).scrollIntoView());
          return true;
        }
        if (view.state.selection.$from.parent.type.spec.code) return false;

        const imageFiles = Array.from(clipboardData.items ?? []).filter((item) => (
          item.kind === 'file' && item.type.startsWith('image/')
        ));
        if (imageFiles.length > 0) {
          event.preventDefault();
          if (!onUploadImage) {
            onStatus('当前无法上传图片');
            return true;
          }
          const files = imageFiles
            .map((item) => item.getAsFile())
            .filter((file): file is File => Boolean(file));
          onStatus(files.length > 1 ? `正在上传 ${files.length} 张图片…` : '正在上传图片…');
          void uploadPastedImages(view, files, onUploadImage, onStatus);
          return true;
        }

        const html = clipboardData.getData('text/html');
        const text = clipboardData.getData('text/plain');
        const unsupportedSources = findUnsupportedPasteSources(html, text);
        if (unsupportedSources.length > 0) {
          event.preventDefault();
          onStatus('已阻止不安全的 HTTP 图片链接，请改用 HTTPS 或本地附件');
          return true;
        }
        const payload = recallKnowraClipboard(text);
        if (payload) {
          event.preventDefault();
          const slice = parseKnowraClipboardSlice(view.state.schema, payload.html);
          view.dispatch(view.state.tr.replaceSelection(slice)
            .setMeta('uiEvent', 'paste').setMeta(KNOWRA_CLIPBOARD_PASTE, knowraClipboardIntent(text, slice)).scrollIntoView());
          return true;
        }

        const vscodeData = clipboardData.getData('vscode-editor-data');
        const htmlHasCode = Boolean(html && new DOMParser().parseFromString(html, 'text/html').querySelector('pre, code'));
        const texConverted = vscodeData || htmlHasCode ? text : convertTexMathDelimiters(text, source => ctx.get(remarkCtx).parse(source));
        if (text && texConverted !== text) {
          const slice = parseMarkdownSlice(ctx.get(parserCtx), texConverted);
          if (slice) {
            event.preventDefault();
            view.dispatch(view.state.tr.replaceSelection(slice).setMeta('uiEvent', 'paste').setMeta(KNOWRA_CLIPBOARD_PASTE, knowraClipboardIntent(text, slice)).scrollIntoView());
            return true;
          }
        }

        if (shouldPreferPlainMarkdown({
          text,
          html,
          vscodeData
        })) {
          const slice = parseMarkdownSlice(ctx.get(parserCtx), text);
          if (!slice) return false;
          event.preventDefault();
          view.dispatch(view.state.tr.replaceSelection(slice).setMeta('uiEvent', 'paste').setMeta(KNOWRA_CLIPBOARD_PASTE, knowraClipboardIntent(text, slice)).scrollIntoView());
          return true;
        }

        if (!html) return false;
        const cleanedSlice = removeSpuriousEmptyCodeBlocks(preProcessedSlice);
        // Milkdown 默认粘贴不带 uiEvent，纯文本节点还会继承目标 marks。
        // 正文重点必须保留剪贴板载体，并让身份插件识别这次复制/移动。
        if (cleanedSlice === preProcessedSlice && !hasPastedKnowraMarks(cleanedSlice)) return false;
        event.preventDefault();
        view.dispatch(view.state.tr.replaceSelection(cleanedSlice).setMeta('uiEvent', 'paste').setMeta(KNOWRA_CLIPBOARD_PASTE, knowraClipboardIntent(text, cleanedSlice)).scrollIntoView());
        return true;
      }
    }
  }));
}

export async function uploadPastedImages(
  view: EditorView,
  files: File[],
  onUploadImage: (file: File) => Promise<UploadedEditorImage>,
  onStatus: (message: string) => void
): Promise<void> {
  try {
    for (const file of files) {
      if (view.isDestroyed || !view.editable) throw new Error('编辑状态已变化，未插入正文');
      assertInlineImageFile(file);
      const original = view.state;
      const uploaded = await onUploadImage(file);
      if (view.isDestroyed || !view.editable || !view.state.doc.eq(original.doc) || !view.state.selection.eq(original.selection)) {
        throw new Error('图片已上传，正文、选区或编辑状态已变化，未插入正文，可从附件列表再次插入');
      }
      const imageType = view.state.schema.nodes.image;
      if (!imageType) throw new Error('编辑器未启用图片节点');
      const image = imageType.create({ src: uploaded.url, alt: uploaded.alt, title: null });
      view.dispatch(view.state.tr.replaceSelectionWith(image).scrollIntoView());
    }
    onStatus(files.length > 1 ? `已插入 ${files.length} 张图片` : '图片已插入正文');
  } catch (error) {
    onStatus(error instanceof Error ? error.message : '图片上传失败');
  }
}

function sanitizeFragment(fragment: Fragment): Fragment {
  const children = [];
  let changed = false;
  for (let index = 0; index < fragment.childCount; index += 1) {
    const node = fragment.child(index);
    const nextNode = index + 1 < fragment.childCount ? fragment.child(index + 1) : null;
    if (
      node.type.name === 'code_block'
      && !node.textContent.trim()
      && nextNode?.type.name === 'code_block'
      && Boolean(nextNode.textContent.trim())
    ) {
      changed = true;
      continue;
    }
    const content = node.content.size > 0 ? sanitizeFragment(node.content) : node.content;
    children.push(content === node.content ? node : node.copy(content));
    if (content !== node.content) changed = true;
  }
  return changed ? Fragment.fromArray(children) : fragment;
}

function serializeHtmlNode(node: Node): string {
  if (node.nodeType === Node.ELEMENT_NODE) return (node as Element).outerHTML;
  if (node.nodeType !== Node.TEXT_NODE) return '';
  return (node.textContent ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
