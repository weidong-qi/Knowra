import {
  applyPresetImageRatio,
  clampImageRatio,
  computeFittedImageDimensions,
  computeResizeRatioFromCornerDrag,
  resolveImageContainerWidth
} from './image-block-sizing.js';

export function getImageContainerWidth(controller) {
  const blockWidth = Math.round(controller.dom.getBoundingClientRect().width);
  const parentWidth = Math.round(
    controller.dom.parentElement?.clientWidth
      ?? controller.dom.parentElement?.getBoundingClientRect().width
      ?? 0
  );
  const editorWidth = Math.round(controller.dom.closest('.ProseMirror')?.clientWidth ?? 0);

  return resolveImageContainerWidth({
    blockWidth,
    parentWidth,
    editorWidth,
    fallbackWidth: controller.config.maxWidth ?? 0
  });
}

export function getImageLayout(controller, ratio = controller.state.ratio) {
  const image = controller.imageElement;
  if (!(image instanceof HTMLImageElement) || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
    return null;
  }

  const baselineLayout = computeFittedImageDimensions({
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
    containerWidth: getImageContainerWidth(controller),
    ratio: 1,
    maxWidth: controller.config.maxWidth
  });

  return computeFittedImageDimensions({
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
    containerWidth: getImageContainerWidth(controller),
    ratio,
    maxWidth: controller.config.maxWidth,
    maxRatio: baselineLayout.maxRatio
  });
}

export function applyImageLayout(controller, ratio = controller.state.ratio) {
  const image = controller.imageElement;
  if (!(image instanceof HTMLImageElement)) {
    return;
  }

  const layout = getImageLayout(controller, ratio);
  if (!layout) {
    return;
  }

  image.dataset.originWidth = String(layout.baselineWidth);
  image.dataset.originHeight = String(layout.baselineHeight);
  image.dataset.currentRatio = String(layout.ratio);
  image.dataset.maxRatio = String(layout.maxRatio);
  image.style.width = `${layout.width}px`;
  image.style.height = `${layout.height}px`;
  image.style.maxWidth = '100%';
}

export function applyImagePresetRatio(controller, presetKey) {
  const layout = getImageLayout(controller, 1);
  if (!layout) {
    return;
  }

  const nextRatio = clampImageRatio(applyPresetImageRatio(presetKey), { max: layout.maxRatio });
  controller.state.ratio = nextRatio;
  applyImageLayout(controller, nextRatio);
  controller.setAttr('ratio', nextRatio);
}

export function startImageCornerResize(controller, event, corner) {
  if (controller.state.readonly || !(controller.imageElement instanceof HTMLImageElement)) {
    return;
  }

  const layout = getImageLayout(controller);
  if (!layout) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  controller.activeResize = {
    corner,
    startX: event.clientX,
    startY: event.clientY,
    startWidth: layout.width,
    startHeight: layout.height,
    maxRatio: layout.maxRatio
  };
  window.addEventListener('pointermove', controller.onPointerMove);
  window.addEventListener('pointerup', controller.onPointerUp);
  window.addEventListener('pointercancel', controller.onPointerUp);
}

export function updateImageCornerResize(controller, event) {
  if (!controller.activeResize) {
    return;
  }

  const nextRatio = clampImageRatio(
    computeResizeRatioFromCornerDrag({
      startWidth: controller.activeResize.startWidth,
      startHeight: controller.activeResize.startHeight,
      dx: event.clientX - controller.activeResize.startX,
      dy: event.clientY - controller.activeResize.startY,
      corner: controller.activeResize.corner
    }),
    { max: controller.activeResize.maxRatio }
  );

  controller.state.ratio = nextRatio;
  applyImageLayout(controller, nextRatio);
}

export function finishImageCornerResize(controller) {
  window.removeEventListener('pointermove', controller.onPointerMove);
  window.removeEventListener('pointerup', controller.onPointerUp);
  window.removeEventListener('pointercancel', controller.onPointerUp);

  if (!controller.activeResize) {
    return;
  }

  controller.setAttr('ratio', controller.state.ratio);
  controller.activeResize = null;
}
