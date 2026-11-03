# V4-00.5 Design QA

- source visual truth path: `docs/前端重构/印格/印格设计系统-组件库.html`
- source focused captures:
  - `evidence/source-06-07-1280x720.jpg`
  - `evidence/source-11-12-1280x720.jpg`
  - `evidence/source-12-dialog-1280x720.jpg`
  - `evidence/source-19-29-30-1280x720.jpg`
  - `evidence/source-29-30-pagination-badge-1280x720.jpg`
- implementation URL: `http://127.0.0.1:4173/docs/前端重构/V4/V4-00.5/index.html`
- implementation full-view captures:
  - `evidence/implementation-home-1280x720.jpg`
  - `evidence/implementation-library-1280x720.jpg`
  - `evidence/implementation-editor-1280x720.jpg`
  - `evidence/implementation-library-1024x768.jpg`
  - `evidence/implementation-editor-1024x768.jpg`
  - `evidence/implementation-library-768x684.jpg`
- implementation focused captures:
  - `evidence/implementation-menu-1280x720.jpg`
  - `evidence/implementation-dialog-1280x720.jpg`
  - `evidence/implementation-loading-1280x720.jpg`
- viewport and normalization:
  - focused source/implementation comparison: 1280×720 CSS px, 1280×720 output px, density 1:1
  - responsive evidence: 1024×768 and 768×684 CSS/output px, density 1:1
  - light theme, desktop web app, matching default/menu/dialog/loading states

## Findings

No actionable P0/P1/P2 findings remain.

- Fonts and typography: the implementation preserves the reference's heavy UI headings, compact Chinese control labels, and monospace metadata while introducing a serif-only reading surface for the editor. Hierarchy and wrapping remain readable at 1280, 1024, and 768 equivalent widths.
- Spacing and layout rhythm: button/input/menu/dialog density matches the selected source captures. The newly designed page layout intentionally does not copy the source's navigation, card, tab, table, list, sidebar, or footer examples. No viewport-level horizontal overflow was found at 768px (`documentElement.scrollWidth === innerWidth === 768`).
- Colors and visual tokens: cobalt action blue, warm paper, black entity borders, hard shadows, semantic green/orange/red, zero radius, and flat reading regions are consistent. State colors are limited to square dots and key text.
- Image quality and asset fidelity: the selected reference contains no required photographic or illustrative raster assets. Visible UI icons use Remix Icon; no custom SVG, emoji, placeholder imagery, CSS illustration, or gradient substitution is present.
- Copy and content: all three views use coherent Knowra learning data, meaningful status labels, and specific loading/empty/error recovery text.
- Icons: Remix line icons are consistent in weight and are paired with text or accessible names for icon-only controls.
- States and interactions: view navigation, task completion, global search (`Ctrl/Cmd+K`, Escape), document selection, menu, delete Dialog, confirmation Toast, loading, empty, error, pagination, and editor content interaction were exercised successfully.
- Accessibility: semantic buttons and inputs are used, focus-visible uses a 3px blue hard shadow, Dialog/Search use modal roles and Escape close, destructive actions require confirmation, and reduced-motion rules are present.
- Browser console: 0 errors / 0 warnings across the tested paths.

## Full-view comparison evidence

- `implementation-home-1280x720.jpg`: page hierarchy, daily focus, momentum and continuation path form a coherent system without borrowing unapproved component styles.
- `implementation-library-1280x720.jpg`: filters, status dots and document density align with the chosen component language; collection and inspector treatments are original V4 composition.
- `implementation-editor-1280x720.jpg`: reading surface remains flat and content-led; toolbar state uses the approved menu language.
- 1024 and 768 captures confirm progressive removal of tertiary sidebars without overlap or page-level horizontal overflow.

## Focused comparison evidence

- Buttons / inputs: `source-06-07-1280x720.jpg` compared with `implementation-library-1280x720.jpg` confirms 2px borders, hard shadows, cobalt primary action, compact select density and square focus language.
- Menus: `source-11-12-1280x720.jpg` compared with `implementation-menu-1280x720.jpg` confirms flat menu items, warm pressed hover, 2px entity border, 4px hard shadow and red destructive row.
- Dialog: `source-12-dialog-1280x720.jpg` compared with `implementation-dialog-1280x720.jpg` confirms unblurred dark overlay, 2px header divider, square container, 6px hero shadow and destructive confirmation.
- Loading / status / pagination: `source-19-29-30-1280x720.jpg` and `source-29-30-pagination-badge-1280x720.jpg` compared with `implementation-loading-1280x720.jpg` and the library full view confirm square pulse dots, no skeleton, 8×8 status dots and square pressed pagination.

## Comparison history

### Iteration 1

- Earlier P0/P1/P2 findings: none.
- Fixes made after comparison: none required.
- Post-fix evidence: same as final focused and full-view captures above.

## Open Questions

- V4-00.5 exit still requires the user's direction confirmation.
- Remix Icon currently loads from jsDelivr for the standalone prototype. Production V4 should localize the approved icon subset during V4-04; this is P3 implementation hardening, not a visual blocker.

## Implementation Checklist

- [x] Three high-fidelity primary views belong to one visual system.
- [x] Search, menu, Dialog, sidebar, loading, empty, error and disabled/state language are defined.
- [x] Token draft and density baseline are documented.
- [x] V3 non-inheritance list is explicit.
- [x] 1280 / 1024 / 768 equivalent-width visual evidence is captured.
- [x] Key interactions and console are verified in the in-app browser.
- [ ] User confirms the overall direction.

## Follow-up Polish

- [P3] Localize Remix Icon assets when V4-04 creates the production token/component package.
- [P3] Re-measure real Milkdown toolbar overflow and editor line length after the actual adapter is mounted.

final result: passed
