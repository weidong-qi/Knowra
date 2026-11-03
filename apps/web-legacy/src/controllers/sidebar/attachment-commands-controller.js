import {
  buildAttachmentContentUrl,
  extractAttachmentIdFromUrl
} from '../../../lib/sidebar/attachments.js';
import { writeClipboardText } from '../../../lib/browser/clipboard.js';

export function createAttachmentCommandsController({ elements, flashStatus }) {
  const attachmentJumpIndexes = new Map();

  function findAttachmentReferenceTargets(attachmentId) {
    if (!attachmentId || !elements.editorContent) {
      return [];
    }

    const targets = [];
    const seen = new Set();
    const directMatches = elements.editorContent.querySelectorAll(
      `[data-attachment-id="${escapeAttachmentSelector(attachmentId)}"]`
    );
    directMatches.forEach((candidate) => {
      if (!(candidate instanceof HTMLElement) || seen.has(candidate) || isNestedReferenceTarget(candidate, targets)) {
        return;
      }
      seen.add(candidate);
      targets.push(candidate);
    });

    const candidates = elements.editorContent.querySelectorAll('img[src], a[href]');
    for (const candidate of candidates) {
      if (!(candidate instanceof HTMLElement) || seen.has(candidate) || isNestedReferenceTarget(candidate, targets)) {
        continue;
      }

      const source = candidate.getAttribute('src')
        ?? candidate.getAttribute('href')
        ?? (candidate instanceof HTMLImageElement ? candidate.currentSrc : '');
      if (extractAttachmentIdFromUrl(source) === attachmentId) {
        seen.add(candidate);
        targets.push(candidate);
      }
    }

    return targets;
  }

  function findAttachmentReferenceTarget(attachmentId) {
    return findAttachmentReferenceTargets(attachmentId)[0] ?? null;
  }

  function jumpToAttachmentReference(attachmentId, direction = 'next') {
    const targets = findAttachmentReferenceTargets(attachmentId);
    const target = resolveAttachmentJumpTarget(attachmentId, targets, direction, attachmentJumpIndexes);
    if (!target) {
      attachmentJumpIndexes.delete(attachmentId);
      flashStatus('当前附件尚未在正文中找到引用位置');
      return false;
    }

    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return true;
  }

  function openAttachment(attachmentId) {
    const contentUrl = buildAttachmentContentUrl(attachmentId);
    if (!contentUrl) {
      flashStatus('当前附件缺少可打开的内容地址');
      return false;
    }

    if (typeof window !== 'undefined' && typeof window.open === 'function') {
      window.open(contentUrl, '_blank', 'noopener');
      return true;
    }

    flashStatus('当前环境暂不支持打开附件');
    return false;
  }

  async function copyAttachmentLink(attachmentId) {
    const contentUrl = buildAttachmentContentUrl(attachmentId);
    if (!contentUrl) {
      flashStatus('当前附件缺少可复制的内容地址');
      return false;
    }

    const copied = await writeClipboardText(contentUrl);
    flashStatus(copied ? '已复制附件链接' : '复制附件链接失败');
    return copied;
  }

  return {
    findAttachmentReferenceTargets,
    findAttachmentReferenceTarget,
    jumpToAttachmentReference,
    openAttachment,
    copyAttachmentLink
  };
}

function resolveAttachmentJumpTarget(attachmentId, targets, direction, attachmentJumpIndexes) {
  if (!attachmentId || !targets.length) {
    return null;
  }

  const currentIndex = attachmentJumpIndexes.get(attachmentId);
  const maxIndex = targets.length - 1;
  let nextIndex = 0;

  if (direction === 'previous') {
    nextIndex = Number.isInteger(currentIndex)
      ? (currentIndex - 1 + targets.length) % targets.length
      : maxIndex;
  } else {
    nextIndex = Number.isInteger(currentIndex)
      ? (currentIndex + 1) % targets.length
      : 0;
  }

  attachmentJumpIndexes.set(attachmentId, nextIndex);
  return targets[nextIndex] ?? null;
}

function escapeAttachmentSelector(value) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }

  return String(value).replace(/"/g, '\\"');
}

function isNestedReferenceTarget(candidate, targets) {
  return targets.some((target) => target === candidate || target.contains(candidate) || candidate.contains(target));
}
