import type { PdfAnnotation } from '@study-accelerator/shared/pdf';
import { Button, PressableButton, Select, TextAreaField } from '../../components/ui';
import { KIND_OPTIONS, IMPORTANCE_OPTIONS } from '../editor/inspector/annotationOptions';
import { sortPdfAnnotations } from './pdfGeometry';
import styles from './PdfReader.module.css';

export function PdfAnnotationsPanel({
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
    <aside className={styles.annotations} aria-label="PDF 标注">
      <h2 className={styles.panelHeader}>
        标注 <small>{items.length}</small>
      </h2>
      <div className={styles.panelBody}>
        {!items.length ? (
          <p className={styles.panelEmpty}>选中文字后点击“高亮选区”，或使用区域框选标记图片、公式和扫描页。</p>
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
                <Select
                  label="重要程度"
                  options={IMPORTANCE_OPTIONS}
                  selectedKey={item.importance}
                  isDisabled={!canWrite}
                  onSelectionChange={key => onChange(item.id, { importance: String(key) })}
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
      </div>
    </aside>
  );
}
