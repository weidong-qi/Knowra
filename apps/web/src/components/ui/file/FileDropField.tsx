import { useRef, useState, type DragEvent } from 'react';
import { Button } from '../button';
import styles from './FileDropField.module.css';

export interface FileDropFieldProps {
  accept: string;
  multiple?: boolean;
  isDisabled?: boolean;
  label: string;
  description: string;
  onSelect(files: File[]): void;
}

export function FileDropField({
  accept,
  multiple = false,
  isDisabled = false,
  label,
  description,
  onSelect
}: FileDropFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  const select = (files: FileList | null) => {
    if (isDisabled || !files?.length) return;
    onSelect(Array.from(files));
  };
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    select(event.dataTransfer.files);
  };

  return (
    <div
      className={styles.dropZone}
      data-drag-active={dragActive || undefined}
      data-disabled={isDisabled || undefined}
      onDragEnter={(event) => {
        event.preventDefault();
        if (!isDisabled) setDragActive(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false);
      }}
      onDrop={handleDrop}
    >
      <strong className={styles.label}>{label}</strong>
      <span className={styles.description}>{description}</span>
      <Button
        variant="primary"
        isDisabled={isDisabled}
        onPress={() => inputRef.current?.click()}
      >
        选择文件
      </Button>
      <input
        ref={inputRef}
        className={styles.nativeInput}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={isDisabled}
        aria-label={label}
        onChange={(event) => {
          select(event.currentTarget.files);
          event.currentTarget.value = '';
        }}
      />
    </div>
  );
}
