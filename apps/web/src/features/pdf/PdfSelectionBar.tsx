import { PressableButton } from '../../components/ui';
import { KIND_OPTIONS } from '../editor/inspector/annotationOptions';
import styles from './PdfReader.module.css';

export type PdfBarAnchor = { x: number; top: number; bottom: number };

/** 选中文字或框选区域后，在选区旁浮出的分类色条：点一下颜色即保存标注。 */
export function PdfSelectionBar({ anchor, onPick }: { anchor: PdfBarAnchor; onPick(kind: string): void }) {
  // 贴近视口顶部时翻到选区下方，避免被工具栏遮住。
  const below = anchor.top < 64;
  return (
    <div
      className={styles.selectionBar}
      role="toolbar"
      aria-label="选择标注分类"
      style={{ left: anchor.x, top: below ? anchor.bottom + 8 : anchor.top - 8 }}
      data-below={below || undefined}
      onMouseDown={event => event.preventDefault()}
    >
      {KIND_OPTIONS.map(option => (
        <PressableButton
          key={option.id}
          className={styles.swatch}
          data-kind={option.id}
          aria-label={`标注为${option.label}`}
          title={option.label}
          onPress={() => onPick(option.id)}
        >
          <span hidden>{option.label}</span>
        </PressableButton>
      ))}
    </div>
  );
}
