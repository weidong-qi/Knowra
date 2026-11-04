import { useId, type CSSProperties, type ReactNode } from 'react';
import { isHexColor } from '@study-accelerator/shared/tag-colors';
import { PressableButton } from '../button/PressableButton';
import { TextField } from './Input';
import styles from './ColorPicker.module.css';

export interface ColorPreset {
  value: string;
  label: string;
  color: string;
}

/** 预设色、系统调色盘与十六进制草稿共用一个受控值。 */
export function ColorPicker({
  value,
  onChange,
  presets,
  preview,
  isDisabled = false
}: {
  value: string;
  onChange(value: string): void;
  presets: readonly ColorPreset[];
  preview?: ReactNode;
  isDisabled?: boolean;
}) {
  const pickerId = useId();
  const preset = presets.some(item => item.value === value);
  const validHex = isHexColor(value.trim());
  return (
    <fieldset className={styles.field} disabled={isDisabled}>
      <legend>颜色</legend>
      <div className={styles.palette}>
        {presets.map(item => (
          <PressableButton
            key={item.value}
            className={styles.swatch}
            style={{ '--swatch-color': item.color } as CSSProperties}
            aria-label={item.label}
            aria-pressed={value === item.value}
            isDisabled={isDisabled}
            onPress={() => onChange(item.value)}
          >
            <span aria-hidden="true" />
          </PressableButton>
        ))}
      </div>
      <div className={styles.custom}>
        <label className={styles.picker} htmlFor={pickerId}>
          <span>调色盘</span>
          <input
            id={pickerId}
            type="color"
            aria-label="自定义颜色调色盘"
            disabled={isDisabled}
            value={validHex ? value.trim().toLowerCase() : '#3c68ff'}
            onChange={event => onChange(event.target.value)}
          />
        </label>
        <TextField
          label="十六进制颜色"
          value={preset ? '' : value}
          placeholder="#RRGGBB"
          autoComplete="off"
          spellCheck="false"
          isDisabled={isDisabled}
          isInvalid={!preset && !validHex}
          errorMessage="请输入 #RRGGBB 格式的六位颜色值"
          onChange={onChange}
        />
      </div>
      {preview ? (
        <div className={styles.preview} aria-label="颜色预览">
          <span>预览</span>
          {preview}
        </div>
      ) : null}
    </fieldset>
  );
}
