import { useEffect, useState } from 'react';
import type { MarkdownImportSource } from '@study-accelerator/web-core';
import { Button, Dialog, DialogBody, DialogClose, DialogFooter, FileDropField } from '../../components/ui';
import { CloseIcon, NoteIcon } from '../../components/icons/knowra';
import styles from './MarkdownImportDialog.module.css';

const ACCEPTED_MARKDOWN = '.md,.markdown,text/markdown,text/plain';
const MAX_IMPORT_FILES = 50;
const MAX_IMPORT_BYTES = 6 * 1024 * 1024;

export function MarkdownImportDialog({
  isOpen,
  folderName,
  onOpenChange,
  onImport
}: {
  isOpen: boolean;
  folderName: string;
  onOpenChange(open: boolean): void;
  onImport(sources: MarkdownImportSource[]): Promise<void>;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setFiles([]);
      setError('');
      setPending(false);
    }
  }, [isOpen]);

  const addFiles = (incoming: File[]) => {
    const merged = dedupeFiles([...files, ...incoming]);
    const validation = validateMarkdownFiles(merged);
    if (validation) {
      setError(validation);
      return;
    }
    setFiles(merged);
    setError('');
  };
  const submit = async () => {
    const validation = validateMarkdownFiles(files);
    if (validation) {
      setError(validation);
      return;
    }
    setPending(true);
    setError('');
    try {
      const sources = await Promise.all(files.map(async (file) => ({
        fileName: file.name,
        rawMarkdown: await file.text()
      })));
      await onImport(sources);
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Markdown 导入失败');
      setPending(false);
    }
  };

  return (
    <Dialog
      title="导入 Markdown"
      description={`导入位置：${folderName}`}
      size="md"
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isPending={pending}
    >
      <DialogBody>
        <FileDropField
          accept={ACCEPTED_MARKDOWN}
          multiple
          isDisabled={pending}
          label="拖放 Markdown 文件到这里"
          description="支持 .md 与 .markdown，可一次导入多篇；也可通过键盘操作“选择文件”。"
          onSelect={addFiles}
        />
        {files.length > 0 ? (
          <section className={styles.selection} aria-label="待导入文件">
            <header aria-live="polite"><strong>待导入 {files.length} 篇</strong><span>{formatBytes(sumFileBytes(files))}</span></header>
            <ul>
              {files.map((file) => (
                <li key={fileKey(file)}>
                  <NoteIcon size={16} />
                  <span><strong>{file.name}</strong><small>{formatBytes(file.size)}</small></span>
                  <button
                    type="button"
                    aria-label={`移除 ${file.name}`}
                    disabled={pending}
                    onClick={() => setFiles((current) => current.filter((item) => fileKey(item) !== fileKey(file)))}
                  >
                    <CloseIcon size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
      </DialogBody>
      <DialogFooter>
        <DialogClose variant="ghost">取消</DialogClose>
        <Button variant="primary" isDisabled={files.length === 0} isPending={pending} onPress={() => void submit()}>
          导入{files.length > 0 ? ` ${files.length} 篇` : ''}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function validateMarkdownFiles(files: File[]): string {
  if (files.length === 0) return '请先选择 Markdown 文件';
  if (files.length > MAX_IMPORT_FILES) return `一次最多导入 ${MAX_IMPORT_FILES} 个文件，请减少待导入文件`;
  const invalid = files.find((file) => !/\.(md|markdown)$/i.test(file.name));
  if (invalid) return `${invalid.name} 不是受支持的 Markdown 文件，请仅选择 .md 或 .markdown`;
  if (sumFileBytes(files) > MAX_IMPORT_BYTES) return '本次导入文件总大小不能超过 6 MB，请移除较大的文件';
  return '';
}

function dedupeFiles(files: File[]): File[] {
  return [...new Map(files.map((file) => [fileKey(file), file])).values()];
}

function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function sumFileBytes(files: File[]): number {
  return files.reduce((total, file) => total + file.size, 0);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${integerFormatter.format(bytes)} B`;
  if (bytes < 1024 * 1024) return `${integerFormatter.format(Math.ceil(bytes / 1024))} KB`;
  return `${decimalFormatter.format(bytes / (1024 * 1024))} MB`;
}

const integerFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 });
const decimalFormatter = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
