import type { PdfAnnotation } from '@study-accelerator/shared/pdf';
import { PressableButton, SegmentedButton, SegmentedControl } from '../../components/ui';
import { PdfAnnotationsList } from './PdfAnnotationsPanel';
import styles from './PdfReader.module.css';

export type PdfPanelTab = 'marks' | 'outline';
export interface PdfOutlineItem {
  title: string;
  dest: unknown;
  depth: number;
}

/** 右侧合并面板：标注与目录共用一张检查器风格的卡片，顶部切换。 */
export function PdfSidePanel({
  tab,
  onTab,
  items,
  outline,
  selected,
  canWrite,
  onSelect,
  onChange,
  onDelete,
  onOutlineItem
}: {
  tab: PdfPanelTab;
  onTab(tab: PdfPanelTab): void;
  items: PdfAnnotation[];
  outline: PdfOutlineItem[];
  selected: string | null;
  canWrite: boolean;
  onSelect(item: PdfAnnotation): void;
  onChange(id: string, fields: Partial<PdfAnnotation>): void;
  onDelete(id: string): void;
  onOutlineItem(item: PdfOutlineItem): void;
}) {
  return (
    <aside className={styles.sidePanel} aria-label="PDF 侧栏">
      <div className={styles.panelHeader}>
        <SegmentedControl variant="underline" className={styles.panelTabs} aria-label="侧栏内容">
          <SegmentedButton aria-pressed={tab === 'marks'} count={items.length} onPress={() => onTab('marks')}>
            标注
          </SegmentedButton>
          <SegmentedButton aria-pressed={tab === 'outline'} onPress={() => onTab('outline')}>
            目录
          </SegmentedButton>
        </SegmentedControl>
      </div>
      <div className={styles.panelBody}>
        {tab === 'marks' ? (
          <PdfAnnotationsList
            items={items}
            selected={selected}
            canWrite={canWrite}
            onSelect={onSelect}
            onChange={onChange}
            onDelete={onDelete}
          />
        ) : outline.length ? (
          outline.map((item, index) => (
            <PressableButton
              key={index}
              className={styles.outlineItem}
              style={{ paddingLeft: `${12 + item.depth * 12}px` }}
              onPress={() => onOutlineItem(item)}
            >
              {item.title}
            </PressableButton>
          ))
        ) : (
          <p className={styles.panelEmpty}>这份 PDF 没有目录。</p>
        )}
      </div>
    </aside>
  );
}
