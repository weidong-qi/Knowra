import { escapeHtml } from '../../../../src/app/formatting.js';
import {
  RUNTIME_COLOR_FALLBACKS,
  readCssColorToken
} from '../../../theme/runtime-colors.js';
import { editorViewCtx, schemaCtx } from '@milkdown/kit/core';
import { getNodeFromSchema } from '@milkdown/kit/prose';
const DEFAULT_PLACEHOLDER_RATIO = 4 / 3;

export function pasteImageFile(host, file) {
  if (!(file instanceof File)) {
    return false;
  }

  const view = host.editor?.ctx.get(editorViewCtx);
  const schema = host.editor?.ctx.get(schemaCtx);
  const imageBlockNodeType = schema ? getNodeFromSchema('image-block', schema) : null;

  if (!view || !imageBlockNodeType) {
    return false;
  }

  const placeholderTheme = resolveImagePlaceholderTheme();
  const placeholderSrc = createImageUploadPlaceholderSrc({
    label: '正在处理图片…',
    accentColor: placeholderTheme.accent,
    ...placeholderTheme.surface,
    ratio: DEFAULT_PLACEHOLDER_RATIO
  });

  const node = imageBlockNodeType.create({
    src: placeholderSrc,
    caption: '',
    ratio: 1
  });

  view.dispatch(view.state.tr.replaceSelectionWith(node, false).scrollIntoView());
  ensureParagraphAfterImageSrc(host, placeholderSrc);
  view.focus();
  host.scheduleImageLayoutRefreshBurst?.([0, 48, 160]);

  Promise.resolve(host.uploadAttachmentImage(file))
    .then((url) => {
      if (!url) {
        throw new Error('Image upload returned an empty URL');
      }
      replaceImageBlockSrc(host, placeholderSrc, url);
    })
    .catch(() => {
      replaceImageBlockSrc(
        host,
        placeholderSrc,
        createImageUploadPlaceholderSrc({
          label: '图片处理失败',
          accentColor: placeholderTheme.danger,
          ...placeholderTheme.surface,
          ratio: DEFAULT_PLACEHOLDER_RATIO
        })
      );
    });

  return true;
}

function replaceImageBlockSrc(host, currentSrc, nextSrc) {
  const view = host.editor?.ctx.get(editorViewCtx);
  if (!view || !currentSrc || !nextSrc) {
    return false;
  }

  const position = findImageBlockPositionBySrc(view.state.doc, currentSrc);
  if (position == null) {
    return false;
  }

  view.dispatch(view.state.tr.setNodeAttribute(position, 'src', nextSrc));
  host.scheduleImageLayoutRefreshBurst?.();
  return true;
}

export function ensureParagraphAfterImageSrc(host, imageSrc) {
  const view = host.editor?.ctx.get(editorViewCtx);
  const schema = host.editor?.ctx.get(schemaCtx);
  const paragraphNodeType = schema ? getNodeFromSchema('paragraph', schema) : null;
  if (!view || !paragraphNodeType || !imageSrc) {
    return false;
  }

  const position = findImageBlockPositionBySrc(view.state.doc, imageSrc);
  if (position == null) {
    return false;
  }

  const imageNode = view.state.doc.nodeAt(position);
  if (!imageNode) {
    return false;
  }

  const insertPosition = position + imageNode.nodeSize;
  const nextTopLevelNode = view.state.doc.childAfter(insertPosition).node;
  let transaction = view.state.tr;
  if (!nextTopLevelNode || nextTopLevelNode.type.name !== 'paragraph') {
    transaction = transaction.insert(insertPosition, paragraphNodeType.create());
  }

  transaction = transaction.setSelection(
    transaction.selection.constructor.near(transaction.doc.resolve(insertPosition + 1), 1)
  );
  view.dispatch(transaction.scrollIntoView());
  return true;
}

function findImageBlockPositionBySrc(doc, src) {
  let matchedPosition = null;

  doc.descendants((node, position) => {
    if (node.type.name === 'image-block' && node.attrs.src === src) {
      matchedPosition = position;
      return false;
    }
    return true;
  });

  return matchedPosition;
}

function resolveImagePlaceholderTheme() {
  return {
    accent: readCssColorToken('--color-accent', RUNTIME_COLOR_FALLBACKS.accent),
    danger: readCssColorToken('--color-danger', RUNTIME_COLOR_FALLBACKS.danger),
    surface: {
      surfaceStart: readCssColorToken('--color-panel', RUNTIME_COLOR_FALLBACKS.placeholderSurfaceStart),
      surfaceEnd: readCssColorToken('--color-accent-soft', RUNTIME_COLOR_FALLBACKS.placeholderSurfaceEnd),
      textColor: readCssColorToken('--color-text-muted', RUNTIME_COLOR_FALLBACKS.placeholderText)
    }
  };
}

function createImageUploadPlaceholderSrc({
  label,
  accentColor,
  surfaceStart,
  surfaceEnd,
  textColor,
  ratio
}) {
  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : DEFAULT_PLACEHOLDER_RATIO;
  const width = 1200;
  const height = Math.max(480, Math.round(width / safeRatio));
  const escapedLabel = escapeHtml(label || '正在处理图片…');
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stop-color="${surfaceStart}" />
          <stop offset="100%" stop-color="${surfaceEnd}" />
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" rx="28" fill="url(#bg)" />
      <rect x="32" y="32" width="${width - 64}" height="${height - 64}" rx="20" fill="none" stroke="${accentColor}" stroke-opacity="0.18" stroke-width="2" stroke-dasharray="12 10" />
      <circle cx="${width / 2}" cy="${height / 2 - 34}" r="32" fill="${accentColor}" fill-opacity="0.12" />
      <path d="M${width / 2 - 14} ${height / 2 - 34}h28M${width / 2} ${height / 2 - 48}v28" stroke="${accentColor}" stroke-width="4" stroke-linecap="round" />
      <text x="50%" y="${height / 2 + 38}" text-anchor="middle" font-size="34" font-family="system-ui, -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif" fill="${textColor}">${escapedLabel}</text>
    </svg>
  `.trim();

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
