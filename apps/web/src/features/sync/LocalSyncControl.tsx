import { useEffect, useId, useRef, useState } from 'react';
import { Button, Dialog, DialogBody, TextField, PressableButton } from '../../components/ui';
import { useAppStore, useAppStoreApi } from '../../store/AppStoreProvider';
import styles from './LocalSyncControl.module.css';
import { BackupRestoreDialog } from './BackupRestoreDialog';
import { downloadTextFile } from '../../browser/downloadFile';

import { ConflictCard, EntityConflictCard } from './SyncConflictCards';
import { callSync, isSafetyPaused, syncIssue, type SyncStatus } from './localSyncApi';
import { SyncRecoveryPanel } from './SyncRecoveryPanel';
import { describeLocalSyncStatus, type SyncIssue } from './syncStatusPresentation';

export function LocalSyncControl({ compact = false }: { compact?: boolean }) {
  const store = useAppStoreApi();
  const hasDraft = useAppStore(state => state.editorHasLocalChanges || state.saveState === 'saving');
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [editingConnection, setEditingConnection] = useState(false);
  const connectionFormId = useId();
  const [busy, setBusy] = useState(false);
  const actionPending = useRef(false);
  const statusRequestVersion = useRef(0);
  const [error, setError] = useState<SyncIssue | null>(null);
  const [backupOpen, setBackupOpen] = useState(false);
  const seenGeneration = useRef<number | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const latestStatus = useRef<SyncStatus | null>(null);
  const requestRefresh = useRef<() => void>(() => {});
  const workspaceRefresh = useRef<Promise<boolean> | null>(null);
  const acceptStatus = async (next: SyncStatus) => {
    if (seenGeneration.current !== null && next.generation < seenGeneration.current) return;
    latestStatus.current = next;
    setStatus(current => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
    if (seenGeneration.current === null) seenGeneration.current = next.generation;
    else if (seenGeneration.current !== next.generation) {
      if (workspaceRefresh.current) await workspaceRefresh.current;
      if (seenGeneration.current !== null && seenGeneration.current >= next.generation) return;
      const refresh = store.getState().refreshLocalWorkspace();
      workspaceRefresh.current = refresh;
      try {
        if (await refresh) seenGeneration.current = next.generation;
      } finally {
        if (workspaceRefresh.current === refresh) workspaceRefresh.current = null;
      }
    }
  };
  const acceptStatusRef = useRef(acceptStatus);
  acceptStatusRef.current = acceptStatus;
  useEffect(() => {
    requestRefresh.current();
  }, [open]);
  useEffect(() => {
    let stopped = false;
    let pending = false;
    let timer: number | undefined;
    const schedule = () => {
      window.clearTimeout(timer);
      if (stopped || document.visibilityState === 'hidden') return;
      const current = latestStatus.current;
      const active =
        openRef.current ||
        current?.phase === 'syncing' ||
        Boolean(
          current?.pendingEntities ||
          current?.pendingNotes ||
          current?.attachmentPending ||
          current?.entityConflict ||
          current?.conflicts.length
        );
      timer = window.setTimeout(
        () => {
          void refresh();
        },
        active ? 2000 : 10000
      );
    };
    const refresh = async () => {
      if (pending || stopped || document.visibilityState === 'hidden') return;
      window.clearTimeout(timer);
      pending = true;
      const requestVersion = statusRequestVersion.current;
      try {
        const next = await callSync();
        // 操作前或进行中的慢查询不能覆盖操作返回的恢复会话。
        if (stopped || actionPending.current || requestVersion !== statusRequestVersion.current) return;
        await acceptStatusRef.current(next);
        setError(current => {
          if (!current || current.code?.startsWith('LOCAL_RUNTIME_')) return null;
          if (
            next.serverUrl &&
            !next.error &&
            ['synced', 'pending'].includes(next.phase) &&
            (current.code?.startsWith('SYNC_NETWORK_') ||
              current.code?.startsWith('SYNC_CONNECTION_') ||
              ['AUTH_REQUIRED', 'CLOUD_SERVICE_UNAVAILABLE', 'CLOUD_REQUEST_FAILED'].includes(current.code ?? ''))
          )
            return null;
          return current;
        });
      } catch {
        /* 状态查询失败不影响本机编辑；打开面板后手动重试会显示具体错误。 */
      } finally {
        pending = false;
        schedule();
      }
    };
    requestRefresh.current = () => {
      void refresh();
    };
    void refresh();
    const wake = () => {
      void callSync('/wake', { reason: 'focus' })
        .then(() => refresh())
        .catch(() => undefined);
    };
    const online = () => {
      void callSync('/wake', { reason: 'online' })
        .then(() => refresh())
        .catch(() => undefined);
    };
    const visibility = () => {
      window.clearTimeout(timer);
      if (document.visibilityState !== 'hidden') {
        wake();
        void refresh();
      }
    };
    window.addEventListener('online', online);
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      requestRefresh.current = () => {};
      window.removeEventListener('online', online);
      window.removeEventListener('focus', wake);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [store]);
  const action = async (path: string, body: unknown): Promise<SyncStatus | null> => {
    const recoveryAction = path === '/recover' || path === '/recover-resolve';
    const current = latestStatus.current;
    if (
      actionPending.current ||
      (isSafetyPaused(current) && !recoveryAction) ||
      (recoveryAction && (hasDraft || !isSafetyPaused(current)))
    )
      return null;
    actionPending.current = true;
    statusRequestVersion.current += 1;
    setBusy(true);
    setError(null);
    try {
      const next = await callSync(path, body);
      await acceptStatus(next);
      return next;
    } catch (failure) {
      setError(syncIssue(failure));
      try {
        await acceptStatus(await callSync());
      } catch {
        /* 仍保留这次操作的明确错误。 */
      }
    } finally {
      statusRequestVersion.current += 1;
      actionPending.current = false;
      setBusy(false);
      setPassword('');
    }
    return null;
  };
  const safetyPaused = isSafetyPaused(status);
  const presentation = describeLocalSyncStatus(
    status,
    !status?.serverUrl || error?.code?.startsWith('LOCAL_RUNTIME_') ? error : null
  );
  const displayedError = error ?? status?.error;
  const connected = Boolean(status?.serverUrl);
  const manuallyPaused = status?.phase === 'disconnected';
  const authRequired = status?.phase === 'auth-required' || displayedError?.code === 'AUTH_REQUIRED';
  const editingHealthyConnection = connected && !manuallyPaused && !authRequired && !safetyPaused;
  const showConnection = !connected || manuallyPaused || authRequired || safetyPaused || editingConnection;
  const syncing = status?.phase === 'syncing';
  const summaryTitle = presentation.tone === 'success' ? '云端已同步' : presentation.main;
  const summaryDetail =
    presentation.tone === 'success' || syncing
      ? null
      : !connected && presentation.tone === 'neutral'
        ? '仍可离线编辑'
        : presentation.detail;
  return (
    <>
      <PressableButton
        type="button"
        className={`${styles.trigger} ${compact ? styles.compact : ''}`}
        data-tone={presentation.tone}
        aria-label={
          compact
            ? `${presentation.main}${presentation.tone !== 'success' ? ` ${presentation.detail}` : ''}`
            : undefined
        }
        title={compact ? `${presentation.main} · ${presentation.detail}` : undefined}
        onPress={() => {
          setServerUrl(status?.serverUrl ?? serverUrl);
          setEditingConnection(false);
          setOpen(true);
        }}
      >
        <span className={styles.marker} aria-hidden="true" />
        <span className={styles.main}>{presentation.main}</span>
        {presentation.tone !== 'success' ? <span className={styles.detail}>{presentation.detail}</span> : null}
      </PressableButton>
      <Dialog
        title="云端同步"
        isOpen={open}
        onOpenChange={next => {
          setOpen(next);
          if (!next) setPassword('');
        }}
        size="md"
        isPending={busy}
      >
        <DialogBody>
          <div className={styles.body}>
            <section className={styles.overview} aria-label="同步状态">
              <p className={styles.statusLine} data-tone={presentation.tone} role="status">
                <span className={styles.marker} aria-hidden="true" />
                <span>
                  <strong>{summaryTitle}</strong>
                  {summaryDetail && <span className={styles.statusDetail}>{summaryDetail}</span>}
                </span>
              </p>
              {(status?.serverUrl || status?.lastSyncedAt) && (
                <dl className={styles.statusFacts}>
                  {status.serverUrl && (
                    <div>
                      <dt>服务地址</dt>
                      <dd>{status.serverUrl}</dd>
                    </div>
                  )}
                  {status.lastSyncedAt && (
                    <div>
                      <dt>上次同步</dt>
                      <dd>
                        <time dateTime={status.lastSyncedAt}>
                          {new Date(status.lastSyncedAt).toLocaleString('zh-CN')}
                        </time>
                      </dd>
                    </div>
                  )}
                </dl>
              )}
              {connected && !manuallyPaused && (
                <div className={styles.actions} aria-label="同步操作">
                  <Button
                    variant={!showConnection ? 'primary' : 'default'}
                    isDisabled={busy || syncing || safetyPaused || authRequired}
                    onPress={() => {
                      void action('/retry', {});
                    }}
                  >
                    立即同步
                  </Button>
                  <Button
                    variant="ghost"
                    isDisabled={busy || safetyPaused}
                    onPress={() => {
                      void action('/disconnect', {});
                    }}
                  >
                    暂停云端同步
                  </Button>
                  {editingHealthyConnection && (
                    <Button
                      variant="ghost"
                      isDisabled={busy}
                      aria-expanded={editingConnection}
                      aria-controls={editingConnection ? connectionFormId : undefined}
                      onPress={() => {
                        if (editingConnection) setPassword('');
                        setEditingConnection(!editingConnection);
                      }}
                    >
                      连接设置
                    </Button>
                  )}
                </div>
              )}
            </section>

            {displayedError && (
              <p role="alert" className={styles.error}>
                {displayedError.message}
              </p>
            )}
            {showConnection && (
              <form
                id={connectionFormId}
                className={styles.form}
                aria-label={connected ? '服务凭据' : '连接自建服务'}
                onSubmit={event => {
                  event.preventDefault();
                  if (safetyPaused) return;
                  void action('/configure', { serverUrl: status?.serverUrl ?? serverUrl, username, password }).then(
                    next => {
                      if (next?.serverUrl && !isSafetyPaused(next) && next.phase !== 'auth-required')
                        setEditingConnection(false);
                    }
                  );
                }}
              >
                <h3 className={styles.sectionTitle}>{connected ? '服务凭据' : '连接自建服务'}</h3>
                {!connected && (
                  <TextField
                    label="云端服务地址"
                    type="url"
                    isRequired
                    placeholder="https://sync.example.com"
                    value={serverUrl}
                    onChange={setServerUrl}
                  />
                )}
                <div className={styles.columns}>
                  <TextField label="服务账号" autoComplete="username" value={username} onChange={setUsername} />
                  <TextField
                    label="服务密码"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={setPassword}
                  />
                </div>
                {!safetyPaused && <p className={styles.hint}>密码仅在本次运行中使用。</p>}
                <div className={styles.actions}>
                  <Button type="submit" variant="primary" isDisabled={busy || safetyPaused}>
                    {manuallyPaused ? '恢复同步' : connected ? '验证并同步' : '连接并比较资料'}
                  </Button>
                </div>
              </form>
            )}
            {safetyPaused && status && (
              <SyncRecoveryPanel
                status={status}
                hasDraft={hasDraft}
                busy={busy}
                username={username}
                password={password}
                onAction={action}
                onError={setError}
                onRefreshStatus={() => requestRefresh.current()}
              />
            )}
            {status?.knowledgeSyncSupported === false && Boolean(status.pendingKnowledgeEntities) && (
              <p className={styles.hint}>云端需升级才能同步知识与来源；本机资料已保留。</p>
            )}
            {status?.blockedNotes.map(note => (
              <p key={note.noteId} className={styles.error}>
                {note.title}：{note.message}
              </p>
            ))}
            {hasDraft && (status?.conflicts.length || status?.entityConflict) ? (
              <p>请等待当前正文保存到本机后处理冲突。</p>
            ) : null}
            {status?.entityConflict && (
              <EntityConflictCard
                key={status.entityConflict.id}
                conflict={status.entityConflict}
                disabled={hasDraft || busy || safetyPaused}
                onResolve={async (choice, rawMarkdown) => {
                  await action('/resolve', { conflictId: status.entityConflict?.id, choice, rawMarkdown });
                }}
              />
            )}
            {status?.conflicts.map(conflict => (
              <ConflictCard
                key={`${conflict.noteId}:${conflict.remoteRevision}`}
                conflict={conflict}
                disabled={hasDraft || busy || safetyPaused}
                onResolve={async (choice, rawMarkdown) => {
                  await action('/resolve', {
                    noteId: conflict.noteId,
                    remoteRevision: conflict.remoteRevision,
                    datasetEpoch: conflict.datasetEpoch,
                    choice,
                    rawMarkdown
                  });
                }}
              />
            ))}
            <section className={styles.utilities} aria-label="备份与诊断">
              <Button
                variant="ghost"
                onPress={() => {
                  setOpen(false);
                  setPassword('');
                  setBackupOpen(true);
                }}
              >
                本机备份与恢复
              </Button>
              <details className={styles.diagnostics}>
                <summary>同步诊断</summary>
                {status?.deviceId && <p className={styles.hint}>设备编号：{status.deviceId}</p>}
                {Boolean(status?.pendingKnowledgeEntities) && (
                  <p className={styles.hint}>知识与来源待同步：{status?.pendingKnowledgeEntities} 项</p>
                )}
                <Button
                  variant="ghost"
                  size="compact"
                  onPress={() => {
                    void callSync<unknown[]>('/recovery')
                      .then(records =>
                        downloadTextFile(
                          'Knowra-冲突恢复记录.json',
                          JSON.stringify(records, null, 2),
                          'application/json'
                        )
                      )
                      .catch(failure => setError(syncIssue(failure)));
                  }}
                >
                  导出冲突恢复记录
                </Button>
              </details>
            </section>
          </div>
        </DialogBody>
      </Dialog>
      <BackupRestoreDialog isOpen={backupOpen} onOpenChange={setBackupOpen} />
    </>
  );
}
