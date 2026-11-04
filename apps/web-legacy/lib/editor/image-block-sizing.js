const MIN_IMAGE_RATIO = 0.1;
const MAX_IMAGE_RATIO = 4;

const IMAGE_PRESET_RATIOS = {
  small: 0.4,
  medium: 0.66,
  large: 0.82,
  fit: 1
};

function roundDimension(value) {
  return Number(value.toFixed(2));
}

export function clampImageRatio(value, { min = MIN_IMAGE_RATIO, max = MAX_IMAGE_RATIO } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 1;
  }

  return roundDimension(Math.min(max, Math.max(min, parsed)));
}

export function applyPresetImageRatio(preset) {
  return IMAGE_PRESET_RATIOS[preset] ?? 1;
}

export function resolveImageContainerWidth({
  blockWidth = 0,
  parentWidth = 0,
  editorWidth = 0,
  fallbackWidth = 0
} = {}) {
  const safeBlockWidth = Number(blockWidth);
  const safeParentWidth = Number(parentWidth);
  const safeEditorWidth = Number(editorWidth);
  const safeFallbackWidth = Number(fallbackWidth);

  if (Number.isFinite(safeEditorWidth) && safeEditorWidth > 0) {
    if (Number.isFinite(safeParentWidth) && safeParentWidth > 0) {
      return Math.min(safeEditorWidth, safeParentWidth);
    }
    return safeEditorWidth;
  }

  if (Number.isFinite(safeParentWidth) && safeParentWidth > 0) {
    return safeParentWidth;
  }

  if (Number.isFinite(safeBlockWidth) && safeBlockWidth > 0) {
    return safeBlockWidth;
  }

  return Number.isFinite(safeFallbackWidth) && safeFallbackWidth > 0 ? safeFallbackWidth : 0;
}

export function computeFittedImageDimensions({
  naturalWidth,
  naturalHeight,
  containerWidth,
  ratio = 1,
  maxWidth = Number.POSITIVE_INFINITY,
  maxRatio = null
} = {}) {
  const width = Number(naturalWidth);
  const height = Number(naturalHeight);
  const availableWidth = Number(containerWidth);
  const cappedMaxWidth = Number(maxWidth);

  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    return { width: 0, height: 0, baselineWidth: 0, baselineHeight: 0, ratio: 1 };
  }

  const safeAvailableWidth = Number.isFinite(availableWidth) && availableWidth > 0 ? availableWidth : width;
  const safeMaxWidth = Number.isFinite(cappedMaxWidth) && cappedMaxWidth > 0 ? cappedMaxWidth : safeAvailableWidth;
  const baselineWidth = Math.min(width, safeAvailableWidth, safeMaxWidth);
  const baselineHeight = baselineWidth * (height / width);
  const computedMaxRatio = roundDimension(Math.max(1, safeAvailableWidth / baselineWidth));
  const safeMaxRatio = Number.isFinite(Number(maxRatio)) && Number(maxRatio) > 0 ? Number(maxRatio) : computedMaxRatio;
  const nextRatio = clampImageRatio(ratio, { max: safeMaxRatio });

  return {
    width: roundDimension(baselineWidth * nextRatio),
    height: roundDimension(baselineHeight * nextRatio),
    baselineWidth: roundDimension(baselineWidth),
    baselineHeight: roundDimension(baselineHeight),
    maxRatio: safeMaxRatio,
    ratio: nextRatio
  };
}

export function computeResizeRatioFromCornerDrag({
  startWidth,
  startHeight,
  dx = 0,
  dy = 0,
  corner = 'se'
} = {}) {
  const width = Number(startWidth);
  const height = Number(startHeight);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    return 1;
  }

  const horizontalDirection = corner.includes('w') ? -1 : 1;
  const verticalDirection = corner.includes('n') ? -1 : 1;
  const scaleFromWidth = (width + (Number(dx) * horizontalDirection)) / width;
  const scaleFromHeight = (height + (Number(dy) * verticalDirection)) / height;
  const nextScale =
    Math.abs(scaleFromWidth - 1) >= Math.abs(scaleFromHeight - 1) ? scaleFromWidth : scaleFromHeight;

  return clampImageRatio(nextScale);
}
