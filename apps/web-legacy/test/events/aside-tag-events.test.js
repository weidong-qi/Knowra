import assert from 'node:assert/strict';
import { bindAsideContentClickEvents } from '../../lib/events/aside-events/click.js';
import { bindAsideContentFormEvents } from '../../lib/events/aside-events/forms.js';
import { bindAsideContentInputEvents } from '../../lib/events/aside-events/input.js';
import { bindAsideTabsEvents } from '../../lib/events/aside-events/tabs.js';
import { createRecorderElement } from '../_support/recorder-elements.js';

function makeTarget(selector, dataset = {}, value = '') {
  const target = { dataset, value };
  target.closest = (candidate) => candidate === selector ? target : null;
  return target;
}

{
  const asideContent = createRecorderElement();
  const state = { noteTagComposer: { draft: '', isExpanded: false } };
  const renderCalls = [];
  bindAsideContentClickEvents({
    state,
    elements: { asideContent },
    deps: {
      getCurrentNote: () => ({ id: 'note-1' }),
      renderSidebar: (...args) => renderCalls.push(args)
    }
  });

  asideContent.dispatch('click', makeTarget('[data-note-tag-toggle]'));
  assert.equal(state.noteTagComposer.isExpanded, true);
  assert.deepEqual(renderCalls.at(-1), [
    { id: 'note-1' },
    { selector: '[data-note-tag-input]' }
  ]);

  asideContent.dispatch('click', makeTarget('[data-note-tag-toggle]'));
  assert.equal(state.noteTagComposer.isExpanded, false);
  assert.deepEqual(renderCalls.at(-1), [
    { id: 'note-1' },
    { selector: '[data-note-tag-toggle]' }
  ]);
}

{
  const asideContent = createRecorderElement();
  const state = { noteTagComposer: { draft: '', isExpanded: true } };
  const focusRequests = [];
  bindAsideContentClickEvents({
    state,
    elements: { asideContent },
    deps: {
      getCurrentNote: () => ({ id: 'note-1' }),
      addTagToCurrentNote: async () => true,
      removeTagFromCurrentNote: async () => true,
      renderSidebar: (_note, focusRequest) => focusRequests.push(focusRequest)
    }
  });

  asideContent.dispatch('click', makeTarget('[data-note-tag-add]', { noteTagAdd: 'tag-1' }));
  await Promise.resolve();
  asideContent.dispatch('click', makeTarget('[data-note-tag-remove]', { noteTagRemove: 'tag-1' }));
  await Promise.resolve();
  assert.deepEqual(focusRequests, [
    { selector: '[data-note-tag-input]' },
    { selector: '[data-note-tag-input]' }
  ]);
}

{
  const asideContent = createRecorderElement();
  const state = { noteTagComposer: { draft: '', isExpanded: false } };
  const calls = [];
  bindAsideContentClickEvents({
    state,
    elements: { asideContent },
    deps: {
      toggleOutlineHeading: (...args) => calls.push(['toggle', ...args]),
      jumpToOutlineHeading: (...args) => calls.push(['jump', ...args])
    }
  });

  asideContent.dispatch('click', makeTarget('[data-outline-toggle-id]', {
    outlineToggleId: 'intro',
    outlineNoteId: 'note-1'
  }));
  asideContent.dispatch('click', makeTarget('[data-outline-id]', {
    outlineId: 'child',
    outlineIndex: '3'
  }));

  assert.deepEqual(calls, [
    ['toggle', 'note-1', 'intro'],
    ['jump', 'child', 3]
  ]);
}

{
  const asideContent = createRecorderElement();
  let draft = '';
  bindAsideContentInputEvents({
    elements: { asideContent },
    deps: { updateNoteTagDraft: (value) => { draft = value; } }
  });

  asideContent.dispatch('input', makeTarget('[data-note-tag-input]', {}, '知识管理'));
  assert.equal(draft, '知识管理');
}

