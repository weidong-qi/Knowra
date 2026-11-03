import { useEffect, useRef, useState } from 'react';
import { apiClient, createWorkspaceApi } from '@study-accelerator/web-core';
import { Button, Checkbox, Dialog, DialogBody } from '../../components/ui';
import { flushBeforeWorkspaceRestore } from '../../app/desktopLifecycle';
import { useAppStore, useAppStoreApi } from '../../store/AppStoreProvider';
import { captureBrowserBackupDrafts } from '../sync/backupDrafts';
import { callBackup, type BackupInspection } from '../sync/backupApi';
import { createHeadlessNoteCodec, type HeadlessNoteCodec } from '../editor/headlessNoteCodec';
import {
  checkInlineMigration,
  executeInlineMigration,
  summarizeChecks,
  type MigrationApi,
  type MigrationProgress,
  type NoteMigrationCheck,
  type NoteMigrationResult
} from '../editor/annotationInlineMigrationRunner';
import styles from './AnnotationInlineMigrationDialog.module.css';

interface SyncStatus {
  serverUrl: string | null;
  error: { code: string; message: string } | null;
  conflicts: unknown[];
  entityConflict?: unknown | null;
}

async function callSync(path = '', body?: unknown): Promise<SyncStatus> {
  const response = await fetch(`/api/local-runtime/sync${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(result?.error?.message ?? '无法读取同步状态。');
  return result.data;
}

/**
 * 连着云端时，迁移前先同步一次并要求成功：新客户端要求同步能力 inline-annotations-v1，
 * 云端未升级会在握手时拒绝，此时迁移出来的重点无法同步，必须先升级云端。
 */
async function assertSyncReady() {
  const status = await callSync();
  if (!status.serverUrl) return false;
  const synced = await callSync('/retry', {});
  if (synced.error)
    throw new Error(
      `云端同步未成功，已停止迁移：${synced.error.message}（如果提示需要升级，请先把云端升级到支持正文重点的版本）`
    );
  if (synced.conflicts?.length || synced.entityConflict)
    throw new Error('还有同步冲突没有处理，已停止迁移。请先在同步面板处理冲突。');
  return true;
}

type Stage = 'checking' | 'ready' | 'running' | 'done' | 'error';

export function AnnotationInlineMigrationDialog({
  isOpen,
  onOpenChange
}: {
  isOpen: boolean;
  onOpenChange(open: boolean): void;
}) {
  const store = useAppStoreApi();
  const hasDraft = useAppStore(
    state => state.editorHasLocalChanges || state.saveState === 'saving' || state.saveState === 'error'
  );
  const [stage, setStage] = useState<Stage>('checking');
  const [progress, setProgress] = useState<MigrationProgress | null>(null);
  const [checks, setChecks] = useState<NoteMigrationCheck[]>([]);
  const [results, setResults] = useState<NoteMigrationResult[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [backupDirectory, setBackupDirectory] = useState('');
  const codecRef = useRef<HeadlessNoteCodec | null>(null);
  const api = useRef(createWorkspaceApi({ requestJson: apiClient.requestJson }));

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setStage('checking');
    setChecks([]);
    setResults([]);
    setConfirmed(false);
    setError('');
    setBackupDirectory('');
    void (async () => {
      try {
        if (store.getState().workspaceLoadState !== 'ready') await store.getState().loadWorkspace();
        if (!active) return;
        const workspace = store.getState();
        if (!workspace.canWriteWorkspace() || workspace.workspaceLoadState !== 'ready')
          throw new Error('资料尚未成功加载或处于只读恢复模式，请恢复连接后重试。');
        codecRef.current ??= await createHeadlessNoteCodec();
        const refs = workspace.serverData.notes
          .filter(note => note.spaceId)
          .map(note => ({ id: note.id, title: note.title, spaceId: note.spaceId!, deleted: note.deleted }));
        const found = await checkInlineMigration(refs, api.current, codecRef.current, next => {
          if (active) setProgress(next);
        });
        if (!active) return;
        setChecks(found);
        setStage('ready');
      } catch (failure) {
        if (active) {
          setError(failure instanceof Error ? failure.message : '检查失败');
          setStage('error');
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [isOpen, store]);

  useEffect(
    () => () => {
      void codecRef.current?.destroy();
      codecRef.current = null;
    },
    []
  );

  const assertWritable = () => {
    const workspace = store.getState();
    if (!workspace.canWriteWorkspace() || workspace.workspaceLoadState !== 'ready')
      throw new Error('资料已进入只读或加载状态，已停止迁移。');
  };

  const run = async () => {
    if (!codecRef.current) return;
    setStage('running');
    setError('');
    try {
      assertWritable();
      const syncing = await assertSyncReady();
      await flushBeforeWorkspaceRestore();
      assertWritable();
      const backup = await callBackup<{ id: string; directory: string }>('backup', {
        recoveryDrafts: captureBrowserBackupDrafts()
      });
      const inspection = await callBackup<BackupInspection & { restoreReady?: boolean }>(
        `backups/${encodeURIComponent(backup.id)}/inspect`,
        {}
      );
      if (!inspection.valid || inspection.restoreReady === false)
        throw new Error('迁移前备份未通过完整恢复检查，已停止迁移。');
      setBackupDirectory(backup.directory);
      assertWritable();
      const guardedApi: MigrationApi = {
        ...api.current,
        updateNote: (id, input) => {
          assertWritable();
          return api.current.updateNote(id, input);
        },
        updateAnnotation: (id, input) => {
          assertWritable();
          if (!api.current.updateAnnotation) throw new Error('无法转移重点备注');
          return api.current.updateAnnotation(id, input);
        },
        deleteAnnotation: (id, revision) => {
          assertWritable();
          return api.current.deleteAnnotation(id, revision);
        }
      };
      const done = await executeInlineMigration(checks, guardedApi, codecRef.current, setProgress);
      setResults(done);
      await store.getState().loadWorkspace();
      if (syncing) await callSync('/retry', {}).catch(() => undefined);
      setStage('done');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '迁移失败');
      setStage('error');
    }
  };

  const summary = summarizeChecks(checks);
  const counts = {
    migrated: results.filter(item => item.status === 'migrated').length,
    skipped: results.filter(item => item.status === 'skipped').length,
    failed: results.filter(item => item.status === 'failed').length
  };
  const busy = stage === 'checking' || stage === 'running';

  return (
    <Dialog
      title="迁移重点到正文"
      isOpen={isOpen}
      onOpenChange={open => {
        if (!busy) onOpenChange(open);
      }}
      size="md"
      isPending={busy}
      isDismissable={!busy}
    >
      <DialogBody>
        <div className={styles.body}>
          {busy ? (
            <p role="status">
              {stage === 'checking' ? '正在检查' : '正在迁移'}
              {progress?.total ? `（${progress.done}/${progress.total}）` : ''}
              {progress?.title ? `：${progress.title}` : '…'}
            </p>
          ) : null}

          {stage === 'ready' && !checks.length ? (
            <p role="status">没有需要迁移的旧重点。新建的重点已经直接写在正文里。</p>
          ) : null}

          {stage === 'ready' && checks.length ? (
            <>
              <p>旧重点会被写进正文，成为正文里的标记；之后新建、取消、修改重点都直接在正文里完成。</p>
              <dl className={styles.summary}>
                <div>
                  <dt>涉及笔记</dt>
                  <dd>{summary.notes}</dd>
                </div>
                <div>
                  <dt>可迁移重点</dt>
                  <dd>{summary.migratable}</dd>
                </div>
                <div>
                  <dt>无法定位、将放弃</dt>
                  <dd>{summary.abandoned}</dd>
                </div>
                <div>
                  <dt>自检未通过、保持原样</dt>
                  <dd>{summary.blockedNotes} 篇</dd>
                </div>
                <div>
                  <dt>保存后格式会被改写</dt>
                  <dd>{summary.rewritesFormat} 篇</dd>
                </div>
              </dl>
              <ul className={styles.notes}>
                <li>开始前会自动创建一份完整的本机备份。连着云端时会先同步一次，同步不成功就不会开始。</li>
                <li>部分笔记保存后格式会被编辑器改写（如列表符号、空行、表格对齐），内容不变。</li>
                <li>无法定位的重点会被放弃；已取消的旧重点 7 天后自动清理，被知识引用的会保留。</li>
                <li>备注会转到新的重点上。</li>
              </ul>
              {hasDraft ? (
                <p className={styles.warning} role="alert">
                  还有正文没有保存，请等保存完成后再迁移。
                </p>
              ) : null}
              <Checkbox isSelected={confirmed} onChange={setConfirmed}>
                我已了解以上影响，开始迁移
              </Checkbox>
              <div className={styles.actions}>
                <Button
                  variant="primary"
                  isDisabled={!confirmed || hasDraft}
                  onPress={() => {
                    void run();
                  }}
                >
                  备份并迁移
                </Button>
              </div>
            </>
          ) : null}

          {stage === 'done' ? (
            <>
              <p role="status">
                迁移完成：{counts.migrated} 篇已迁移{counts.skipped ? `，${counts.skipped} 篇保持原样` : ''}
                {counts.failed ? `，${counts.failed} 篇失败` : ''}。
              </p>
              {backupDirectory ? <p className={styles.hint}>迁移前备份：{backupDirectory}</p> : null}
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>笔记</th>
                    <th>结果</th>
                    <th>已迁移</th>
                    <th>放弃</th>
                    <th>说明</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map(item => (
                    <tr key={item.note.id}>
                      <td>{item.note.title}</td>
                      <td>{item.status === 'migrated' ? '已迁移' : item.status === 'skipped' ? '保持原样' : '失败'}</td>
                      <td>{item.migrated}</td>
                      <td>{item.abandoned}</td>
                      <td>{item.message ?? (item.commentsCarried ? `转移备注 ${item.commentsCarried} 条` : '')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}

          {stage === 'error' ? (
            <p className={styles.warning} role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </DialogBody>
    </Dialog>
  );
}
