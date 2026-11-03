import DOMPurify from 'dompurify';

export const IMAGE_PRESET_BUTTONS = [
  { key: 'small', label: '小' },
  { key: 'medium', label: '中' },
  { key: 'large', label: '大' },
  { key: 'fit', label: '适配' }
];

export const IMAGE_RESIZE_CORNERS = ['nw', 'ne', 'sw', 'se'];

export function setSanitizedMarkup(node, markup) {
  if (!(node instanceof HTMLElement)) {
    return;
  }

  node.innerHTML = markup ? DOMPurify.sanitize(String(markup).trim()) : '';
}

export function createButton({ className = '', text = '', title = '', onClick = null } = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  if (className) {
    button.className = className;
  }
  if (text) {
    button.textContent = text;
  }
  if (title) {
    button.title = title;
    button.setAttribute('aria-label', title);
  }
  if (typeof onClick === 'function') {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick(event);
    });
  }
  button.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
  });
  return button;
}

export function preventDragStart(node) {
  node?.addEventListener('dragstart', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
}
