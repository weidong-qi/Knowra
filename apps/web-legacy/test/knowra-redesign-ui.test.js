import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderHtml } from '../src/server/shell-html.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readStyle = (name) => fs.readFileSync(
  path.resolve(__dirname, `../styles/components/${name}`),
  'utf8'
);

const tokens = readStyle('knowra-theme-tokens.css');
const shell = readStyle('knowra-inkgrid-shell.css');
const navigation = readStyle('knowra-inkgrid-navigation.css');
const library = readStyle('knowra-inkgrid-library-index.css');
const editor = `${readStyle('knowra-inkgrid-editor.css')}\n${readStyle('knowra-inkgrid-editor-paper.css')}`;
const workDomain = readStyle('work-domain.css');
const menus = readStyle('knowra-inkgrid-menus.css');
const typography = readStyle('knowra-inkgrid-typography.css');
const shellHtml = renderHtml();
const iconPath = (name) => path.resolve(__dirname, `../styles/icons/remix/${name}`);

assert.match(tokens, /--ink-font-ui:\s*-apple-system,\s*BlinkMacSystemFont,\s*"Segoe UI",\s*Roboto,\s*"Helvetica Neue",\s*Arial,\s*sans-serif;/, 'InkGrid UI font should use the approved sans-serif stack');
assert.match(tokens, /--ink-font-reading:\s*var\(--ink-font-ui\);/, 'InkGrid reading font should share the approved sans-serif stack');
assert.match(tokens, /--ink-font-display:\s*var\(--ink-font-ui\);/, 'InkGrid display font should remain within the approved sans-serif stack');
assert.match(tokens, /--ink-font-mono:\s*"SF Mono",\s*"Menlo",\s*monospace;/, 'InkGrid mono font should use the approved mono stack');
assert.match(tokens, /--font-body:\s*var\(--ink-font-ui\);/, 'legacy body references should resolve to the InkGrid UI stack');
assert.match(tokens, /--ink-type-micro:\s*11px;/, 'microcopy should use the smallest legible production step');
assert.match(tokens, /--ink-type-control:\s*14px;/, 'buttons and interface information should share one control step');
assert.match(tokens, /--ink-type-reading:\s*18px;/, 'note content should use the shared reading size');
assert.match(tokens, /--ink-type-heading-4:\s*13px;[\s\S]*--ink-type-heading-3:\s*14px;[\s\S]*--ink-type-heading-2:\s*16px;[\s\S]*--ink-type-heading-1:\s*28px;/, 'note headings should use the InkGrid H1-H4 baseline');
assert.match(tokens, /--ink-type-display-sm:\s*42px;/, 'InkGrid display should use the 42px baseline');
assert.match(typography, /\.editor-workspace \.document-title-input,[\s\S]*font-family:\s*var\(--font-reading\)/, 'the note title and note body should share the reading family');
assert.match(typography, /\.editor-workspace \.milkdown-host \.ProseMirror,[\s\S]*font-size:\s*var\(--text-body\)[\s\S]*line-height:\s*var\(--line-height-reading\)/, 'editor and preview copy should share reading metrics');
assert.match(typography, /\.milkdown-code-block \.tools,[\s\S]*font-family:\s*var\(--font-ui\)/, 'embedded editor controls should remain in the UI family');
assert.match(
  tokens,
  /--document-tab-height:\s*var\(--menu-height\);/,
  'document tabs should share the compact toolbar height token'
);
assert.match(shell, /\.library-mark\s*\{[^}]*width:\s*44px[^}]*height:\s*44px[^}]*border:\s*0[^}]*background:\s*transparent/, 'the library header should reuse the unframed knowledge module mark');
assert.match(shell, /\.library-mark-icon\s*\{[^}]*width:\s*38px[^}]*height:\s*38px/, 'the current module mark should remain legible without an active-state frame');
assert.match(navigation, /\.function-nav-icon\s*\{[^}]*width:\s*100%[^}]*height:\s*100%/, 'function navigation artwork should fill its icon frame');
assert.match(
  shell,
  /\.library-header-toggle\[data-open='true'\]\s*\{[^}]*background:\s*var\(--blue\)/,
  'the open section menu trigger should become a blue square'
);
assert.match(shellHtml, /class="library-home-target" data-library-home="global"/, 'the module header should own the library home entry point');
assert.match(shellHtml, /class="function-navigation"[^>]*id="module-rail"[^>]*data-ui-function-navigation/, 'the shell should expose an independent function navigation host');
assert.match(shellHtml, /id="status-indicators"[^>]*data-ui-status-feature[^>]*data-status-slot="feature"/, 'the shell should expose an independent feature status slot');
assert.match(shellHtml, /id="status-meta"[^>]*data-ui-status-global[^>]*data-status-slot="global"/, 'the shell should expose an independent global status slot');
assert.match(shellHtml, /class="semantic-icon library-mark-icon"[\s\S]*data-icon="libraryMark"[\s\S]*remix\/book-2-line\.svg/, 'the module header should share the knowledge icon asset');
assert.match(shellHtml, /data-editor-aside-toggle[^>]*aria-label="收起资料边注"[\s\S]*class="semantic-icon editor-aside-toggle-icon"[\s\S]*data-icon="navigationChevron"/, 'the editor aside close action should use the central chevron mapping');
assert.doesNotMatch(shellHtml, />›</, 'the editor aside close action should not emit a Unicode icon glyph');
assert.doesNotMatch(shellHtml, /class="library-id"|CONTENT &amp; FOLDERS/, 'the old numeric mark and duplicate directory English label should be removed');
assert.match(shellHtml, /class="scope-summary" id="library-index-scope"/, 'the browsing scope summary should remain in the index masthead');
assert.doesNotMatch(shellHtml, /class="brand"/, 'the production shell should not render the removed logo area');
assert.match(shell, /\.knowra-rail\s*\{[\s\S]*padding:\s*0\s+var\(--space-6\)\s+var\(--space-4\)/, 'the left module header should sit flush with the shell top');
assert.match(
  library,
  /\.index-filter-chevron\s*\{[^}]*width:\s*var\(--space-4\)[^}]*height:\s*var\(--space-4\)[^}]*fill:\s*none[^}]*stroke:\s*currentColor/,
  'filter chevrons should have bounded SVG geometry and an explicit stroke'
);
assert.match(tokens, /--ink-index-selection-w:\s*2px;/, 'index selection should use the low-focus line token');
assert.match(tokens, /--ink-border-tab-active:\s*2px;/, 'Tab activation lines should use the dedicated 2px token');
assert.match(tokens, /--ink-masthead-h:\s*76px;/, 'the approved compact masthead height should be shared');
assert.match(tokens, /--ink-index-row-h:\s*100px;/, 'the prototype index row height should be shared');
assert.match(tokens, /--ink-statusbar-h:\s*32px;/, 'the status bar should use the compact shared 32px rhythm');
assert.match(tokens, /--editor-focus-frame-width:\s*calc\(var\(--editor-max-width\) \+ var\(--space-20\)\);/, 'focus mode should use a bounded centered writing frame');
assert.match(
  library,
  /\.masthead \.primary-button\s*\{[^}]*height:\s*var\(--index-create-height\)[^}]*border:\s*var\(--ink-border-w\) solid var\(--ink-border\)[^}]*background:\s*var\(--blue\)[^}]*box-shadow:\s*var\(--ink-shadow-2\)/,
  'the index create action should match the prototype solid control'
);
assert.match(
  library,
  /\.index-entry\s*\{[^}]*height:\s*var\(--index-row-height\)[^}]*min-height:\s*var\(--index-row-height\)[^}]*overflow:\s*hidden/,
  'index rows should keep a stable rhythm when summaries vary in length'
);
assert.match(
  library,
  /\.index-entry\[data-selected='true'\]::before\s*\{[^}]*width:\s*var\(--index-selection-width\)/,
  'the selected index marker should use the subtle selection width'
);
assert.match(library, /-webkit-line-clamp:\s*1;/, 'index summaries should keep the approved single-line compact rhythm');
assert.match(library, /\.index-list-card\s*\{[^}]*border:\s*var\(--ink-border-w\) solid var\(--ink-border\)[^}]*box-shadow:\s*var\(--ink-shadow-2\)/, 'the entry list should use the prototype card surface');
assert.match(library, /\.entry-archive\s*\{[^}]*width:\s*var\(--index-entry-thumb\)[^}]*height:\s*var\(--index-entry-thumb\)[^}]*border:\s*var\(--ink-border-w\) solid var\(--ink-border\)/, 'note rows should use the compact framed type mark');
assert.match(library, /\.entry-book-cover\s*\{[^}]*width:\s*var\(--space-6\)[^}]*height:\s*var\(--space-6\)[^}]*opacity:\s*1/, 'note rows should use the compact local icon mark');
assert.match(library, /\.index-entry \.tag-row > span:not\(\.tag-empty\)\s*\{[^}]*border-color:\s*var\(--line-soft\)[^}]*color:\s*var\(--muted\)/, 'unselected index tags should remain low contrast');
assert.match(library, /\.index-entry\[data-selected='true'\] \.tag-row > span:not\(\.tag-empty\)\s*\{[^}]*border-color:\s*var\(--blue\)[^}]*color:\s*var\(--blue\)/, 'selected index tags should use the blue accent');
assert.doesNotMatch(library, /\.index-entry:hover \.tag-row/, 'hovering an index row should not recolor its tags');
assert.doesNotMatch(
  library,
  /\.index-entry\[data-selected='true'\] \.entry-id,\s*\.index-entry\[data-selected='true'\] \.entry-reading/,
  'selection should not recolor secondary index metadata'
);
assert.match(library, /\.index-inspector-content\s*\{[^}]*height:\s*calc\(100% - var\(--aux-sidebar-head-h\)\)[^}]*padding:\s*0\s+var\(--space-4\)/, 'the right inspector scroll content should sit below the prototype header');
assert.match(
  library,
  /\.index-inspector \.inspector-head\s*\{[^}]*flex:\s*0 0 var\(--aux-sidebar-head-h\)[^}]*min-height:\s*var\(--aux-sidebar-head-h\)/,
  'the inspector should use the prototype compact title row'
);
assert.match(
  library,
  /\.index-inspector \.panel-head-title\s*\{[^}]*font-size:\s*var\(--text-sm\)[^}]*font-weight:\s*700/,
  'the inspector title should use the compact panel hierarchy'
);
assert.match(library, /\.entry-heading h2\s*\{[^}]*font-size:\s*var\(--index-entry-title\)[^}]*font-weight:\s*700/, 'index note titles should keep the compact hierarchy');
assert.match(library, /\.masthead\s*\{[^}]*display:\s*flex[^}]*justify-content:\s*space-between/, 'the masthead should keep the title and create action on one row');
assert.match(library, /\.masthead-kicker\s*\{\s*display:\s*none;/, 'the prototype index masthead should not add a second English title line');
assert.match(library, /\.scope-summary\s*\{[^}]*font-size:\s*var\(--text-sm\)/, 'the current browsing scope should remain a compact inline summary');
assert.match(
  library,
  /\.inspector-open-icon\s*\{[^}]*width:\s*var\(--space-4\)[^}]*height:\s*var\(--space-4\)[^}]*opacity:\s*1/,
  'the inspector open icon should remain fully visible'
);
assert.match(
  library,
  /\.entry-action-icon\s*\{[^}]*width:\s*var\(--text-base\)[^}]*height:\s*var\(--text-base\)[^}]*opacity:\s*1/,
  'the index row open icon should remain fully visible'
);
assert.match(library, /\.inspector-fixed-section > header h3\s*\{[^}]*font-size:\s*var\(--text-base\)/, 'right section titles should share the left navigation title scale');
assert.match(library, /\.section-icon\s*\{[^}]*width:\s*18px[^}]*height:\s*18px/, 'right section icons should share the approved navigation icon scale');
assert.match(library, /\.index-local-search input\s*\{[^}]*width:\s*var\(--index-local-search-width\)[^}]*border:\s*var\(--ink-border-w\) solid var\(--ink-border\)/, 'the index should expose the prototype local search control');
assert.match(library, /\.knowra-production-shell\[data-screen='index'\] \.knowra-rail \.library-label\s*\{[^}]*min-height:\s*var\(--aux-sidebar-head-h\)[^}]*height:\s*var\(--aux-sidebar-head-h\)/, 'the index directory should use the prototype compact header');
assert.match(library, /\.library-index-directory-reopen\s*\{[^}]*left:\s*var\(--shell-nav-w\)[^}]*width:\s*var\(--aux-sidebar-control\)/, 'the collapsed index directory should retain an explicit reopen affordance');
assert.match(editor, /\.document-title\s*\{[^}]*border-left:\s*var\(--border-selection\) solid var\(--blue\)/, 'the document title should begin directly after the blue guide line');
assert.match(editor, /\.document-title-input\s*\{[^}]*color:\s*var\(--ink\)[^}]*font:\s*800/, 'the file title should remain the primary InkGrid paper heading');
assert.match(
  editor,
  /\.document-tabs \.note-tab\[data-active='true'\][^}]*box-shadow:\s*inset\s*var\(--border-tab-active\)\s+0\s+0\s+var\(--blue\)/,
  'active document tabs should use a left blue rule'
);
assert.match(
  editor,
  /\.editor-inspector \.aside-tab\[data-active='true'\][^}]*box-shadow:\s*inset\s*0\s+calc\(-1 \* var\(--border-tab-active\)\)\s+0\s+var\(--ink\)/,
  'active marginalia tabs should use a bottom black rule'
);
assert.match(
  library,
  /\.content-tabs button\[data-active='true'\][^}]*box-shadow:\s*inset\s*0\s+calc\(-1 \* var\(--border-tab-active\)\)\s+0\s+var\(--ink\)/,
  'active library view tabs should use a bottom black rule'
);
assert.match(
  workDomain,
  /\.work-domain-nav-button\[data-active='true'\][^}]*border-bottom-color:\s*var\(--ink\)/,
  'active work-domain tabs should use a bottom black rule'
);
assert.doesNotMatch(editor, /\.document-id\s*\{/, 'the removed decorative document number should not retain production styling');
assert.match(editor, /\.preview-rendered h2\s*\{[^}]*color:\s*var\(--ink\)/, 'ordinary H2 headings should return to the same black hierarchy as other headings');
assert.match(editor, /data-knowra-emphasis='true'[\s\S]*border-bottom:[^;]+;[\s\S]*color:\s*var\(--blue\)/, 'the former blue divider treatment should remain reserved for future emphasized headings');
assert.match(editor, /data-view-mode='focus'[\s\S]*\.preview-rendered[\s\S]*margin-inline:\s*auto/, 'focus mode should center both editing and reading columns');
[
  'book-2-line.svg',
  'book-open-line.svg',
  'add-line.svg',
  'stack-line.svg',
  'file-list-3-line.svg',
  'sparkling-2-line.svg',
  'task-line.svg',
  'refresh-line.svg'
].forEach((name) => assert.equal(fs.existsSync(iconPath(name)), true, `${name} should be served as a production asset`));
assert.match(
  editor,
  /\.note-tab-close\s*\{[^}]*margin-left:\s*auto/,
  'tab close controls should align at the far edge'
);
assert.match(
  editor,
  /\.note-tab-overflow-menu\s*\{[^}]*width:\s*var\(--rail-width\)/,
  'hidden tabs should use the production overflow menu instead of widening the editor'
);
assert.match(
  editor,
  /\.annotation-marker\s*\{[^}]*background:\s*var\(--blue-wash\)[^}]*var\(--blue\)/,
  'important text should use the production blue annotation treatment'
);
assert.match(
  editor,
  /\.editor-menu-text\[data-open='true'\],[\s\S]*background:\s*var\(--blue\)/,
  'open editor menu buttons should use the blue square active state'
);
assert.match(
  editor,
  /\.editor-inspector \.resource-row\s*\{[^}]*border-radius:\s*var\(--radius-none\)/,
  'attachment rows should use the production square treatment'
);
assert.match(
  menus,
  /\.library-context-menu,[\s\S]*border-radius:\s*var\(--radius-none\)/,
  'shared context menus should use the square editorial surface'
);

console.log('ok - Knowra redesign keeps the repaired visual contracts');
