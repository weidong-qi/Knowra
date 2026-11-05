import { useRef } from 'react';
import type { PdfAnnotation } from '@study-accelerator/shared/pdf';
import { Button, Popover, PopoverDialog, TextAreaField } from '../../components/ui';
import { KIND_OPTIONS } from '../editor/inspector/annotationOptions';
import styles from './PdfReader.module.css';

/** 文本直接进入既有草稿与保存队列，关闭浮层也不丢失；没有额外的第二份编辑缓冲。 */
export function PdfCommentEditor({
  item,
  point,
  canWrite,
  onChange,
  onClose
}: {
  item: PdfAnnotation;
  point: { x: number; y: number };
  canWrite: boolean;
  onChange(comment: string): void;
  onClose(): void;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  return (
    <>
      <span
        ref={anchorRef}
        className={styles.commentAnchor}
        style={{ left: point.x, top: point.y }}
        aria-hidden="true"
      />
      <Popover
        triggerRef={anchorRef}
        isOpen
        onOpenChange={open => {
          if (!open) onClose();
        }}
        placement="bottom start"
        offset={8}
        containerPadding={12}
        className={`${styles.annotationTone} ${styles.commentEditor}`}
        data-kind={item.kind}
      >
        <PopoverDialog aria-label="编辑 PDF 批注">
          <div className={styles.commentEditorHead}>
            <strong>{KIND_OPTIONS.find(option => option.id === item.kind)?.label} · 批注</strong>
            <Button variant="ghost" size="mini" onPress={onClose}>
              完成
            </Button>
          </div>
          {item.quoteText ? <p className={styles.commentQuote}>{item.quoteText}</p> : null}
          <TextAreaField
            autoFocus
            label="批注内容"
            presentation="composer"
            value={item.comment}
            maxLength={2000}
            isDisabled={!canWrite}
            onChange={onChange}
            placeholder="写下你的想法…"
          />
        </PopoverDialog>
      </Popover>
    </>
  );
}
