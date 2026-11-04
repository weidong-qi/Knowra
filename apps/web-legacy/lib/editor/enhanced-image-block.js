import {
  imageBlockConfig,
  imageBlockSchema,
  remarkImageBlockPlugin
} from '@milkdown/kit/component/image-block';
import { $view } from '@milkdown/kit/utils';

import {
  applyImageLayout,
  applyImagePresetRatio,
  finishImageCornerResize,
  getImageContainerWidth,
  getImageLayout,
  startImageCornerResize,
  updateImageCornerResize
} from './image-block-resize.js';

import {
  renderEmptyImageState,
  renderFilledImageState,
  updateEmptyImageState,
  updateFilledImageState,
  updateImageCaptionVisibility,
  updateImageToolbarState
} from './image-block-renderers.js';
import {
  bindImageBlockAttrs,
  createImageBlockState,
  getImageBlockConfig,
  setImageBlockAttr
} from './image-block-attrs.js';

class EnhancedImageBlockController {
  constructor(ctx, view, getPos, initialNode) {
    this.ctx = ctx;
    this.view = view;
    this.getPos = getPos;
    this.config = getImageBlockConfig(ctx);
    this.dom = document.createElement('div');
    this.dom.className = 'milkdown-image-block';
    this.state = createImageBlockState(view);
    this.imageElement = null;
    this.toolbarElement = null;
    this.captionToggleButton = null;
    this.captionInput = null;
    this.emptyLinkInput = null;
    this.activeResize = null;
    this.proxyRequestId = 0;
    this.layoutRefreshFrame = 0;

    this.bindAttrs(initialNode);
  }

  setAttr(attr, value) {
    setImageBlockAttr(this, attr, value);
  }

  setSelected(selected) {
    this.state.selected = selected;
    this.dom.classList.toggle('selected', selected);
  }

  bindAttrs(node) {
    bindImageBlockAttrs(this, node);
  }

  getContainerWidth() {
    return getImageContainerWidth(this);
  }

  getImageLayout(ratio = this.state.ratio) {
    return getImageLayout(this, ratio);
  }

  applyImageLayout(ratio = this.state.ratio) {
    applyImageLayout(this, ratio);
  }

  scheduleLayoutRefresh() {
    if (this.layoutRefreshFrame) {
      window.cancelAnimationFrame(this.layoutRefreshFrame);
    }

    this.layoutRefreshFrame = window.requestAnimationFrame(() => {
      this.layoutRefreshFrame = 0;
      this.applyImageLayout();
    });
  }

  handlePresetRatio(presetKey) {
    applyImagePresetRatio(this, presetKey);
  }

  startCornerResize(event, corner) {
    startImageCornerResize(this, event, corner);
  }

  onPointerMove = (event) => {
    updateImageCornerResize(this, event);
  };

  onPointerUp = () => {
    finishImageCornerResize(this);
  };

  toggleCaption() {
    this.state.showCaption = !this.state.showCaption;
    this.updateCaptionVisibility();
  }

  updateEmptyState() {
    updateEmptyImageState(this);
  }

  updateToolbarState() {
    updateImageToolbarState(this);
  }

  updateCaptionVisibility() {
    updateImageCaptionVisibility(this);
  }

  updateFilledImageState() {
    updateFilledImageState(this);
  }

  renderEmptyState() {
    renderEmptyImageState(this);
  }

  renderFilledState() {
    renderFilledImageState(this);
  }

  render() {
    this.dom.replaceChildren();
    this.dom.classList.toggle('selected', this.state.selected);
    this.dom.dataset.imageReady = this.state.src ? 'true' : 'false';

    if (!this.state.src) {
      this.imageElement = null;
      this.renderEmptyState();
      return;
    }

    this.renderFilledState();
  }

  stopEvent(event) {
    const target = event.target;
    return (
      target instanceof HTMLInputElement
      || target instanceof HTMLButtonElement
      || target instanceof HTMLLabelElement
      || target instanceof HTMLTextAreaElement
    );
  }

  destroy() {
    if (this.layoutRefreshFrame) {
      window.cancelAnimationFrame(this.layoutRefreshFrame);
      this.layoutRefreshFrame = 0;
    }
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    this.activeResize = null;
    this.emptyLinkInput = null;
    this.captionInput = null;
    this.captionToggleButton = null;
    this.toolbarElement = null;
    this.imageElement = null;
    this.dom.remove();
  }
}

export const enhancedImageBlockView = $view(imageBlockSchema.node, (ctx) => {
  return (initialNode, view, getPos) => {
    const controller = new EnhancedImageBlockController(ctx, view, getPos, initialNode);

    return {
      dom: controller.dom,
      update: (updatedNode) => {
        if (updatedNode.type !== initialNode.type) {
          return false;
        }

        controller.bindAttrs(updatedNode);
        return true;
      },
      stopEvent: (event) => controller.stopEvent(event),
      selectNode: () => {
        controller.setSelected(true);
      },
      deselectNode: () => {
        controller.setSelected(false);
      },
      destroy: () => {
        controller.destroy();
      }
    };
  };
});

export const enhancedImageBlockComponent = [
  remarkImageBlockPlugin,
  imageBlockSchema,
  enhancedImageBlockView,
  imageBlockConfig
].flat();
