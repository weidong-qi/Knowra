import type { PdfAnnotation } from '@study-accelerator/shared/pdf';
import { Menu, MenuHeader, MenuItem, MenuSection, PointMenu } from '../../components/ui/overlay';
import { KIND_OPTIONS } from '../editor/inspector/annotationOptions';
import styles from './PdfReader.module.css';

const TYPE_LABELS: Record<PdfAnnotation['type'], string> = {
  highlight: '高亮',
  underline: '下划线',
  region: '区域',
  note: '便签'
};
const summary = (value: string) => value.trim().replace(/\s+/g, ' ').slice(0, 100);

/** 仅在同一点命中多条标注时选择目标；修改与保存仍使用已有标注面板。 */
export function PdfAnnotationPicker({
  items,
  point,
  onPick,
  onClose
}: {
  items: PdfAnnotation[];
  point: { x: number; y: number };
  onPick(id: string): void;
  onClose(): void;
}) {
  return (
    <PointMenu
      point={point}
      isNonModal
      maxHeight={360}
      onOpenChange={open => {
        if (!open) onClose();
      }}
    >
      <Menu
        ariaLabel="选择标注"
        variant="rich"
        className={styles.annotationPicker}
        autoFocus="first"
        onClose={onClose}
        onAction={key => onPick(String(key))}
      >
        <MenuSection>
          <MenuHeader>选择标注（{items.length}）</MenuHeader>
          {items.map((item, index) => {
            const title = summary(item.type === 'note' ? item.title?.trim() || '便签' : item.quoteText || '区域标注');
            const label = `${index + 1}. ${TYPE_LABELS[item.type]}：${title}`;
            const kind = KIND_OPTIONS.find(option => option.id === item.kind)?.label ?? '';
            return (
              <MenuItem
                key={item.id}
                id={item.id}
                textValue={label}
                icon={<span className={styles.swatch} data-kind={item.kind} aria-hidden="true" />}
                description={`${kind} · ${summary(item.comment) || '暂无批注'}`}
              >
                <span className={styles.annotationPickerSummary}>{label}</span>
              </MenuItem>
            );
          })}
        </MenuSection>
      </Menu>
    </PointMenu>
  );
}