{
  const asideContent = createRecorderElement();
  let updateCount = 0;
  bindAsideContentInputEvents({
    elements: { asideContent },
    deps: { updateNoteTagDraft: () => { updateCount += 1; } }
  });

  asideContent.dispatch('input', makeTarget('[data-note-tag-input]', {}, 'duomotai'), {
    isComposing: true
  });
  asideContent.dispatch('input', makeTarget('[data-note-tag-input]', {}, '多模态'));

  assert.equal(updateCount, 1);
}

{
  const asideContent = createRecorderElement();
  const state = { noteTagComposer: { draft: '新标签', isExpanded: true } };
  let created = '';
  let prevented = false;
  bindAsideContentFormEvents({
    state,
    elements: { asideContent },
    deps: { createTagAndAssignToCurrentNote: async (value) => { created = value; } }
  });

  asideContent.dispatch('keydown', makeTarget('[data-note-tag-input]'), {
    key: 'Enter',
    isComposing: false,
    preventDefault: () => { prevented = true; }
  });
  assert.equal(prevented, true);
  assert.equal(created, '新标签');
}

{
  const asideContent = createRecorderElement();
  const state = { noteTagComposer: { draft: '多模态', isExpanded: true } };
  let created = false;
  bindAsideContentFormEvents({
    state,
    elements: { asideContent },
    deps: { createTagAndAssignToCurrentNote: async () => { created = true; } }
  });

  asideContent.dispatch('keydown', makeTarget('[data-note-tag-input]'), {
    key: 'Enter',
    keyCode: 229
  });

  assert.equal(created, false);
}

console.log('ok - aside tag events expand, update and submit the tag composer');

{
  const asideTabs = createRecorderElement();
  const focused = [];
  const tabs = ['info', 'outline', 'concepts', 'ai'].map((asideTab) => ({
    dataset: { asideTab },
    focus: () => focused.push(asideTab),
    closest: (selector) => selector === '[data-aside-tab]' ? tabs.find((tab) => tab.dataset.asideTab === asideTab) : null
  }));
  asideTabs.querySelectorAll = () => tabs;
  asideTabs.querySelector = (selector) => tabs.find((tab) => selector.includes(tab.dataset.asideTab));
  const state = { asideTab: 'info' };
  let rendered = 0;
  bindAsideTabsEvents({
    state,
    elements: { asideTabs },
    deps: { getCurrentNote: () => ({ id: 'note-1' }), renderSidebar: () => { rendered += 1; } }
  });
  let prevented = false;
  asideTabs.dispatch('keydown', tabs[0], { key: 'ArrowRight', preventDefault: () => { prevented = true; } });
  assert.equal(state.asideTab, 'outline');
  assert.equal(rendered, 1);
  assert.equal(prevented, true);
  assert.deepEqual(focused, ['outline']);
}

{
  const asideContent = createRecorderElement();
  const calls = [];
  bindAsideContentClickEvents({
    state: { noteTagComposer: { draft: '', isExpanded: false } },
    elements: { asideContent },
    deps: { cancelAttachmentRename: () => calls.push('cancel') }
  });
  bindAsideContentInputEvents({
    elements: { asideContent },
    deps: { updateAttachmentRenameDraft: (value) => calls.push(['draft', value]) }
  });
  asideContent.dispatch('click', makeTarget('[data-attachment-rename-cancel]'));
  asideContent.dispatch('input', makeTarget('[data-attachment-rename-input]', {}, 'new-name'));
  assert.deepEqual(calls, ['cancel', ['draft', 'new-name']]);
}

{
  const asideContent = createRecorderElement();
  let submitted = null;
  let prevented = false;
  const input = { value: 'renamed' };
  const form = makeTarget('[data-attachment-rename-form]', { attachmentRenameForm: 'attachment-1' });
  form.querySelector = () => input;
  bindAsideContentFormEvents({
    state: { noteTagComposer: { draft: '' } },
    elements: { asideContent },
    deps: { submitAttachmentRename: (...args) => { submitted = args; } }
  });
  asideContent.dispatch('submit', form, { preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(submitted, ['attachment-1', 'renamed']);
}
