import assert from 'node:assert/strict';
import { assignWorkspaceElements, queryWorkspaceElements } from '../../src/app/element-cache.js';

const calls = [];
const documentRef = {
  getElementById(id) {
    calls.push(id);
    return { id };
  }
};

const elements = queryWorkspaceElements(documentRef);

assert.equal(elements.globalSearchShell.id, 'global-search-shell');
assert.equal(elements.moduleRail.id, 'module-rail');
assert.equal(elements.workspace.id, 'kb-workspace');
assert.equal(elements.folderTree.id, 'folder-tree');
assert.equal(elements.editorContent.id, 'editor-content');
assert.equal(elements.statusMeta.id, 'status-meta');
assert.ok(calls.includes('library-context-menu'));
assert.ok(calls.includes('markdown-import-input'));

const target = {};
assert.equal(assignWorkspaceElements(target, documentRef), target);
assert.equal(target.asideContent.id, 'aside-content');

console.log('element-cache tests passed');
