import { useState } from 'react';
import { FilterIcon, SearchIcon } from '../../components/icons/knowra';
import {
  Button,
  IconButton,
  Popover,
  PopoverDialog,
  PopoverTrigger,
  SearchBox,
  SegmentedButton,
  SegmentedControl,
  Select,
  TagGroup,
  type TagItem
} from '../../components/ui';
import { KIND_OPTIONS } from '../editor/inspector/annotationOptions';
import type { PdfAnnotation } from '@study-accelerator/shared/pdf';
import styles from './PdfAnnotationFilters.module.css';

export type PdfMarkFilter = { query: string; kind: string; page: string; comment: string };
export const EMPTY_PDF_FILTER: PdfMarkFilter = { query: '', kind: 'all', page: 'all', comment: 'all' };
const COMMENT_OPTIONS = [
  { id: 'all', label: '全部' },
  { id: 'with', label: '有批注' },
  { id: 'without', label: '无批注' }
];
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
  const [open, setOpen] = useState(false);
  const pages = [
    ...new Set([
      ...items.flatMap(item => item.segments.map(segment => segment.pageIndex + 1)),
      ...(filter.page === 'all' ? [] : [Number(filter.page)])
    ])
  ].sort((a, b) => a - b);
  const update = (field: keyof PdfMarkFilter, value: string) => onChange({ ...filter, [field]: value });
  const chips: TagItem[] = [];
  if (filter.kind !== 'all')
    chips.push({
      id: 'kind',
      label: KIND_OPTIONS.find(option => option.id === filter.kind)?.label ?? filter.kind,
      tone: 'accent',
      hideDot: true
    });
  if (filter.page !== 'all') chips.push({ id: 'page', label: `第 ${filter.page} 页`, tone: 'accent', hideDot: true });
  if (filter.comment !== 'all')
    chips.push({
      id: 'comment',
      label: filter.comment === 'with' ? '有批注' : '无批注',
      tone: 'accent',
      hideDot: true
    });
  const active = Boolean(filter.query || chips.length);
  return (
    <div className={styles.filters} role="group" aria-label="标注筛选">
      <div className={styles.searchRow}>
        <SearchBox
          label="搜索标注和批注"
          icon={<SearchIcon size={16} />}
          size="sidebar"
          surfaceProps={{ style: { margin: 0 } }}
          placeholder="搜索摘录或批注"
          value={filter.query}
          onChange={event => update('query', event.target.value)}
          onClear={filter.query ? () => update('query', '') : undefined}
        />
        <PopoverTrigger isOpen={open} onOpenChange={setOpen}>
          <IconButton
            aria-label={chips.length ? `筛选标注，已启用 ${chips.length} 项` : '筛选标注'}
            title="筛选标注"
            tone="outline"
            shape="square"
            count={chips.length}
          >
            <FilterIcon size={17} />
          </IconButton>
          <Popover placement="bottom end" offset={10} className={styles.popover}>
            <PopoverDialog aria-label="筛选标注" className={styles.dialog}>
              <header className={styles.header}>
                <strong>筛选</strong>
                <Button
                  variant="ghost"
                  size="mini"
                  aria-label="重置筛选条件"
                  onPress={() => onChange({ ...EMPTY_PDF_FILTER, query: filter.query })}
                >
                  重置
                </Button>
              </header>
              <section className={styles.section} aria-label="标注分类">
                <span className={styles.label}>标注分类</span>
                <SegmentedControl variant="outline" density="compact" className={styles.choices} aria-label="标注分类">
                  {[{ id: 'all', label: '全部' }, ...KIND_OPTIONS].map(option => (
                    <SegmentedButton
                      key={option.id}
                      aria-pressed={filter.kind === option.id}
                      onPress={() => update('kind', option.id)}
                    >
                      {option.id === 'all' ? null : (
                        <span className={styles.kindDot} data-kind={option.id} aria-hidden="true" />
                      )}
                      {option.label}
                    </SegmentedButton>
                  ))}
                </SegmentedControl>
              </section>
              <div className={styles.pageRow}>
                <span className={styles.label}>页码</span>
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
              </div>
              <section className={styles.section} aria-label="批注状态">
                <span className={styles.label}>批注</span>
                <SegmentedControl variant="outline" density="compact" className={styles.choices} aria-label="批注状态">
                  {COMMENT_OPTIONS.map(option => (
                    <SegmentedButton
                      key={option.id}
                      aria-pressed={filter.comment === option.id}
                      onPress={() => update('comment', option.id)}
                    >
                      {option.label}
                    </SegmentedButton>
                  ))}
                </SegmentedControl>
              </section>
            </PopoverDialog>
          </Popover>
        </PopoverTrigger>
      </div>
      {chips.length ? (
        <TagGroup
          label="已选筛选条件"
          visibleLabel={false}
          items={chips}
          onRemove={keys => {
            const next = { ...filter };
            for (const key of keys) if (key === 'kind' || key === 'page' || key === 'comment') next[key] = 'all';
            onChange(next);
          }}
        />
      ) : null}
      <div className={styles.summary}>
        <span aria-live="polite">{count} 条标注</span>
        {active ? (
          <Button variant="ghost" size="mini" aria-label="清除筛选" onPress={() => onChange(EMPTY_PDF_FILTER)}>
            清除
          </Button>
        ) : null}
      </div>
    </div>
  );
}
