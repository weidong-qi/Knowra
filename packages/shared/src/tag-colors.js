export const TAG_PRESET_COLORS = Object.freeze(['neutral', 'blue', 'green', 'orange', 'red', 'violet']);

const aliases = new Map([
  ['slate', 'neutral'],
  ['cyan', 'blue'],
  ['amber', 'orange'],
  ['mastery', 'green'],
  ['importance', 'orange'],
  ['purpose', 'blue']
]);

/** 首版只接受不透明的六位十六进制颜色。 */
export function isHexColor(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

/** 无效输入返回 null；旧版名称保留兼容，自定义颜色不再映射到预设色。 */
export function parseTagColor(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (isHexColor(normalized) || TAG_PRESET_COLORS.includes(normalized)) return normalized;
  return aliases.get(normalized) ?? null;
}
