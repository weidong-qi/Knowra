import { renderIcon } from '../../../icons/icon-map.js';

const TABLE_ICON_NAMES = Object.freeze({
  add_row: 'tableAddRow',
  add_col: 'tableAddCol',
  add_row_before: 'tableAddRowBefore',
  add_row_after: 'tableAddRowAfter',
  add_col_before: 'tableAddColBefore',
  add_col_after: 'tableAddColAfter',
  delete_row: 'tableDeleteRow',
  delete_col: 'tableDeleteCol',
  align_col_left: 'tableAlignLeft',
  align_col_center: 'tableAlignCenter',
  align_col_right: 'tableAlignRight',
  col_drag_handle: 'tableColumnDrag',
  row_drag_handle: 'tableRowDrag'
});

export function renderTableButton(renderType) {
  const iconName = TABLE_ICON_NAMES[renderType];
  return iconName
    ? renderIcon(iconName, { className: 'milkdown-table-icon' })
    : '';
}

function createTableHandleActionButton({ action, icon, label, onActivate }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.tablePinnedAction = action;
  if (action === 'table-delete-row' || action === 'table-delete-col') {
    button.dataset.tablePinnedDanger = 'true';
  }
  button.innerHTML = renderTableButton(icon);
  button.setAttribute('title', label);
  button.setAttribute('aria-label', label);
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (button.disabled || button.getAttribute('aria-disabled') === 'true') {
      return;
    }
    void onActivate?.();
  });
  return button;
}

function ensureTablePinnedButtons(group, descriptors, onActivate) {
  if (!(group instanceof HTMLElement)) {
    return;
  }

  descriptors
    .slice()
    .reverse()
    .forEach((descriptor) => {
      const selector = `[data-table-pinned-action="${descriptor.action}"]`;
      if (group.querySelector(selector)) {
        return;
      }

      const button = createTableHandleActionButton({
        ...descriptor,
        onActivate: () => onActivate?.(descriptor)
      });
      group.prepend(button);
    });
}

export function syncTableHandleLabels(root, host = null) {
  if (!(root instanceof HTMLElement)) {
    return;
  }

  const setButtonLabel = (button, label) => {
    if (!(button instanceof HTMLElement)) {
      return;
    }

    button.setAttribute('title', label);
    button.setAttribute('aria-label', label);
  };

  const hideBuiltinDeleteButton = (button) => {
    if (!(button instanceof HTMLElement)) {
      return;
    }

    button.dataset.tableBuiltinDelete = 'true';
    button.tabIndex = -1;
    button.setAttribute('aria-hidden', 'true');
    button.style.display = 'none';
  };

  root.querySelectorAll('.milkdown-table-block').forEach((tableBlockRoot) => {
    const colHandle = tableBlockRoot.querySelector('[data-role="col-drag-handle"]');
    if (colHandle instanceof HTMLElement) {
      colHandle.setAttribute('title', '选中整列');
      colHandle.setAttribute('aria-label', '选中整列');
      const buttonGroup = colHandle.querySelector('.button-group');
      ensureTablePinnedButtons(
        buttonGroup,
        [
          { action: 'table-add-col-before', icon: 'add_col_before', label: '左侧插列', kind: 'col' },
          { action: 'table-add-col-after', icon: 'add_col_after', label: '右侧插列', kind: 'col' },
          { action: 'table-delete-col', icon: 'delete_col', label: '删除列', kind: 'col' }
        ],
        ({ action, kind }) => host?.tableHandleController?.runPinnedAction(kind, action)
      );
      const builtinButtons = Array.from(colHandle.querySelectorAll('.button-group button:not([data-table-pinned-action])'));
      setButtonLabel(builtinButtons[0], '左对齐');
      setButtonLabel(builtinButtons[1], '居中对齐');
      setButtonLabel(builtinButtons[2], '右对齐');
      setButtonLabel(builtinButtons[3], '删除列');
      hideBuiltinDeleteButton(builtinButtons[3]);
    }

    const rowHandle = tableBlockRoot.querySelector('[data-role="row-drag-handle"]');
    if (rowHandle instanceof HTMLElement) {
      rowHandle.setAttribute('title', '选中整行');
      rowHandle.setAttribute('aria-label', '选中整行');
      const buttonGroup = rowHandle.querySelector('.button-group');
      ensureTablePinnedButtons(
        buttonGroup,
        [
          { action: 'table-add-row-before', icon: 'add_row_before', label: '上方插行', kind: 'row' },
          { action: 'table-add-row-after', icon: 'add_row_after', label: '下方插行', kind: 'row' },
          { action: 'table-delete-row', icon: 'delete_row', label: '删除行', kind: 'row' }
        ],
        ({ action, kind }) => host?.tableHandleController?.runPinnedAction(kind, action)
      );
      const deleteButton = rowHandle.querySelector('.button-group button:not([data-table-pinned-action])');
      setButtonLabel(deleteButton, '删除行');
      hideBuiltinDeleteButton(deleteButton);
    }

    const xLineHandle = tableBlockRoot.querySelector('[data-role="x-line-drag-handle"]');
    if (xLineHandle instanceof HTMLElement) {
      xLineHandle.dataset.show = 'false';
    }

    const yLineHandle = tableBlockRoot.querySelector('[data-role="y-line-drag-handle"]');
    if (yLineHandle instanceof HTMLElement) {
      yLineHandle.dataset.show = 'false';
    }
  });
}

export function waitForNextFrame() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

export function setPinnedActionDisabled(button, disabled) {
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }

  button.disabled = disabled;
  button.setAttribute('aria-disabled', disabled ? 'true' : 'false');
}

