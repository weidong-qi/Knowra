import { useRef, useState } from 'react';
import { Button, Checkbox, Dialog, DialogBody, DialogFooter, FileDropField } from '../../components/ui';
import { flushBeforeWorkspaceRestore } from '../../app/desktopLifecycle';
import { useAppStore } from '../../store/AppStoreProvider';
import { pdfRequest } from './pdfApi';
import styles from '../settings/SettingsView.module.css';

type Preview = { token: string; notes: number; pdfs: number; annotations: number; attachments: number };
export function ArchiveSettings() {
  const canWrite = useAppStore(state => state.canWriteWorkspace());
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState(''),
    [preview, setPreview] = useState<Preview | null>(null);
  const abort = useRef<AbortController | null>(null);
  async function inspect(file: File) {
    setBusy(true);
    setError('');
    setPreview(null);
    setConfirmed(false);
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    try {
      await flushBeforeWorkspaceRestore();
      const value = await pdfRequest<Preview>('/api/storage/archive/inspect', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': file.name.toLowerCase().endsWith('.json') ? 'application/json' : 'application/zip' },
        body: file
      });
      if (!controller.signal.aborted) setPreview(value);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '备份检查失败');
    } finally {
      setBusy(false);
    }
  }
  function close() {
    abort.current?.abort();
    if (preview) void pdfRequest(`/api/storage/archive/${preview.token}`, { method: 'DELETE' }).catch(() => undefined);
    setOpen(false);
    setPreview(null);
    setError('');
  }
  return (
    <div className={styles.settingRow}>
      <div className={styles.settingCopy}>
        <h4>资料库文件备份</h4>
        <p>导出资料、PDF 原文件和标注；导入前检查完整性，并保留恢复前保护备份。</p>
      </div>
      <div className={styles.settingControl}>
        <Button
          onPress={() => {
            void flushBeforeWorkspaceRestore()
              .then(() => {
                const anchor = document.createElement('a');
                anchor.href = '/api/storage/archive';
                anchor.download = 'Knowra-资料库.zip';
                anchor.click();
              })
              .catch(reason => setError(String(reason)));
          }}
        >
          导出资料库
        </Button>
        <Button isDisabled={!canWrite} onPress={() => setOpen(true)}>
          导入资料库…
        </Button>
      </div>
      {error && !open ? <p role="alert">{error}</p> : null}
      {open ? (
        <Dialog
          title="导入资料库备份"
          isOpen
          onOpenChange={value => {
            if (!value && !busy) close();
          }}
        >
          <DialogBody>
            <FileDropField
              label="选择备份包"
              description="支持 Knowra ZIP 资料包和旧版 JSON 快照。"
              accept=".zip,.json"
              isDisabled={busy || !canWrite}
              onSelect={files => {
                if (files[0]) void inspect(files[0]);
              }}
            />
            {busy ? <p role="status">正在传输并校验，请稍候…</p> : null}
            {preview ? (
              <>
                <p>
                  检查通过：{preview.notes} 份资料，其中 {preview.pdfs} 份 PDF、{preview.annotations} 条 PDF 标注、
                  {preview.attachments} 个原文件。
                </p>
                <p>恢复会替换当前资料库。恢复前将自动保存一份保护备份。</p>
                <Checkbox isSelected={confirmed} onChange={setConfirmed} isDisabled={busy}>
                  我确认使用这份备份替换当前资料库
                </Checkbox>
              </>
            ) : null}
            {error ? <p role="alert">{error}</p> : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" isDisabled={busy} onPress={close}>
              取消
            </Button>
            <Button
              variant="danger"
              isDisabled={!preview || !confirmed || busy || !canWrite}
              onPress={() => {
                if (!preview) return;
                setBusy(true);
                setError('');
                void flushBeforeWorkspaceRestore()
                  .then(() =>
                    pdfRequest('/api/storage/archive/restore', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ token: preview.token, confirmToken: preview.token })
                    })
                  )
                  .then(() => window.location.reload())
                  .catch(reason => {
                    setError(String(reason));
                    setBusy(false);
                  });
              }}
            >
              确认恢复资料库
            </Button>
          </DialogFooter>
        </Dialog>
      ) : null}
    </div>
  );
}
