export const RUNTIME_COLOR_FALLBACKS = Object.freeze({
  accent: '#3c68ff',
  danger: '#dc2626',
  placeholderSurfaceStart: '#f8fbff',
  placeholderSurfaceEnd: '#eef4ff',
  placeholderText: '#5b6785'
});

const SAFE_TAG_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function normalizeTagColor(value) {
  const candidate = String(value ?? '').trim();
  return SAFE_TAG_COLOR_PATTERN.test(candidate)
    ? candidate
    : RUNTIME_COLOR_FALLBACKS.accent;
}

export function readCssColorToken(tokenName, fallback) {
  if (
    typeof document === 'undefined'
    || typeof getComputedStyle !== 'function'
    || !tokenName
  ) {
    return fallback;
  }

  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(tokenName)
    .trim();
  return value || fallback;
}
