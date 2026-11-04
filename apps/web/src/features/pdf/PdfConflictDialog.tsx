import type { PdfAnnotation } from '@study-accelerator/shared/pdf';
import { Button, Dialog, DialogBody, DialogFooter } from '../../components/ui';
import { KIND_OPTIONS } from '../editor/inspector/annotationOptions';
import type { PdfDraft } from './pdfSession';

export type PdfConflictReview = { draft: PdfDraft; remote: PdfAnnotation | null };
export function PdfConflictDialog({
  review,
  onClose,
  onResolve
}: {
  review: PdfConflictReview;
  onClose(): void;
  onResolve(keepLocal: boolean): void;
}) {
  const describe = (value: Partial<PdfAnnotation>) => (
    <>
      <p>
        {value.quoteText || (value.type === 'note' ? '便签' : '区域标注')} ·{' '}
        {KIND_OPTIONS.find(option => option.id === value.kind)?.label}
      </p>
      <p>{value.comment || '没有评论'}</p>
    </>
  );
  return (
    <Dialog
      title="核对标注修改"
      isOpen
      onOpenChange={open => {
        if (!open) onClose();
      }}
    >
      <DialogBody>
        <h3>本机草稿</h3>
        {review.draft.remove ? <p>删除这条标注</p> : describe(review.draft.fields)}
        <h3>最新版本</h3>
        {review.remote ? describe(review.remote) : <p>这条标注已删除。保留本机修改会创建一条新标注。</p>}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onPress={onClose}>
          稍后处理
        </Button>
        <Button onPress={() => onResolve(false)}>采用最新版本</Button>
        <Button variant="primary" onPress={() => onResolve(true)}>
          保留本机修改
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
