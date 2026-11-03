import { IMAGE_DATA_TYPE } from '@milkdown/kit/component/image-block';

import { applyPresetImageRatio } from './image-block-sizing.js';
import {
  createButton,
  IMAGE_PRESET_BUTTONS,
  IMAGE_RESIZE_CORNERS,
  preventDragStart,
  setSanitizedMarkup
} from './image-block-dom.js';

export function updateEmptyImageState(controller) {
  if (controller.emptyLinkInput instanceof HTMLInputElement) {
    controller.emptyLinkInput.value = controller.state.linkDraft;
    controller.emptyLinkInput.disabled = controller.state.readonly;
  }
}

export function updateImageToolbarState(controller) {
  if (!(controller.toolbarElement instanceof HTMLElement)) {
    return;
  }

  controller.toolbarElement.querySelectorAll('.image-preset-button').forEach((button) => {
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }
    const { preset } = button.dataset;
    const active = preset && Math.abs(controller.state.ratio - applyPresetImageRatio(preset)) < 0.02;
    if (active) {
      button.dataset.active = 'true';
    } else {
      delete button.dataset.active;
    }
  });

  if (controller.captionToggleButton instanceof HTMLButtonElement) {
    controller.captionToggleButton.textContent = controller.state.showCaption ? '隐藏说明' : '添加说明';
  }
}

export function updateImageCaptionVisibility(controller) {
  updateImageToolbarState(controller);
  if (!controller.state.src) {
    return;
  }

  if (controller.state.showCaption) {
    if (!(controller.captionInput instanceof HTMLInputElement)) {
      const captionInput = document.createElement('input');
      captionInput.className = 'caption-input';
      captionInput.placeholder = controller.config.captionPlaceholderText ?? '图片说明';
      preventDragStart(captionInput);
      captionInput.addEventListener('input', (event) => {
        controller.state.caption = event.target instanceof HTMLInputElement ? event.target.value : '';
      });
      captionInput.addEventListener('blur', (event) => {
        const nextValue = event.target instanceof HTMLInputElement ? event.target.value : '';
        controller.state.caption = nextValue;
        controller.setAttr('caption', nextValue);
      });
      controller.captionInput = captionInput;
    }
    controller.captionInput.value = controller.state.caption;
    if (controller.captionInput.parentElement !== controller.dom) {
      controller.dom.appendChild(controller.captionInput);
    }
    return;
  }

  controller.captionInput?.remove();
}

export function updateFilledImageState(controller) {
  if (!(controller.imageElement instanceof HTMLImageElement)) {
    return;
  }

  if (controller.imageElement.src !== controller.state.src) {
    controller.imageElement.src = controller.state.src;
  }
  controller.imageElement.alt = controller.state.caption;
  controller.applyImageLayout();
  controller.scheduleLayoutRefresh();
  updateImageCaptionVisibility(controller);
}

