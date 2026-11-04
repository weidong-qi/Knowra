// V4-04 Canonical token type exports.
//
// 1:1 反映 src/styles/tokens.css 中声明的 CSS 变量；任何新增必须先回到 V4-00.5
// 走冻结变更流程，再同步修改 tokens.css 与本文件。

export const CANONICAL_COLOR_TOKENS = [
  'ink-bg',
  'ink-surface',
  'ink-sunken',
  'ink',
  'ink-secondary',
  'ink-muted',
  'ink-panel',
  'ink-dot',
  'ink-accent',
  'ink-accent-hover',
  'ink-accent-soft',
  'ink-cover-shadow',
  'ink-success',
  'ink-success-soft',
  'ink-warning',
  'ink-warning-soft',
  'ink-danger',
  'ink-danger-soft',
  'ink-shell'
] as const;

export const CANONICAL_SIZE_TOKENS = [
  'rail-size',
  'sidebar-size',
  'sidebar-size-narrow',
  'inspector-size',
  'docbar-size',
  'status-size',
  'mobile-tabs-size'
] as const;

export const CANONICAL_SHADOW_TOKENS = [
  'shadow-1',
  'shadow-2',
  'shadow-focus'
] as const;

/** 输入控件的扩展语义：阴影始终落在可见外壳，不落在原生控件。 */
export const INPUT_SHADOW_TOKENS = [
  'shadow-input-rest',
  'shadow-input-focus',
  'shadow-input-invalid'
] as const;

export const CANONICAL_MOTION_TOKENS = [
  'motion-fast',
  'motion-mid',
  'motion-ease'
] as const;

export const CANONICAL_FONT_TOKENS = [
  'font-ui',
  'font-mono'
] as const;

export type CanonicalColorToken = (typeof CANONICAL_COLOR_TOKENS)[number];
export type CanonicalSizeToken = (typeof CANONICAL_SIZE_TOKENS)[number];
export type CanonicalShadowToken = (typeof CANONICAL_SHADOW_TOKENS)[number];
export type InputShadowToken = (typeof INPUT_SHADOW_TOKENS)[number];
export type CanonicalMotionToken = (typeof CANONICAL_MOTION_TOKENS)[number];
export type CanonicalFontToken = (typeof CANONICAL_FONT_TOKENS)[number];

export type ButtonVariant = 'default' | 'primary' | 'danger' | 'ghost';
export type StatusTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
