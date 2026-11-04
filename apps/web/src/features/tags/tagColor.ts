import type { CSSProperties } from 'react';
import { parseTagColor, type PresetTagColor } from '@study-accelerator/shared/tag-colors';
import type { Tag, TagColor } from '@study-accelerator/web-core';

const presetStyles: Record<PresetTagColor, string> = {
  neutral: 'var(--text-secondary)',
  blue: 'var(--color-info)',
  green: 'var(--ink-success)',
  orange: 'var(--ink-warning)',
  red: 'var(--ink-danger)',
  violet: 'var(--ink-violet)'
};
const presetLabels: Record<PresetTagColor, string> = {
  neutral: '中性',
  blue: '蓝',
  green: '绿',
  orange: '橙',
  red: '红',
  violet: '紫'
};

export function normalizeTagColor(color: Tag['color']): TagColor {
  return parseTagColor(color) ?? 'neutral';
}

export function tagColorValue(color: Tag['color']): string {
  const normalized = normalizeTagColor(color);
  return normalized.startsWith('#') ? normalized : presetStyles[normalized as PresetTagColor];
}

export function tagColorStyle(color: Tag['color'], property = '--tag-color'): CSSProperties {
  return { [property]: tagColorValue(color) };
}

export function tagColorLabel(color: Tag['color']): string {
  const normalized = normalizeTagColor(color);
  return normalized.startsWith('#') ? normalized : `${presetLabels[normalized as PresetTagColor]}色`;
}
