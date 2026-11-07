import { useEffect, useRef, useState } from 'react';
import { MAX_PDF_BYTES } from '@study-accelerator/shared/pdf';
import { Button, Dialog, DialogBody, DialogFooter, FileDropField } from '../../components/ui';
import { useAppStore } from '../../store/AppStoreProvider';
import { trackDesktopTask } from '../../app/desktopLifecycle';
import { importPdf, randomId } from './pdfApi';

export function PdfImportDialog({ onClose, onImported }: { onClose(): void; onImported(id: string): void }) {
  const spaceId = useAppStore(state => state.serverData.currentSpaceId);
  const folderId = useAppStore(state => state.navigation.selectedFolderId);
  const loadWorkspace = useAppStore(state => state.loadWorkspace);
  const canWrite = useAppStore(state => state.canWriteWorkspace());
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const operation = useRef(randomId());
  const abort = useRef<AbortController | null>(null);
  const currentSpace = useRef(spaceId);
  currentSpace.current = spaceId;
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    abort.current?.abort();
  }, [spaceId]);
  async function submit() {
    if (!file || !spaceId || !canWrite) return;
    if (file.size <= 0 || file.size > MAX_PDF_BYTES) {
      setError('请选择不超过 50 MiB 的 PDF');
      return;
    }
    setError('');
    setProgress(0);
    const controller = new AbortController();
    abort.current = controller;
    const captured = spaceId;
    try {
      const note = await trackDesktopTask(() =>
        importPdf(file, { spaceId, folderId, operationId: operation.current }, controller.signal, setProgress)
      );
      if (currentSpace.current !== captured || controller.signal.aborted) return;
      await loadWorkspace();
      if (currentSpace.current !== captured || controller.signal.aborted) return;
      onImported(note.id);
      onClose();
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '导入失败');
    } finally {
      setProgress(null);
    }
  }
  return (
    <Dialog
      title="导入 PDF"
      isOpen
      onOpenChange={open => {
        if (!open) {
          abort.current?.abort();
          onClose();
        }
      }}
    >
      <DialogBody>
        <FileDropField
          label="选择 PDF"
          description="单个文件最大 50 MiB，原文件会保存到当前资料库。"
          accept=".pdf,application/pdf"
          isDisabled={progress !== null || !canWrite}
          onSelect={files => {
            setFile(files[0] ?? null);
            operation.current = randomId();
            setError('');
          }}
        />
        {file ? (
          <p>
            {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MiB
          </p>
        ) : null}
        {progress !== null ? (
          <p role="status">{progress < 100 ? `正在上传：${progress}%` : '正在校验并保存…'}</p>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
      </DialogBody>
      <DialogFooter>
        <Button
          variant="ghost"
          onPress={() => {
            abort.current?.abort();
            onClose();
          }}
        >
          取消
        </Button>
        <Button isDisabled={!file || !canWrite || progress !== null} onPress={() => void submit()}>
          导入并打开
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
