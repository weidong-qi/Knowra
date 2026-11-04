import type { PdfAnnotation } from '@study-accelerator/shared/pdf';
import { CloseIcon } from '../../components/icons/knowra';
import { IconButton, PressableButton, Tabs, type TabsItem } from '../../components/ui';
import { PdfAnnotationsList } from './PdfAnnotationsPanel';
import styles from './PdfReader.module.css';

export type PdfPanelTab = 'marks' | 'outline';
export interface PdfOutlineItem {
  title: string;
  dest: unknown;
  depth: number;
}

/** 右侧检查器：顶部标题与关闭按钮，下方用与文档检查器一致的标签页切换标注与目录。 */
export function PdfSidePanel({
  tab,
  onTab,
  items,
  outline,
  selected,
  canWrite,
  onClose,
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
  onClose(): void;
  onSelect(item: PdfAnnotation): void;
  onChange(id: string, fields: Partial<PdfAnnotation>): void;
  onDelete(id: string): void;
  onOutlineItem(item: PdfOutlineItem): void;
}) {
  const tabs: TabsItem[] = [
    { id: 'marks', label: items.length ? `标注 ${items.length}` : '标注' },
    { id: 'outline', label: '目录' }
  ];
  return (
    <aside className={styles.sidePanel} aria-label="PDF 检查器">
      <IconButton className={styles.panelClose} aria-label="关闭 PDF 检查器" onPress={onClose}>
        <CloseIcon size={18} />
      </IconButton>
      <Tabs
        className={styles.panelTabs}
        aria-label="检查器视图"
        items={tabs}
        selectedKey={tab}
        onSelectionChange={key => onTab(String(key) as PdfPanelTab)}
      >
        {item =>
          item.id === 'marks' ? (
            <PdfAnnotationsList
              items={items}
              selected={selected}
              canWrite={canWrite}
              onSelect={onSelect}
              onChange={onChange}
              onDelete={onDelete}
            />
          ) : outline.length ? (
            outline.map((entry, index) => (
              <PressableButton
                key={index}
                className={styles.outlineItem}
                style={{ paddingLeft: `${12 + entry.depth * 12}px` }}
                onPress={() => onOutlineItem(entry)}
              >
                {entry.title}
              </PressableButton>
            ))
          ) : (
            <p className={styles.panelEmpty}>这份 PDF 没有目录。</p>
          )
        }
      </Tabs>
    </aside>
  );
}
