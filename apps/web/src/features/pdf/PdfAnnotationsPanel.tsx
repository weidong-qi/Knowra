import { useEffect, useRef, useState } from 'react';
import type { PdfAnnotation } from '@study-accelerator/shared/pdf';
import { DeleteIcon } from '../../components/icons/knowra';
import {
  IconButton,
  Popover,
  PopoverDialog,
  PopoverTrigger,
  PressableButton,
  TextAreaField
} from '../../components/ui';
import { KIND_OPTIONS } from '../editor/inspector/annotationOptions';
import { sortPdfAnnotations } from './pdfGeometry';
import styles from './PdfReader.module.css';

export function PdfAnnotationsList({
  items,
  selected,
  selectionRevision = 0,
  canWrite,
  onSelect,
  onChange,
  onDelete,
  filteredOutId,
  emptyHint = true
}: {
  items: PdfAnnotation[];
  selected: string | null;
  selectionRevision?: number;
  canWrite: boolean;
  onSelect(item: PdfAnnotation): void;
  onChange(id: string, fields: Partial<PdfAnnotation>): void;
  onDelete(id: string): void;
  emptyHint?: boolean;
  filteredOutId?: string;
}) {
  const selectedCardRef = useRef<HTMLElement>(null);
  useEffect(() => {
    selectedCardRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selected, selectionRevision]);
  return (
    <>
      {!items.length && emptyHint ? (
        <p className={styles.panelEmpty}>
          选中文字后点一下颜色即可标注；用区域框选标记图片、公式和扫描页；用便签在页面任意位置写想法。
        </p>
      ) : null}
      {sortPdfAnnotations(items).map(item => (
        <section
          key={item.id}
          ref={selected === item.id ? selectedCardRef : undefined}
          className={styles.markCard}
          data-selected={selected === item.id || undefined}
          data-kind={item.kind}
          aria-label={filteredOutId === item.id ? '当前选中标注' : undefined}
        >
          {filteredOutId === item.id ? (
            <p className={styles.panelEmpty}>当前选中标注不符合筛选，仍可继续编辑。</p>
          ) : null}
          <div className={styles.markHead}>
            <PressableButton
              className={styles.markJump}
              onPress={() => onSelect(item)}
              aria-label={`定位标注 第 ${item.segments[0].pageIndex + 1} 页 ${item.quoteText || '区域标注'}`}
            >
              <span>
                第 {[...new Set(item.segments.map(segment => segment.pageIndex + 1))].join('、')} 页 ·{' '}
                {KIND_OPTIONS.find(option => option.id === item.kind)?.label}
              </span>
              <strong>{item.type === 'region' ? '区域标注' : item.type === 'note' ? '便签' : item.quoteText}</strong>
            </PressableButton>
            <div className={styles.markTrail}>
              <KindDotPicker kind={item.kind} canWrite={canWrite} onPick={kind => onChange(item.id, { kind })} />
              <span className={styles.markDeleteSlot}>
                {selected === item.id ? (
                  <IconButton
                    size={24}
                    aria-label="删除标注"
                    title="删除标注"
                    className={styles.markDelete}
                    isDisabled={!canWrite}
                    onPress={() => onDelete(item.id)}
                  >
                    <DeleteIcon size={14} />
                  </IconButton>
                ) : null}
              </span>
            </div>
          </div>
          {selected === item.id ? (
            <>
              <TextAreaField
                label="评论"
                presentation="composer"
                className={styles.commentField}
                placeholder="添加评论…"
                value={item.comment}
                maxLength={2000}
                isDisabled={!canWrite}
                onChange={comment => onChange(item.id, { comment })}
              />
            </>
          ) : item.comment ? (
            <p>{item.comment}</p>
          ) : null}
        </section>
      ))}
    </>
  );
}

/** 标题右侧的单个色点：点击后弹出五种分类的色点选择框。 */
function KindDotPicker({ kind, canWrite, onPick }: { kind: string; canWrite: boolean; onPick(kind: string): void }) {
  const [open, setOpen] = useState(false);
  const current = KIND_OPTIONS.find(option => option.id === kind);
  return (
    <PopoverTrigger isOpen={open} onOpenChange={setOpen}>
      <PressableButton
        className={styles.swatch}
        data-kind={kind}
        aria-label={`标注分类：${current?.label ?? ''}，点击修改`}
        title={`分类：${current?.label ?? ''}`}
        isDisabled={!canWrite}
      >
        <span hidden>{current?.label}</span>
      </PressableButton>
      <Popover placement="bottom end" offset={6}>
        <PopoverDialog aria-label="选择标注分类" className={styles.kindMenu}>
          {KIND_OPTIONS.map(option => (
            <PressableButton
              key={option.id}
              className={styles.kindOption}
              aria-pressed={kind === option.id}
              onPress={() => {
                onPick(option.id);
                setOpen(false);
              }}
            >
              <span className={styles.swatch} data-kind={option.id} aria-hidden="true" />
              <span>{option.label}</span>
            </PressableButton>
          ))}
        </PopoverDialog>
      </Popover>
    </PopoverTrigger>
  );
}
