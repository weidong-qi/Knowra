import assert from 'node:assert/strict';
import * as components from '../lib/components/index.js';

const PRESENTATIONAL_NAMES = [
  'renderIcon',
  'renderModuleRail',
  'renderFunctionNavigation',
  'renderNavigationSection',
  'renderContextMenuItems',
  'renderSectionMenuItems',
  'renderEditorMenuBarMarkup',
  'renderNoteTabs',
  'renderEmptyNoteTabs',
  'renderTabOverflowToggle',
  'renderNoteTabMenuItems',
  'renderEditorContextMenuMarkup',
  'renderEditorDocumentHead',
  'renderEditorPanelMarkup',
  'renderTableInsertDialogMarkup',
  'renderPreviewPane',
  'renderAsideTabs',
  'renderTagPills',
  'renderLinkedNotes',
  'renderAttachments',
  'renderLibraryIndexContent',
  'renderLibraryPagination',
  'renderHomeWorkspace',
  'renderWorkDomainShell',
  'renderSearchShell',
  'renderStatusIndicators',
  'renderTagList'
];

for (const name of PRESENTATIONAL_NAMES) {
  assert.equal(
    typeof components[name],
    'function',
    `components index should export ${name}`
  );
}

const names = Object.keys(components).filter((key) => key.startsWith('render'));
assert.ok(
  names.length >= PRESENTATIONAL_NAMES.length,
  'catalog should expose render functions'
);
assert.equal(new Set(names).size, names.length, 'no duplicate export names');

console.log('ok - components index re-exports the presentational component catalog');
