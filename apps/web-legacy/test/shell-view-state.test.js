import assert from 'node:assert/strict';
import { getEffectiveViewState } from '../lib/shell/view-state.js';

assert.deepEqual(
  getEffectiveViewState({
    mode: 'default',
    showLeftSidebar: true,
    showRightSidebar: false,
    showSourceEditor: true
  }),
  {
    mode: 'default',
    contentMode: 'edit',
    showLeftSidebar: true,
    showRightSidebar: false,
    showSourceEditor: true
  }
);

assert.deepEqual(
  getEffectiveViewState({
    mode: 'focus',
    modeBeforeFocus: 'edit',
    showLeftSidebar: true,
    showRightSidebar: true,
    showSourceEditor: false
  }),
  {
    mode: 'focus',
    contentMode: 'edit',
    showLeftSidebar: false,
    showRightSidebar: false,
    showSourceEditor: false
  },
  'focus mode should force both sidebars off without changing source editor state'
);

assert.deepEqual(
  getEffectiveViewState({
    mode: 'focus',
    modeBeforeFocus: 'read',
    showLeftSidebar: false,
    showRightSidebar: true,
    showSourceEditor: false
  }),
  {
    mode: 'focus',
    contentMode: 'read',
    showLeftSidebar: false,
    showRightSidebar: false,
    showSourceEditor: false
  },
  'focus mode should preserve the preceding read-only content mode'
);

console.log('ok - shell view state derives effective workspace visibility');
