import { useLayoutEffect, useRef, useState } from 'react';
import { TextAreaField } from '../../components/ui';
import styles from './PdfReader.module.css';

/** 选中与输入互不绑定；两处编辑始终消费同一份批注内容。 */
export function PdfAnnotationComment({
  value,
  canWrite,
  onSelect,
  onChange
}: {
  value: string;
  canWrite: boolean;
  onSelect(): void;
  onChange(comment: string): void;
}) {
  const [editing, setEditing] = useState(false);
  const preview = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (editing && canWrite) field.current?.querySelector('textarea')?.focus({ preventScroll: true });
  }, [editing, canWrite]);
  const begin = () => {
    onSelect();
    if (canWrite) setEditing(true);
  };
  const finish = () => {
    setEditing(false);
    requestAnimationFrame(() => preview.current?.focus({ preventScroll: true }));
  };
  return editing && canWrite ? (
    <TextAreaField
      ref={field}
      label="评论"
      presentation="composer"
      className={styles.commentField}
      placeholder="添加评论…"
      value={value}
      maxLength={2000}
      onChange={onChange}
      onBlur={() => setEditing(false)}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) {
          event.preventDefault();
          event.stopPropagation();
          finish();
        }
      }}
    />
  ) : (
    <div
      ref={preview}
      className={styles.commentPreview}
      role="group"
      tabIndex={0}
      aria-label="批注内容，双击或按 Enter 编辑"
      onDoubleClick={begin}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key === 'Enter' || event.key === 'F2') {
          event.preventDefault();
          event.stopPropagation();
          begin();
        }
      }}
    >
      <p>{value || (canWrite ? '双击添加批注…' : '暂无批注')}</p>
    </div>
  );
}
