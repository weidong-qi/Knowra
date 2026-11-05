import { Button, SearchBox, Select } from '../../components/ui';
import { KIND_OPTIONS } from '../editor/inspector/annotationOptions';
import type { PdfAnnotation } from '@study-accelerator/shared/pdf';
import styles from './PdfReader.module.css';

export type PdfMarkFilter = { query: string; kind: string; page: string; comment: string };
export const EMPTY_PDF_FILTER: PdfMarkFilter = { query: '', kind: 'all', page: 'all', comment: 'all' };
export function filterPdfAnnotations(items: PdfAnnotation[], filter: PdfMarkFilter) {
  const query = filter.query.trim().normalize('NFKC').toLocaleLowerCase();
  return items.filter(
    item =>
      !item.deletedAt &&
      (filter.kind === 'all' || item.kind === filter.kind) &&
      (filter.page === 'all' || item.segments.some(segment => segment.pageIndex + 1 === Number(filter.page))) &&
      (filter.comment === 'all' || Boolean(item.comment?.trim()) === (filter.comment === 'with')) &&
      (!query || `${item.quoteText}\n${item.comment}`.normalize('NFKC').toLocaleLowerCase().includes(query))
  );
}
export function PdfAnnotationFilters({
  filter,
  onChange,
  items,
  count
}: {
  filter: PdfMarkFilter;
  onChange(filter: PdfMarkFilter): void;
  items: PdfAnnotation[];
  count: number;
}) {
  const pages = [
    ...new Set([
      ...items.flatMap(item => item.segments.map(segment => segment.pageIndex + 1)),
      ...(filter.page === 'all' ? [] : [Number(filter.page)])
    ])
  ].sort((a, b) => a - b);
  const update = (field: keyof PdfMarkFilter, value: string) => onChange({ ...filter, [field]: value });
  const active = filter.query || filter.kind !== 'all' || filter.page !== 'all' || filter.comment !== 'all';
  return (
    <div className={styles.markFilters} role="group" aria-label="标注筛选">
      <SearchBox
        label="搜索标注和批注"
        size="sidebar"
        placeholder="搜索摘录或批注"
        value={filter.query}
        onChange={event => update('query', event.target.value)}
        onClear={() => update('query', '')}
      />
      <div className={styles.markFilterFields}>
        <Select
          label="标注分类"
          presentation="toolbar"
          selectedKey={filter.kind}
          onSelectionChange={key => update('kind', String(key))}
          options={[{ id: 'all', label: '全部分类' }, ...KIND_OPTIONS]}
        />
        <Select
          label="标注页码"
          presentation="toolbar"
          selectedKey={filter.page}
          onSelectionChange={key => update('page', String(key))}
          options={[
            { id: 'all', label: '全部页码' },
            ...pages.map(page => ({ id: String(page), label: `第 ${page} 页` }))
          ]}
        />
        <Select
          label="批注状态"
          presentation="toolbar"
          selectedKey={filter.comment}
          onSelectionChange={key => update('comment', String(key))}
          options={[
            { id: 'all', label: '全部批注状态' },
            { id: 'with', label: '有批注' },
            { id: 'without', label: '无批注' }
          ]}
        />
      </div>
      <div className={styles.markFilterSummary}>
        <span aria-live="polite">
          显示 {count} / {items.length} 条标注
        </span>
        {active ? (
          <Button variant="ghost" size="mini" onPress={() => onChange(EMPTY_PDF_FILTER)}>
            清除筛选
          </Button>
        ) : null}
      </div>
    </div>
  );
}
