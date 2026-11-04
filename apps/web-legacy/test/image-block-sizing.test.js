import assert from 'node:assert/strict';

import {
  applyPresetImageRatio,
  clampImageRatio,
  computeFittedImageDimensions,
  computeResizeRatioFromCornerDrag,
  resolveImageContainerWidth
} from '../lib/editor/image-block-sizing.js';

const largeImageDimensions = computeFittedImageDimensions({
  naturalWidth: 3200,
  naturalHeight: 1800,
  containerWidth: 840
});

assert.equal(
  largeImageDimensions.width,
  840,
  'very large pasted images should initially fit inside the editor width'
);

assert.equal(
  largeImageDimensions.height,
  472.5,
  'initial fitted height should preserve the original aspect ratio'
);

assert.equal(
  largeImageDimensions.maxRatio,
  1,
  'images that already need fit-to-editor scaling should not be enlargable beyond the editor width'
);

const scaledDimensions = computeFittedImageDimensions({
  naturalWidth: 1600,
  naturalHeight: 900,
  containerWidth: 800,
  ratio: 0.5
});

assert.equal(
  scaledDimensions.width,
  400,
  'stored image ratio should scale width proportionally from the fitted baseline'
);

assert.equal(
  scaledDimensions.height,
  225,
  'stored image ratio should scale height proportionally from the fitted baseline'
);

const smallImageDimensions = computeFittedImageDimensions({
  naturalWidth: 400,
  naturalHeight: 240,
  containerWidth: 800
});

assert.equal(
  smallImageDimensions.maxRatio,
  2,
  'small images should still be allowed to grow up to the fitted editor width'
);

assert.equal(
  resolveImageContainerWidth({
    blockWidth: 1680,
    parentWidth: 920,
    editorWidth: 920,
    fallbackWidth: 640
  }),
  920,
  'image fitting should prefer the stable editor width instead of a block width already stretched by oversized content'
);

assert.equal(
  resolveImageContainerWidth({
    blockWidth: 0,
    parentWidth: 0,
    editorWidth: 0,
    fallbackWidth: 640
  }),
  640,
  'image fitting should fall back to the configured max width when runtime measurements are unavailable'
);

assert.equal(
  clampImageRatio(0.02),
  0.1,
  'image ratio should clamp to a safe minimum so images do not collapse'
);

assert.equal(
  applyPresetImageRatio('fit'),
  1,
  'fit preset should map to the baseline fitted width'
);

assert.equal(
  applyPresetImageRatio('medium'),
  0.66,
  'medium preset should use the shared proportional ratio'
);

assert.equal(
  computeResizeRatioFromCornerDrag({
    startWidth: 600,
    startHeight: 400,
    dx: 120,
    dy: 40,
    corner: 'se'
  }),
  1.2,
  'dragging a corner should resize proportionally using the dominant axis delta'
);

assert.equal(
  computeResizeRatioFromCornerDrag({
    startWidth: 600,
    startHeight: 400,
    dx: 480,
    dy: 320,
    corner: 'nw'
  }),
  0.2,
  'corner dragging should clamp to the minimum proportional resize ratio'
);

console.log('ok - image sizing helpers keep pasted images fitted and proportional');
