import { useEffect, useState } from 'react';
import { Button, Checkbox, Dialog, DialogBody, Select } from '../../components/ui';
import { flushBeforeWorkspaceRestore, flushBeforeWorkspaceBackup } from '../../app/desktopLifecycle';
import { downloadTextFile } from '../../browser/downloadFile';
import { useAppStore } from '../../store/AppStoreProvider';
import { captureBrowserBackupDrafts } from './backupDrafts';
import { callBackup, transferBackup, type RuntimeBackup, type BackupInspection, type BackupRestoreResult } from './backupApi';
import styles from './BackupRestoreDialog.module.css';

const displayTime = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN') : '时间未知';
const displaySize = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function BackupRestoreDialog({ isOpen, onOpenChange }: { isOpen: boolean; onOpenChange(open: boolean): void }) {
  const supportsTransfer = Boolean(window.knowraDesktop?.transferBackup);
  const hasDraft = useAppStore(state => state.editorHasLocalChanges || state.saveState === 'saving' || state.saveState === 'error' || Boolean(state.editorSaveError));
  const [backups, setBackups] = useState<RuntimeBackup[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [inspection, setInspection] = useState<BackupInspection | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [restored, setRestored] = useState<BackupRestoreResult | null>(null);
  const load = async () => setBackups((await callBackup<{ items: RuntimeBackup[] }>('backups')).items);
  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setBusy(true); setError(''); setInspection(null); setConfirmed(false); setSelectedId(''); setRestored(null);
    void callBackup<{ items: RuntimeBackup[] }>('backups').then(result => { if (active) setBackups(result.items); })
      .catch(failure => { if (active) setError(failure instanceof Error ? failure.message : '读取备份失败'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [isOpen]);
  const action = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await operation(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '备份操作失败'); }
    finally { setBusy(false); }
  };
  return <Dialog title="本机备份与恢复" isOpen={isOpen} onOpenChange={onOpenChange} size="md" isPending={busy} isDismissable={!restored}>
    <DialogBody><div className={styles.body}>
      {restored ? <>
        <p role="status">备份已恢复。重新加载后使用恢复的资料；云端同步已暂停，请核对后再连接。</p>
        <p>恢复前保护备份：{restored.protectionBackupId}</p>
        <p className={styles.hint}>原资料、待同步修改和恢复草稿已保留。可在备份列表检查“恢复前保护”并导出其中的草稿。</p>
        <Button variant="primary" onPress={() => window.location.reload()}>重新加载已恢复资料</Button>
      </> : <>
        <p>完整备份包含笔记、关联资料、附件、待同步修改和恢复草稿。检查通过后才可恢复。</p>
        <p className={styles.hint}>默认本机备份保存在本机资料目录中。可将完整备份导出到你选择的独立目录或介质，并自行保管副本。</p>
        {!supportsTransfer && <p className={styles.hint}>完整备份目录导出与导入需要桌面应用；浏览器暂不支持。</p>}
        <div className={styles.actions}>
          <Button onPress={() => { void action(async () => {
            const { hasUnsavedDrafts } = await flushBeforeWorkspaceBackup();
            const result = await callBackup<{ id: string; directory: string }>('backup', { recoveryDrafts: captureBrowserBackupDrafts() });
            await load(); setSelectedId(result.id); setInspection(null); setConfirmed(false); setNotice(`备份已保存：${result.directory}${hasUnsavedDrafts ? '。正文保存尚未完成，未保存内容已作为恢复草稿保留，请检查并导出草稿。' : ''}`);
          }); }}>创建本机备份</Button>
          <Button onPress={() => { void action(load); }}>刷新列表</Button>
          <Button isDisabled={!supportsTransfer || busy} onPress={() => { void action(async () => {
            const result = await transferBackup('import');
            if (!result) { setNotice('已取消导入，当前资料未改动。'); return; }
            await load(); setSelectedId(result.id); setInspection(null); setConfirmed(false);
            setNotice('外部完整备份已校验并导入本机列表。请检查所选备份，再明确确认整库恢复。');
          }); }}>导入外部完整备份</Button>
        </div>
        {!backups.length && <p className={styles.hint}>还没有本机备份。先创建一个备份，再从这里检查和恢复。</p>}
        {backups.length > 0 && <>
          <p className={styles.hint}>本机列出 {backups.length} 份备份，清单合计 {displaySize(backups.reduce((sum, backup) => sum + backup.size, 0))}。备份目前不会自动到期清理；清单异常的备份不计入此合计。</p>
          <Select label="选择备份" selectedKey={selectedId || null} placeholder="请选择需要检查的备份" isDisabled={busy} onSelectionChange={key => { setSelectedId(String(key)); setInspection(null); setConfirmed(false); setError(''); }} options={backups.map(backup => ({ id: backup.id, label: `${displayTime(backup.createdAt)} · ${backup.purpose === 'before-restore' ? '恢复前保护' : backup.purpose === 'manual' ? '手动备份' : backup.purpose === 'imported' ? '外部导入' : backup.purpose === 'legacy-unspecified' ? '历史备份' : '用途待检查'} · ${backup.error ? '大小待检查' : displaySize(backup.size)} · ${backup.id.slice(-8)}${backup.error ? '（清单异常）' : ''}` }))} />
        </>}
        {selectedId && <div className={styles.actions}><Button onPress={() => { void action(async () => {
          setInspection(null); setConfirmed(false);
          setInspection(await callBackup<BackupInspection>(`backups/${encodeURIComponent(selectedId)}/inspect`, {}));
        }); }}>检查所选备份</Button><Button isDisabled={!supportsTransfer || busy} onPress={() => { void action(async () => {
          const result = await transferBackup('export', selectedId);
          setNotice(result ? `完整备份已导出：${result.directory}。请保管此目录中的全部文件。` : '已取消导出，当前资料和已有目标未改动。');
        }); }}>导出所选完整备份</Button></div>}
        {inspection && <section className={styles.inspection} aria-label="备份检查结果">
          <h3>完整性检查通过</h3>
          <p>{inspection.noteCount} 篇笔记 · {inspection.attachmentCount} 个附件 · {inspection.pendingOperations} 项待同步修改</p>
          <p className={styles.hint}>已检查 {inspection.fileCount} 个文件（{displaySize(inspection.size)}）、数据库、资料引用和附件内容。</p>
          {inspection.draftCount > 0 && <><p>另保留 {inspection.draftCount} 份恢复草稿；草稿不会自动覆盖恢复后的正文。</p><Button onPress={() => { void action(async () => {
            const record = await callBackup<unknown>(`backups/${encodeURIComponent(selectedId)}/drafts`);
            downloadTextFile(`Knowra-恢复草稿-${selectedId}.json`, JSON.stringify(record, null, 2), 'application/json');
          }); }}>导出此备份的恢复草稿</Button></>}
          <p>恢复会切换整个本机资料库，并自动创建恢复前保护备份。恢复后云端同步暂停，需核对资料后重新连接。</p>
          {hasDraft && <p role="status" className={styles.hint}>请先保存或处理当前未保存的正文，再恢复备份。</p>}
          <Checkbox className={styles.confirm} isSelected={confirmed} isDisabled={hasDraft || busy} onChange={setConfirmed}>我确认使用所选备份恢复整个本机资料库</Checkbox>
          <Button variant="danger" isDisabled={!confirmed || hasDraft || busy} onPress={() => { void action(async () => {
            await flushBeforeWorkspaceRestore();
            setRestored(await callBackup<BackupRestoreResult>(`backups/${encodeURIComponent(selectedId)}/restore`, { confirmBackupId: selectedId, recoveryDrafts: captureBrowserBackupDrafts() }));
          }); }}>确认恢复所选备份</Button>
        </section>}
      </>}
      {notice && <p role="status" className={styles.hint}>{notice}</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </div></DialogBody>
  </Dialog>;
}
