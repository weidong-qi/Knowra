import { Button, PressableButton } from '../../components/ui';
import { KIND_OPTIONS } from '../editor/inspector/annotationOptions';
import styles from './PdfReader.module.css';

export type PdfBarAnchor = { x: number; top: number; bottom: number };

/** 选中文字或框选区域后，在选区旁浮出的分类色条：点一下颜色即保存标注。 */
export type PdfTextMode = 'highlight' | 'underline';
const TEXT_MODES: Array<{ id: PdfTextMode; label: string }> = [
  { id: 'highlight', label: '高亮' },
  { id: 'underline', label: '下划线' }
];

export function PdfSelectionBar({
  anchor,
  onPick,
  mode,
  onMode,
  onLookup,
  onTranslate,
  canAnnotate = true,
  inline = false,
  selectedKind
}: {
  anchor: PdfBarAnchor;
  onPick(kind: string): void;
  /** 仅文字选区提供：在高亮和下划线之间切换，并由阅读器记住。 */
  mode?: PdfTextMode;
  onMode?(mode: PdfTextMode): void;
  onLookup?(): void;
  /** 句段翻译：只在用户点击时把选中文字发送给模型。 */
  onTranslate?(): void;
  canAnnotate?: boolean;
  /** 查词卡片内复用同一套标注操作，避免两个定位浮层重叠。 */
  inline?: boolean;
  /** 提供此值时分类色点只用于设置，实际创建由卡片的明确按钮提交。 */
  selectedKind?: string;
}) {
  // 贴近视口顶部时翻到选区下方，避免被工具栏遮住。
  const below = anchor.top < 64;
  return (
    <div
      className={`${styles.selectionBar} ${inline ? styles.selectionBarInline : ''}`}
      role="toolbar"
      aria-label="选择标注分类"
      style={inline ? undefined : { left: anchor.x, top: below ? anchor.bottom + 8 : anchor.top - 8 }}
      data-below={(!inline && below) || undefined}
      onMouseDown={event => event.preventDefault()}
    >
      {onLookup ? (
        <Button variant="ghost" size="mini" onPress={onLookup}>
          查词
        </Button>
      ) : null}
      {onTranslate ? (
        <Button variant="ghost" size="mini" onPress={onTranslate}>
          翻译
        </Button>
      ) : null}
      {canAnnotate && mode && onMode ? (
        <>
          {TEXT_MODES.map(item => (
            <PressableButton
              key={item.id}
              className={styles.modeButton}
              aria-pressed={mode === item.id}
              aria-label={`标注样式：${item.label}`}
              onPress={() => onMode(item.id)}
            >
              {item.label}
            </PressableButton>
          ))}
          <span className={styles.barDivider} aria-hidden="true" />
        </>
      ) : null}
      {canAnnotate
        ? KIND_OPTIONS.map(option => (
            <PressableButton
              key={option.id}
              className={styles.swatch}
              data-kind={option.id}
              aria-label={selectedKind === undefined ? `标注为${option.label}` : `选择分类：${option.label}`}
              aria-pressed={selectedKind === undefined ? undefined : selectedKind === option.id}
              title={option.label}
              onPress={() => onPick(option.id)}
            >
              <span hidden>{option.label}</span>
            </PressableButton>
          ))
        : null}
    </div>
  );
}
