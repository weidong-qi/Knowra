import DOMPurify from 'dompurify';
import { imageBlockConfig } from '@milkdown/kit/component/image-block';

import { clampImageRatio } from './image-block-sizing.js';
import { extractAttachmentIdFromUrl } from '../sidebar/attachments.js';

export function createImageBlockState(view) {
  return {
    src: '',
    caption: '',
    ratio: 1,
    selected: false,
    readonly: !view.editable,
    showCaption: false,
    linkDraft: ''
  };
}

export function getImageBlockConfig(ctx) {
  return ctx.get(imageBlockConfig.key);
}

export function setImageBlockAttr(controller, attr, value) {
  if (!controller.view.editable) {
    return;
  }

  const pos = controller.getPos();
  if (pos == null) {
    return;
  }

  controller.view.dispatch(
    controller.view.state.tr.setNodeAttribute(
      pos,
      attr,
      attr === 'src' ? DOMPurify.sanitize(String(value ?? '')) : value
    )
  );
}

export function bindImageBlockAttrs(controller, node) {
  const hadSrc = Boolean(controller.state.src);
  controller.state.caption = node.attrs.caption ?? '';
  controller.state.ratio = clampImageRatio(node.attrs.ratio ?? 1);
  controller.state.readonly = !controller.view.editable;
  if (controller.state.caption) {
    controller.state.showCaption = true;
  }

  const nextSrc = node.attrs.src ?? '';
  const attachmentId = extractAttachmentIdFromUrl(nextSrc);
  if (attachmentId) {
    controller.dom.dataset.attachmentId = attachmentId;
  } else {
    delete controller.dom.dataset.attachmentId;
  }

  if (!nextSrc) {
    controller.state.src = '';
    controller.state.linkDraft = '';
    if (hadSrc || !controller.dom.childElementCount) {
      controller.render();
    } else {
      controller.updateEmptyState();
    }
    return;
  }

  const proxyDomURL = controller.config.proxyDomURL;
  if (!proxyDomURL) {
    controller.state.src = nextSrc;
    if (!hadSrc || !controller.imageElement) {
      controller.render();
    } else {
      controller.updateFilledImageState();
    }
    return;
  }

  const requestId = ++controller.proxyRequestId;
  const proxiedURL = proxyDomURL(nextSrc);
  if (typeof proxiedURL === 'string') {
    controller.state.src = proxiedURL;
    if (!hadSrc || !controller.imageElement) {
      controller.render();
    } else {
      controller.updateFilledImageState();
    }
    return;
  }

  Promise.resolve(proxiedURL)
    .then((url) => {
      if (requestId !== controller.proxyRequestId) {
        return;
      }
      controller.state.src = url;
      if (!hadSrc || !controller.imageElement) {
        controller.render();
      } else {
        controller.updateFilledImageState();
      }
    })
    .catch(() => {
      if (requestId !== controller.proxyRequestId) {
        return;
      }
      controller.state.src = nextSrc;
      if (!hadSrc || !controller.imageElement) {
        controller.render();
      } else {
        controller.updateFilledImageState();
      }
    });
}
