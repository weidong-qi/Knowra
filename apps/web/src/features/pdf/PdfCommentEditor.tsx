import { useRef, type RefObject } from 'react';
import type { PdfAnnotation } from '@study-accelerator/shared/pdf';
import { Button, IconButton, FloatingPanel, TextAreaField } from '../../components/ui';
import { DeleteIcon } from '../../components/icons/knowra';
import { KIND_OPTIONS } from '../editor/inspector/annotationOptions';
import styles from './PdfReader.module.css';
import { PdfCommentConnector } from './PdfCommentConnector';

/** 文本直接进入既有草稿与保存队列，关闭浮层也不丢失；没有额外的第二份编辑缓冲。 */
export function PdfCommentEditor({
  item,
  point,
  boundaryRef,
  focusRequest = 1,
  revision,
  onPositionChange = () => {},
  canWrite,
  onChange,
  onDelete,
  onClose
}: {
  item: PdfAnnotation;
  point: { x: number; y: number };
  boundaryRef?: RefObject<HTMLDivElement | null>;
  focusRequest?: number;
  revision?: number;
  onPositionChange?(point: { x: number; y: number }): void;
  canWrite: boolean;
  onChange(comment: string): void;
  onDelete?(): void;
  onClose(): void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <FloatingPanel
        ref={editorRef}
        point={point}
        boundaryRef={boundaryRef}
        focusRequest={focusRequest}
        onPositionChange={onPositionChange}
        onClose={onClose}
        aria-label="编辑 PDF 批注"
        moveLabel="移动批注窗口"
        closeLabel="关闭批注输入框"
        title={`${KIND_OPTIONS.find(option => option.id === item.kind)?.label} · 批注`}
        className={`${styles.annotationTone} ${styles.commentEditor}`}
        data-kind={item.kind}
        headerActions={
          <>
            {onDelete ? (
              <IconButton size={24} aria-label="删除便签" title="删除便签" isDisabled={!canWrite} onPress={onDelete}>
                <DeleteIcon size={14} />
              </IconButton>
            ) : null}
            <Button variant="ghost" size="mini" onPress={onClose}>
              完成
            </Button>
          </>
        }
      >
        {item.quoteText ? <p className={styles.commentQuote}>{item.quoteText}</p> : null}
        <TextAreaField
          label="批注内容"
          presentation="composer"
          value={item.comment}
          maxLength={2000}
          isReadOnly={!canWrite}
          onChange={onChange}
          placeholder="写下你的想法…"
        />
      </FloatingPanel>
      {boundaryRef ? (
        <PdfCommentConnector id={item.id} containerRef={boundaryRef} editorRef={editorRef} revision={revision} />
      ) : null}
    </>
  );
}
