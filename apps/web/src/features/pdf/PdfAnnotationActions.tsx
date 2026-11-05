import type { PdfAnnotation } from '@study-accelerator/shared/pdf';
import { Button, PointMenu, PopoverDialog, PressableButton } from '../../components/ui';
import { CopyIcon, DeleteIcon, EditIcon } from '../../components/icons/knowra';
import { KIND_OPTIONS } from '../editor/inspector/annotationOptions';
import styles from './PdfReader.module.css';

/** 已有文字标注的操作面板，使用共享坐标定位、按钮与分类色点。 */
export function PdfAnnotationActions({
  item,
  point,
  canWrite,
  onClose,
  onCopy,
  onEdit,
  onKind,
  onDelete
}: {
  item: PdfAnnotation;
  point: { x: number; y: number };
  canWrite: boolean;
  onClose(): void;
  onCopy(): void;
  onEdit(): void;
  onKind(kind: string): void;
  onDelete(): void;
}) {
  return (
    <PointMenu
      surface="popover"
      point={point}
      onOpenChange={open => {
        if (!open) onClose();
      }}
    >
      <PopoverDialog aria-label="PDF 标注操作" className={styles.annotationActions}>
        <div className={styles.annotationCommands}>
          <Button
            variant="ghost"
            size="mini"
            shape="square"
            icon={<EditIcon size={16} />}
            isDisabled={!canWrite}
            onPress={onEdit}
          >
            {item.comment ? '编辑批注' : '添加批注'}
          </Button>
          <Button variant="ghost" size="mini" shape="square" icon={<CopyIcon size={16} />} onPress={onCopy}>
            复制
          </Button>
          <Button
            variant="ghost"
            size="mini"
            shape="square"
            icon={<DeleteIcon size={16} />}
            isDisabled={!canWrite}
            onPress={onDelete}
          >
            删除
          </Button>
        </div>
        <div className={styles.annotationKinds} role="group" aria-label="修改标注分类">
          {KIND_OPTIONS.map(option => (
            <PressableButton
              key={option.id}
              className={styles.swatch}
              data-kind={option.id}
              aria-label={`改为${option.label}`}
              aria-pressed={item.kind === option.id}
              isDisabled={!canWrite}
              onPress={() => onKind(option.id)}
            >
              <span hidden>{option.label}</span>
            </PressableButton>
          ))}
        </div>
      </PopoverDialog>
    </PointMenu>
  );
}
