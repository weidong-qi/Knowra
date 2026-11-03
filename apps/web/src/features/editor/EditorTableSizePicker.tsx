import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { PressableButton } from '../../components/ui/button';
import { Popover, PopoverDialog, PopoverTrigger } from '../../components/ui/overlay';
import { TABLE_DEFAULT_SIZE, TABLE_MAX_COLUMNS, TABLE_MAX_ROWS } from './editorTableModel';
import styles from './EditorTableSizePicker.module.css';

interface EditorTableSizePickerProps {
  disabled?: boolean;
  className?: string;
  children: ReactNode;
  onInsert(rows: number, columns: number): void;
}

/** 工具栏插入表格：在网格里选择行列数（含表头行），键盘用方向键移动、Enter 插入。 */
export function EditorTableSizePicker({ disabled, className, children, onInsert }: EditorTableSizePickerProps) {
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState<{ row: number; col: number }>(TABLE_DEFAULT_SIZE);
  const choose = (row: number, col: number) => { setOpen(false); onInsert(row, col); };
  const move = (event: KeyboardEvent, row: number, col: number) => {
    const delta = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[event.key];
    if (!delta) return;
    event.preventDefault();
    const nextRow = Math.min(TABLE_MAX_ROWS, Math.max(2, row + delta[0]));
    const nextCol = Math.min(TABLE_MAX_COLUMNS, Math.max(1, col + delta[1]));
    setSize({ row: nextRow, col: nextCol });
    (event.currentTarget.parentElement?.querySelector(`[data-cell="${nextRow}-${nextCol}"]`) as HTMLElement | null)?.focus();
  };
  return <PopoverTrigger isOpen={open} onOpenChange={setOpen}>
    <PressableButton type="button" className={className} aria-label="插入表格" title="插入表格" isDisabled={disabled}>{children}</PressableButton>
    <Popover placement="bottom start">
      <PopoverDialog aria-label="选择表格大小">
        <div className={styles.picker}>
          <div className={styles.grid} role="group" aria-label="表格行列数" style={{ gridTemplateColumns: `repeat(${TABLE_MAX_COLUMNS}, 1fr)` }}>
            {Array.from({ length: TABLE_MAX_ROWS * TABLE_MAX_COLUMNS }, (_, index) => {
              const row = Math.floor(index / TABLE_MAX_COLUMNS) + 1;
              const col = (index % TABLE_MAX_COLUMNS) + 1;
              if (row < 2) return null;
              const active = row <= size.row && col <= size.col;
              return <PressableButton key={index} type="button" className={styles.cell} aria-label={`${row} 行 ${col} 列`}
                data-cell={`${row}-${col}`} data-active={active || undefined}
                onHoverStart={() => setSize({ row, col })} onFocus={() => setSize({ row, col })}
                onKeyDown={event => move(event, row, col)} onPress={() => choose(row, col)}>{''}</PressableButton>;
            })}
          </div>
          <p className={styles.caption} aria-live="polite">{size.row} 行 × {size.col} 列（含表头）</p>
        </div>
      </PopoverDialog>
    </Popover>
  </PopoverTrigger>;
}
