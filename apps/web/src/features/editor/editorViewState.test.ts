import { describe, expect, it } from 'vitest';
import { applyEditorViewAction, getEffectiveEditorViewState, initialEditorViewState } from './editorViewState';

describe('editorViewState', () => {
  it('preserves the prior content mode while focus hides only the left sidebar', () => {
    const reading = applyEditorViewAction(initialEditorViewState, 'mode-read');
    const focused = applyEditorViewAction(reading, 'mode-focus');
    expect(focused.modeBeforeFocus).toBe('read');
    expect(getEffectiveEditorViewState(focused)).toMatchObject({
      mode: 'focus',
      contentMode: 'read',
      showLeftSidebar: false,
      showRightSidebar: false
    });
    expect(applyEditorViewAction(focused, 'toggle-focus').mode).toBe('read');
  });

  it('switches source editing back to the edit business mode', () => {
    const reading = applyEditorViewAction(initialEditorViewState, 'mode-read');
    expect(applyEditorViewAction(reading, 'toggle-source-editor')).toMatchObject({
      mode: 'edit',
      modeBeforeFocus: null,
      showSourceEditor: true
    });

    const focusedReading = applyEditorViewAction(reading, 'mode-focus');
    expect(applyEditorViewAction(focusedReading, 'toggle-source-editor')).toMatchObject({
      mode: 'focus',
      modeBeforeFocus: 'edit',
      showSourceEditor: true
    });
  });

  it('keeps left sidebar preference underneath focus mode while right inspector stays independent', () => {
    const rightOpen = applyEditorViewAction(initialEditorViewState, 'toggle-right-sidebar');
    const focused = applyEditorViewAction(rightOpen, 'mode-focus');
    expect(getEffectiveEditorViewState(focused)).toMatchObject({
      showLeftSidebar: false,
      preferredShowLeftSidebar: true,
      showRightSidebar: true,
      preferredShowRightSidebar: true
    });

    const closedInFocus = applyEditorViewAction(focused, 'toggle-right-sidebar');
    expect(getEffectiveEditorViewState(closedInFocus).showRightSidebar).toBe(false);

    const reopenedInFocus = applyEditorViewAction(closedInFocus, 'toggle-right-sidebar');
    expect(getEffectiveEditorViewState(reopenedInFocus).showRightSidebar).toBe(true);

    const restored = applyEditorViewAction(reopenedInFocus, 'toggle-focus');
    expect(getEffectiveEditorViewState(restored)).toMatchObject({
      showLeftSidebar: true,
      showRightSidebar: true
    });
  });
});
