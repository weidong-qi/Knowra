import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const directory = resolve(import.meta.dirname, '../../apps/web/src/components/ui');
const readCss = file => readFileSync(join(directory, file), 'utf8');

const css = {
  button: readCss('./button/Button.module.css'),
  ghost: readCss('./button/IconButton.module.css'),
  segmented: readCss('./button/SegmentedControl.module.css'),
  input: readCss('./input/Input.module.css'),
  search: readCss('./input/SearchBox.module.css'),
  collection: readCss('./collection/Collection.module.css'),
  overlay: readCss('./overlay/Overlay.module.css'),
  navigation: readCss('./navigation/SideNavItem.module.css')
};

function declarations(source, selector) {
  return [...source.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selectors]) => selectors.split(',').some(value => value.trim() === selector))
    .map(([, , body]) => body)
    .join('\n');
}

/* 只锁定 V5 共享视觉契约；点击、校验与键盘导航由各组件行为测试覆盖。 */
describe('V5 shared control styles', () => {
  it('inherits the complete cross-platform UI font stack in themed shells and portals', () => {
    const theme = readFileSync(join(directory, '../../features/notes/NotesIndexTheme.module.css'), 'utf8');
    const tokens = readFileSync(join(directory, '../../styles/tokens.css'), 'utf8');
    assert.match(declarations(theme, '.theme'), /font-family:\s*var\(--font-ui\)/);
    assert.doesNotMatch(theme, /--font-ui\s*:/, '局部外观不得覆盖共享字体栈');
    const stack = tokens.match(/--font-ui\s*:\s*([^;]+);/)?.[1];
    assert.ok(stack);
    for (const family of ['PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', 'WenQuanYi Zen Hei']) {
      assert.ok(stack.includes(family), `缺少跨平台中文后备字体 ${family}`);
    }
  });

  it('keeps pill actions separate from rectangular content across themes', () => {
    const theme = readFileSync(join(directory, '../../features/notes/NotesIndexTheme.module.css'), 'utf8');
    assert.doesNotMatch(theme, /--radius-(?:control|tab|popover|panel|pill)\s*:/, '主题不得覆盖共享形状令牌');
    assert.ok(declarations(css.button, '.square').includes('border-radius: var(--radius-control)'));
    assert.ok(declarations(css.button, '.pill').includes('border-radius: var(--radius-pill)'));
  });

  it('keeps notes ancestors reachable when the compact breadcrumb is hidden', () => {
    const index = readFileSync(join(directory, '../../features/notes/NotesIndexView.module.css'), 'utf8');
    const header = readFileSync(join(directory, '../../features/notes/NotesIndexHeader.tsx'), 'utf8');
    // 单行索引允许隐藏路径，但根目录及祖先必须仍由共享菜单可达。
    const normal = index.split('@container (max-width:560px)')[0];
    assert.doesNotMatch(declarations(normal, '.breadcrumb'), /display:\s*none/);
    assert.match(declarations(index, '.heading strong'), /text-overflow:\s*ellipsis/);
    assert.match(
      header,
      /path\.filter\(\(segment, index\) => index < path\.length - 1 && !segment\.current && segment\.onNavigate\)/
    );
    assert.match(header, /\{ancestors\.length\s*\?\s*(?:\(\s*)?<SubmenuTrigger>/);
    assert.match(header, /<MenuItem id="path-navigation">路径导航<\/MenuItem>/);
    assert.match(header, /<Menu\s+ariaLabel="路径导航"/);
    assert.match(header, /ancestors\.find\(segment => segment\.id === key\)\?\.onNavigate\?\.\(\)/);
    assert.match(header, /ancestors\.map\(segment\s*=>\s*(?:\(\s*)?<MenuItem/);
  });

  it('reserves an independently reachable notes body in short viewports', () => {
    const index = readFileSync(join(directory, '../../features/notes/NotesIndexView.module.css'), 'utf8');
    assert.match(index, /@media \(max-height: 560px\)/);
    assert.match(declarations(index, '.panel'), /overflow-y:\s*auto/);
    assert.match(declarations(index, '.indexWrap'), /min-height:\s*220px/);
    assert.match(declarations(index, '.content'), /min-height:\s*140px/);
    assert.match(declarations(index, '.pagination'), /overflow-x:\s*auto/);
    assert.match(declarations(index, '.pageNavigation'), /flex-shrink:\s*0/);
  });

  it('keeps interactive controls stationary and removes the old ink borders', () => {
    for (const source of [css.button, css.ghost, css.segmented, css.collection]) {
      assert.doesNotMatch(source, /transform\s*:\s*translate/);
      assert.doesNotMatch(source, /border(?:-color)?\s*:[^;]*var\(--ink\)/);
      assert.doesNotMatch(source, /box-shadow\s*:\s*\d+px\s+\d+px\s+0\s/);
    }
  });

  it('uses semantic radii and soft elevation for controls and overlays', () => {
    assert.ok(declarations(css.button, '.btn').includes('border-radius: var(--radius-pill)'));
    assert.ok(declarations(css.button, '.btn').includes('box-shadow: var(--shadow-control)'));
    for (const selector of ['.popover', '.menu']) {
      assert.ok(declarations(css.overlay, selector).includes('border-radius: var(--radius-popover)'));
      assert.ok(declarations(css.overlay, selector).includes('box-shadow: var(--shadow-overlay)'));
    }
    assert.ok(declarations(css.overlay, '.dialog').includes('border-radius: var(--radius-panel)'));
    assert.doesNotMatch(declarations(css.overlay, '.menuPopover'), /(?:background|border|box-shadow)\s*:/);
  });

  it('preserves keyboard focus in normal and forced-color themes', () => {
    for (const [source, selector] of [
      [css.button, '.btn[data-focus-visible]'],
      [css.ghost, '.base:focus-visible'],
      [css.segmented, '.segment[data-focus-visible]'],
      [css.input, '.checkbox[data-focus-visible] .box'],
      [css.overlay, '.item[data-focus-visible]'],
      [css.navigation, '.item[data-focus-visible]']
    ]) {
      const rule = declarations(source, selector);
      assert.match(rule, /outline:\s*2px solid var\(--accent-text\)/);
      assert.match(rule, /box-shadow:\s*var\(--focus-ring\)/);
    }
    for (const [source, selector] of [
      [css.collection, '.tab[data-focus-visible]'],
      [css.input, '.selectTrigger[data-focus-visible]'],
      [css.input, '.field:not([data-disabled]):focus-within .inputShell']
    ]) {
      const [normal, forced] = source.split('@media (forced-colors: active)');
      const focus = declarations(normal, selector);
      if (source === css.collection) {
        assert.match(focus, /box-shadow:\s*var\(--focus-soft(?:[,)]|\s)/);
      } else {
        assert.match(focus, /border-color:\s*var\(--border-strong\)/);
        assert.match(focus, /background:\s*var\(--surface-raised,\s*var\(--surface-page\)\)/);
        assert.match(focus, /box-shadow:\s*0\s+1px\s+3px\s+rgb\(/);
        assert.doesNotMatch(focus, /--accent/);
      }
      assert.ok(forced, `${selector} needs a forced-color fallback`);
      assert.match(declarations(forced, selector), /outline:\s*2px solid Highlight/);
      assert.match(declarations(forced, selector), /outline-offset:\s*2px/);
    }
    // 搜索框：灰底 + 极细发丝线，聚焦变白底并加深发丝线（不使用橙色环）；强制色模式仍回退到系统高亮描边。
    const [searchNormal, searchForced] = css.search.split('@media (forced-colors: active)');
    const searchFocus = declarations(searchNormal, '.shell:not([data-disabled]):focus-within');
    assert.match(searchFocus, /border-color:\s*var\(--border-strong\)/);
    assert.doesNotMatch(searchFocus, /--accent/);
    assert.ok(searchForced, 'search shell needs a forced-color fallback');
    assert.match(
      declarations(searchForced, '.shell:not([data-disabled]):focus-within'),
      /outline:\s*2px solid Highlight/
    );
  });

  it('keeps invalid states distinct without requiring a thick normal-theme outline', () => {
    for (const source of [css.input, css.search]) {
      const nativeInput = declarations(source, '.input');
      assert.ok(nativeInput.includes('background: transparent'));
      assert.ok(nativeInput.includes('box-shadow: none'));
    }
    for (const [source, selector] of [
      [css.input, '.field[data-invalid]:not([data-disabled]):focus-within .inputShell'],
      [css.input, '.field[data-invalid] .selectTrigger'],
      [css.search, '.shell[data-invalid]:not([data-disabled]):focus-within']
    ]) {
      assert.match(declarations(source, selector), /border-color:\s*var\(--ink-danger\)/);
    }
    for (const [source, selector] of [
      [css.input, '.field[data-invalid]:not([data-disabled]):focus-within .inputShell'],
      [css.input, '.field[data-invalid] .selectTrigger[data-focus-visible]'],
      [css.search, '.shell[data-invalid]:not([data-disabled]):focus-within']
    ]) {
      assert.match(declarations(source, selector), /box-shadow:\s*var\(--focus-ring-danger/);
      const forced = source.split('@media (forced-colors: active)')[1];
      assert.match(declarations(forced, selector), /outline:\s*2px solid Highlight/);
    }
  });

  it('uses 44px button targets on phones and regular sizes on tablets and desktops', () => {
    const [regular, phone] = css.button.split('@media (max-width: 767px) {');
    assert.ok(phone, '44px button targets must use the phone-width media condition only');
    assert.match(declarations(regular, '.btn'), /(?:^|;)\s*height:\s*36px(?:;|$)/);
    assert.match(declarations(regular, '.btn'), /--button-min-height:\s*36px/);
    assert.doesNotMatch(declarations(regular, '.btn'), /(?:--button-min-height|min-height):\s*44px/);
    assert.match(declarations(phone, '.btn'), /--button-min-height:\s*44px/);
    assert.match(declarations(phone, '.btn'), /min-height:\s*var\(--button-min-height\)/);
  });

  it('styles React Aria select options through their accessible role', () => {
    assert.ok(
      declarations(css.collection, ".listbox [role='option']").includes('border-radius: var(--radius-control)')
    );
    const selected = declarations(css.collection, ".listbox [role='option'][data-selected]");
    assert.match(selected, /color:\s*var\(--text-primary\)/);
    assert.match(selected, /background:\s*var\(--surface-selected\)/);
    assert.match(
      declarations(css.collection, ".listbox [role='option'][data-focus-visible]"),
      /outline:\s*2px solid var\(--accent-text\)/
    );
    assert.ok(declarations(css.collection, ".listbox [role='option'][data-disabled]").includes('cursor: not-allowed'));
  });

  it('keeps sidebar navigation neutral and expands ghost targets only on phone-width viewports', () => {
    assert.ok(declarations(css.navigation, '.icon').includes('--knowra-icon-accent: currentColor'));
    assert.ok(
      declarations(css.navigation, ".item[aria-current='page']").includes(
        'color: var(--nav-selected-ink, var(--text-primary))'
      )
    );
    assert.ok(declarations(css.navigation, ".item[aria-current='page'] .icon").includes('color: var(--accent)'));
    assert.ok(declarations(css.navigation, '.compact').includes('min-height: 34px'));
    const [regular, phone] = css.ghost.split('@media (max-width: 767px) {');
    assert.ok(phone, '44px ghost targets must use the phone-width media condition only');
    assert.match(declarations(regular, '.size30'), /(?:^|;)\s*width:\s*30px(?:;|$)/);
    assert.match(declarations(regular, '.size30'), /(?:^|;)\s*height:\s*30px(?:;|$)/);
    assert.doesNotMatch(declarations(regular, '.base'), /min-(?:width|height):\s*44px/);
    assert.match(declarations(phone, '.base'), /min-width:\s*44px/);
    assert.match(declarations(phone, '.base'), /min-height:\s*44px/);
  });
});
