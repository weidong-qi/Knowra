import { TAG_PRESET_COLORS, parseTagColor } from '@study-accelerator/shared/tag-colors';
import { ColorPicker } from '../../components/ui';
import { TagChip } from './TagChip';
import { tagColorLabel, tagColorValue } from './tagColor';

const presets = TAG_PRESET_COLORS.map(value => ({ value, label: tagColorLabel(value), color: tagColorValue(value) }));

export function TagColorPicker({
  value,
  onChange,
  name,
  isDisabled
}: {
  value: string;
  onChange(value: string): void;
  name?: string;
  isDisabled?: boolean;
}) {
  return (
    <ColorPicker
      value={value}
      onChange={onChange}
      presets={presets}
      isDisabled={isDisabled}
      preview={
        <TagChip
          tag={{ id: 'color-preview', name: name?.trim() || '标签预览', color: parseTagColor(value) ?? 'neutral' }}
          selected
        />
      }
    />
  );
}
