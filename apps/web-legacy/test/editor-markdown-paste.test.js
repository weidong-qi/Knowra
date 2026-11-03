import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const editCommandControllerJs = fs.readFileSync(path.resolve(__dirname, '../src/controllers/editor/commands/edit-command-controller.js'), 'utf8');
const milkdownEntry = fs.readFileSync(path.resolve(__dirname, '../lib/editor/milkdown-entry.js'), 'utf8');
const editorFactoryJs = fs.readFileSync(path.resolve(__dirname, '../lib/editor/milkdown/host/editor-factory.js'), 'utf8');
const markdownPastePluginJs = fs.readFileSync(path.resolve(__dirname, '../lib/editor/milkdown/plugins/markdown-paste-plugin.js'), 'utf8');
const markdownSliceJs = fs.readFileSync(path.resolve(__dirname, '../lib/editor/milkdown/utils/markdown-slice.js'), 'utf8');
const milkdownPasteJs = `${milkdownEntry}\n${editorFactoryJs}\n${markdownPastePluginJs}\n${markdownSliceJs}`;

assert.match(
  milkdownPasteJs,
  /import\s*\{[^}]*clipboard[^}]*\}\s*from '@milkdown\/kit\/plugin\/clipboard';/,
  'milkdown editor should enable the official clipboard plugin so plain-text paste can be parsed as Markdown'
);
assert.match(
  milkdownPasteJs,
  /\.use\(clipboard\)/,
  'milkdown editor should register clipboard handling in the editor pipeline'
);
assert.match(
  milkdownPasteJs,
  /\.use\(createMarkdownPasteBehavior\(host\)\)\s*\.use\(clipboard\)/,
  'plain-text Markdown paste should be handled before the official clipboard DOM round-trip'
);
assert.match(
  milkdownPasteJs,
  /handlePaste[\s\S]*parseMarkdownSlice\(ctx, text\)/,
  'native paste should use the direct Markdown fragment parser instead of the clipboard DOM round-trip'
);
assert.match(
  milkdownPasteJs,
  /const imageFiles = Array\.from\(clipboardData\.items \?\? \[\]\)[\s\S]*host\.pasteImageFile\(file\);[\s\S]*return true;/,
  'clipboard image files should bypass the default Milkdown image paste route and use the placeholder-first upload flow'
);
assert.match(
  milkdownPasteJs,
  /shouldPreferPlainMarkdown\(\{\s*text,\s*vscodeData\s*\}\)/,
  'plain-text Markdown parsing should preserve the official VS Code clipboard behavior'
);
assert.match(
  milkdownPasteJs,
  /handlePaste\(view, event, preProcessedSlice\)[\s\S]*removeSpuriousEmptyCodeBlocks\(preProcessedSlice\)/,
  'rich HTML paste should clean the already parsed ProseMirror slice without falling back to raw Markdown text'
);
assert.match(
  milkdownPasteJs,
  /filterTransaction\(transaction, state\)[\s\S]*introducesInsecureImageUrls\(state\.doc, transaction\.doc\)[\s\S]*host\.reportInsecureImageSources\(insecureUrls\)[\s\S]*return false;/,
  'editor transactions should reject newly introduced HTTP image sources'
);
assert.match(
  milkdownPasteJs,
  /findInsecureImageUrlsInText\(html\)[\s\S]*findInsecureImageUrlsInText\(text\)[\s\S]*event\.preventDefault\(\)[\s\S]*host\.reportInsecureImageSources\(insecureUrls\)/,
  'HTML and Markdown paste should report and block insecure HTTP images before insertion'
);
assert.match(
  milkdownPasteJs,
  /cleanedSlice !== preProcessedSlice[\s\S]*replaceSelection\(cleanedSlice\)/,
  'the editor should take over HTML paste only when a spurious empty code block was actually removed'
);
assert.match(
  milkdownEntry,
  /async pasteMarkdown\(markdown\)/,
  'editor host should expose a Markdown-aware paste helper for menu-driven paste actions'
);
assert.match(
  milkdownPasteJs,
  /new Slice\(content,\s*0,\s*0\)/,
  'markdown paste should trim empty paragraphs and use a closed slice to prevent spurious blank blocks'
);
assert.doesNotMatch(
  milkdownPasteJs,
  /markdownToSlice\(text\)/,
  'markdown paste should not use markdownToSlice because its DOM round-trip duplicates fenced code blocks'
);
assert.match(
  editCommandControllerJs,
  /editorRuntime\.currentEditorHost\?\.pasteMarkdown\(clipboardResult\.text\)/,
  'menu paste should delegate to the editor host so pasted Markdown is formatted instead of inserted as raw source'
);
console.log('ok - markdown paste is routed through Milkdown clipboard parsing');
