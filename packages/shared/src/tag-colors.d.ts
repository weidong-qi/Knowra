export type PresetTagColor = 'neutral' | 'blue' | 'green' | 'orange' | 'red' | 'violet';
/** 长度与字符集由 parseTagColor 在运行时校验。 */
export type HexColor = `#${string}`;
export type TagColor = PresetTagColor | HexColor;
export const TAG_PRESET_COLORS: readonly PresetTagColor[];
export function isHexColor(value: unknown): value is HexColor;
export function parseTagColor(value: unknown): TagColor | null;
