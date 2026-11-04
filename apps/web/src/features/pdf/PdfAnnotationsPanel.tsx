import type { PdfAnnotation } from '@study-accelerator/shared/pdf';
import { Button, PressableButton, Select, TextAreaField } from '../../components/ui';
import { KIND_OPTIONS } from '../editor/inspector/annotationOptions';
import { sortPdfAnnotations } from './pdfGeometry';
import styles from './PdfReader.module.css';

export function PdfAnnotationsList({
  items,
  selected,
  canWrite,
  onSelect,
  onChange,
  onDelete
}: {
  items: PdfAnnotation[];
  selected: string | null;
  canWrite: boolean;
  onSelect(item: PdfAnnotation): void;
  onChange(id: string, fields: Partial<PdfAnnotation>): void;
  onDelete(id: string): void;
}) {
  return (
    <>
      {!items.length ? (
        <p className={styles.panelEmpty}>选中文字后点一下颜色即可标注；用区域框选标记图片、公式和扫描页。</p>
      ) : null}
      {sortPdfAnnotations(items).map(item => (
        <section
          key={item.id}
          className={styles.markCard}
          data-selected={selected === item.id || undefined}
          data-kind={item.kind}
        >
          <PressableButton
            className={styles.markJump}
            onPress={() => onSelect(item)}
            aria-label={`定位标注 第 ${item.segments[0].pageIndex + 1} 页 ${item.quoteText || '区域标注'}`}
          >
            <span>
              第 {[...new Set(item.segments.map(segment => segment.pageIndex + 1))].join('、')} 页 ·{' '}
              {KIND_OPTIONS.find(option => option.id === item.kind)?.label}
            </span>
            <strong>{item.type === 'region' ? '区域标注' : item.quoteText}</strong>
          </PressableButton>
          {selected === item.id ? (
            <>
              <Select
                label="标注分类"
                options={KIND_OPTIONS}
                selectedKey={item.kind}
                isDisabled={!canWrite}
                onSelectionChange={key => onChange(item.id, { kind: String(key) })}
              />
              <TextAreaField
                label="评论"
                value={item.comment}
                maxLength={2000}
                isDisabled={!canWrite}
                onChange={comment => onChange(item.id, { comment })}
              />
              <Button size="compact" variant="danger" isDisabled={!canWrite} onPress={() => onDelete(item.id)}>
                删除标注
              </Button>
            </>
          ) : item.comment ? (
            <p>{item.comment}</p>
          ) : null}
        </section>
      ))}
    </>
  );
}
