import { Button, TextAreaField } from '../../components/ui';
import styles from './PdfReader.module.css';

/** 点击便签图标后在其旁展开的文字卡片，可直接输入与删除。 */
export function PdfNoteCard({
  left,
  top,
  value,
  disabled,
  onChange,
  onDelete
}: {
  left: number;
  top: number;
  value: string;
  disabled: boolean;
  onChange(value: string): void;
  onDelete(): void;
}) {
  return (
    <div className={styles.noteCard} style={{ left, top }} role="group" aria-label="便签内容">
      <TextAreaField
        label="便签"
        value={value}
        maxLength={2000}
        autoFocus={!value}
        isDisabled={disabled}
        onChange={onChange}
      />
      <Button size="mini" variant="danger" isDisabled={disabled} onPress={onDelete}>
        删除便签
      </Button>
    </div>
  );
}