export function renderEmptyImageState(controller) {
  const panel = document.createElement('div');
  panel.className = 'image-edit';

  const icon = document.createElement('span');
  icon.className = 'image-icon';
  setSanitizedMarkup(icon, controller.config.imageIcon);

  const importer = document.createElement('div');
  importer.className = 'link-importer';

  const input = document.createElement('input');
  input.className = 'link-input-area';
  input.disabled = controller.state.readonly;
  input.placeholder = '粘贴图片链接';
  input.value = controller.state.linkDraft;
  controller.emptyLinkInput = input;
  preventDragStart(input);
  input.addEventListener('input', (event) => {
    const value = event.target instanceof HTMLInputElement ? event.target.value : '';
    controller.state.linkDraft = value;
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    const value = input.value.trim();
    if (!value) {
      return;
    }
    controller.setAttr('src', value);
  });

  const placeholder = document.createElement('div');
  placeholder.className = 'placeholder';
  const fileInput = document.createElement('input');
  const inputId = `image-upload-${Math.random().toString(36).slice(2, 9)}`;
  fileInput.id = inputId;
  fileInput.className = 'hidden';
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.disabled = controller.state.readonly;
  fileInput.addEventListener('change', async (event) => {
    const target = event.target instanceof HTMLInputElement ? event.target : null;
    const file = target?.files?.[0];
    if (!file) {
      return;
    }

    const url = await controller.config.onUpload(file);
    if (!url) {
      return;
    }

    controller.setAttr('src', url);
  });

  const uploadButton = document.createElement('label');
  uploadButton.className = 'uploader';
  uploadButton.htmlFor = inputId;
  setSanitizedMarkup(uploadButton, controller.config.uploadButton);

  const helperText = document.createElement('span');
  helperText.className = 'text';
  helperText.textContent = controller.config.uploadPlaceholderText ?? '或选择本地图片';

  placeholder.append(fileInput, uploadButton, helperText);
  importer.append(input, placeholder);

  const confirm = createButton({
    className: 'confirm',
    title: '插入图片链接',
    onClick: () => {
      const value = input.value.trim();
      if (!value) {
        return;
      }
      controller.setAttr('src', value);
    }
  });
  setSanitizedMarkup(confirm, controller.config.confirmButton);
  confirm.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    event.preventDefault();
    const value = input.value.trim();
    if (!value) {
      return;
    }
    controller.setAttr('src', value);
  });

  panel.append(icon, importer, confirm);
  controller.dom.appendChild(panel);
}

export function renderFilledImageState(controller) {
  const wrapper = document.createElement('div');
  wrapper.className = 'image-wrapper';

  const stage = document.createElement('div');
  stage.className = 'image-stage';
  if (controller.dom.dataset.attachmentId) {
    stage.dataset.attachmentId = controller.dom.dataset.attachmentId;
  }

  const image = document.createElement('img');
  image.dataset.type = IMAGE_DATA_TYPE;
  if (controller.dom.dataset.attachmentId) {
    image.dataset.attachmentId = controller.dom.dataset.attachmentId;
  }
  image.addEventListener('load', () => {
    controller.applyImageLayout();
    controller.scheduleLayoutRefresh();
  });
  image.addEventListener('error', (event) => {
    Promise.resolve(controller.config.onImageLoadError?.(event)).catch(() => {});
  });
  image.alt = controller.state.caption;
  image.src = controller.state.src;
  controller.imageElement = image;

  const toolbar = document.createElement('div');
  toolbar.className = 'image-toolbar';
  controller.toolbarElement = toolbar;
  IMAGE_PRESET_BUTTONS.forEach(({ key, label }) => {
    const button = createButton({
      className: 'image-preset-button',
      text: label,
      title: `${label}尺寸`,
      onClick: () => controller.handlePresetRatio(key)
    });
    button.dataset.preset = key;
    if (Math.abs(controller.state.ratio - applyPresetImageRatio(key)) < 0.02) {
      button.dataset.active = 'true';
    }
    toolbar.appendChild(button);
  });
  controller.captionToggleButton = createButton({
    className: 'image-toolbar-button',
    text: controller.state.showCaption ? '隐藏说明' : '添加说明',
    title: '切换图片说明',
    onClick: () => controller.toggleCaption()
  });
  toolbar.appendChild(controller.captionToggleButton);

  stage.append(toolbar, image);
  IMAGE_RESIZE_CORNERS.forEach((corner) => {
    const handle = createButton({
      className: 'milkdown-resize-handle image-resize-handle',
      title: '缩放图片'
    });
    handle.dataset.side = corner;
    handle.addEventListener('pointerdown', (event) => controller.startCornerResize(event, corner));
    stage.appendChild(handle);
  });

  wrapper.append(stage);
  controller.dom.appendChild(wrapper);
  updateImageCaptionVisibility(controller);
  controller.scheduleLayoutRefresh();
}
