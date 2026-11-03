import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const source = fs.readFileSync(
  path.resolve(__dirname, '../../src/controllers/editor/render-controller.js'),
  'utf8'
);
const hostSource = fs.readFileSync(
  path.resolve(__dirname, '../../src/controllers/editor/host-controller.js'),
  'utf8'
);

assert.match(
  source,
  /if \(state\.view\?\.screen && state\.view\.screen !== 'editor'\) \{[\s\S]*teardownEditorHost\(\)[\s\S]*return;/,
  'home and index screens must not mount an editor from an unloaded summary body'
);

assert.match(
  hostSource,
  /pendingEditorNoteId === noteId[\s\S]*pendingEditorMarkdown === markdown/,
  'an in-flight empty mount must not block a full-body mount for the same note'
);

assert.match(
  hostSource,
  /function handleEditorMarkdownChange\(markdown\) \{[\s\S]*currentEditorMarkdown = markdown;[\s\S]*if \(markdown === state\.draftMarkdown\) \{[\s\S]*return;[\s\S]*scheduleAutosave\(\)/,
  'identical initial editor content must not schedule an autosave'
);

assert.match(
  source,
  /currentEditorMarkdown:\s*editorRuntime\.currentEditorMarkdown,[\s\S]*draftMarkdown:\s*state\.draftMarkdown/,
  'editor reuse decisions must compare the mounted markdown with the current full draft'
);

console.log('ok - editor rendering guards summary screens and forwards markdown identity');
