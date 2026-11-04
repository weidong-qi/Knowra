import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeNotes } from '../lib/workspace-normalization.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceControllerJs = fs.readFileSync(
  path.resolve(__dirname, '../src/controllers/workspace-controller.js'),
  'utf8'
);
const menuRenderersJs = fs.readFileSync(path.resolve(__dirname, '../lib/editor/menu-renderers.js'), 'utf8');
const navigationTreeRenderersJs = fs.readFileSync(
  path.resolve(__dirname, '../lib/navigation/tree-renderers.js'),
  'utf8'
);
const navigationContextMenuJs = fs.readFileSync(
  path.resolve(__dirname, '../lib/navigation/context-menu.js'),
  'utf8'
);

assert.match(
  menuRenderersJs,
  /data-file-menu-action="favorite-note"/,
  'file menu should expose a favorite note action'
);
assert.match(
  menuRenderersJs,
  /data-file-menu-action="delete-note"/,
  'file menu should expose a delete note action'
);
assert.match(
  menuRenderersJs,
  /data-file-menu-action="restore-note"/,
  'file menu should expose a restore note action for deleted notes'
);
assert.match(
  navigationContextMenuJs,
  /action: 'favorite-note'/,
  'note context menu should expose a favorite note action'
);
assert.match(
  navigationContextMenuJs,
  /action: 'restore-note'/,
  'note context menu should expose a restore note action'
);
assert.match(
  navigationContextMenuJs,
  /action: 'permanently-delete-note'/,
  'recycle note context menu should expose a permanent delete action'
);
assert.match(
  navigationContextMenuJs,
  /action: 'empty-recycle-bin'/,
  'recycle section context menu should expose an empty recycle bin action'
);
assert.match(
  navigationTreeRenderersJs,
  /data-recycle-note-id=/,
  'recycle bin should render deleted notes as dedicated targets'
);
assert.match(
  navigationTreeRenderersJs,
  /data-recycle-section="true"/,
  'recycle section should render a dedicated target for section-level context menu actions'
);
assert.equal(
  normalizeNotes([{ id: 'deleted-note', deleted: true }])[0].deleted,
  true,
  'note normalization should preserve deleted state through shared web-core'
);
assert.match(
  workspaceControllerJs,
  /knowledgeApi\.loadWorkspaceResources\(spaceId\)/,
  'workspace refresh should load backend workspace resources through the API service'
);

console.log('ok - v1.3.6 note action hooks are present');
