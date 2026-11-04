import { useMemo } from 'react';
import { Button, Dialog, DialogBody, DialogClose, DialogFooter } from '../../components/ui';
import {
  inspectAndRepairMarkdown,
  type DocumentRepairReport
} from './editorDocumentRepair';

export interface EditorDocumentRepairDialogProps {
  markdown: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  onApply(markdown: string, report: DocumentRepairReport): void;
}

export function EditorDocumentRepairDialog({
  markdown,
  open,
  onOpenChange,
  onApply
}: EditorDocumentRepairDialogProps) {
  const result = useMemo(() => inspectAndRepairMarkdown(markdown), [markdown]);
  return (
    <Dialog
      title="检查异常格式"
      description="仅处理编辑器异常生成的连续空行与独立反斜杠；围栏代码块内容保持不变。确认后仍可使用撤销恢复。"
      isOpen={open}
      onOpenChange={onOpenChange}
      size="md"
    >
      <DialogBody>
        {result.report.total > 0 ? (
          <ul aria-label="异常格式检查结果">
            <li>可合并的多余空行：{result.report.excessiveBlankLines}</li>
            <li>可移除的独立反斜杠：{result.report.standaloneBackslashes}</li>
          </ul>
        ) : <p role="status">未发现可自动修复的异常格式。</p>}
      </DialogBody>
      <DialogFooter>
        <DialogClose variant="ghost">取消</DialogClose>
        <Button
          isDisabled={!result.changed}
          onPress={() => {
            onApply(result.markdown, result.report);
            onOpenChange(false);
          }}
        >
          {result.changed ? '应用修复' : '无需修复'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
