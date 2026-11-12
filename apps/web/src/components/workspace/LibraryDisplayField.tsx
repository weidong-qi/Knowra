import { SegmentedButton, SegmentedControl } from '../ui';
import styles from './LibraryIndex.module.css';
export function LibraryDisplayField<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange(value: T): void;
}) {
  return (
    <div className={styles.displayField}>
      <span>{label}</span>
      <SegmentedControl density="compact" aria-label={label}>
        {options.map(([key, text]) => (
          <SegmentedButton key={key} aria-pressed={value === key} onPress={() => onChange(key)}>
            {text}
          </SegmentedButton>
        ))}
      </SegmentedControl>
    </div>
  );
}
