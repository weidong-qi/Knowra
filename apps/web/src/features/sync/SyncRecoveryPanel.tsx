import { useEffect, useRef, useState } from 'react';
import { Button, Checkbox } from '../../components/ui';
import { callSync, syncIssue, type RecoveryPreview, type RecoverySession, type SyncStatus } from './localSyncApi';
import type { SyncIssue } from './syncStatusPresentation';
import styles from './LocalSyncControl.module.css';

const stages: Record<RecoverySession['stage'], string> = {
  prepared: '本机备份已准备，等待作废旧同步编号',
  retiring: '正在确认旧同步编号已作废',
  downloading: '正在取得固定云端快照',
  preview: '等待核对并选择整组资料',
  completed: '已完成'
};

type RecoveryAction = (path: string, body: unknown) => Promise<SyncStatus | null>;

export function SyncRecoveryPanel({
  status,
  hasDraft,
  busy,
  username,
  password,
  onAction,
  onError,
  onRefreshStatus
}: {
  status: SyncStatus;
  hasDraft: boolean;
  busy: boolean;
  username: string;
  password: string;
  onAction: RecoveryAction;
  onError: (issue: SyncIssue | null) => void;
  onRefreshStatus: () => void;
}) {
  const [confirmRetire, setConfirmRetire] = useState(false);
  const [acceptJournalUpgrade, setAcceptJournalUpgrade] = useState(false);
  const [preview, setPreview] = useState<RecoveryPreview | null>(null);
  const [previousOffsets, setPreviousOffsets] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [invalidated, setInvalidated] = useState<'changed' | 'retry' | null>(null);
  const loadingRef = useRef(false);
  const requestId = useRef(0);
  const session = status.recoverySession?.stage === 'completed' ? null : status.recoverySession;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const revision = session?.localRevision;
  const stale = Boolean(invalidated || (preview && revision !== preview.revision));
  const disabled = busy || loading || hasDraft;

  const loadPreview = async (offset = 0, reset = false, previous = previousOffsets) => {
    if (loadingRef.current || busy || hasDraft || sessionRef.current?.stage !== 'preview') return;
    const expectedSession = sessionRef.current.id;
    const expectedRevision = reset ? null : preview?.revision;
    const request = ++requestId.current;
    loadingRef.current = true;
    setLoading(true);
    onError(null);
    try {
      const next = await callSync<RecoveryPreview>(`/recovery-preview?offset=${offset}&limit=20`);
      if (request !== requestId.current || sessionRef.current?.id !== expectedSession) return;
      if (next.recoveryId !== expectedSession) throw new Error('恢复会话已改变，请重新打开同步面板核对。');
      if (expectedRevision && next.revision !== expectedRevision) {
        setInvalidated('changed');
        setPreview(null);
        setPreviousOffsets([]);
      } else {
        setPreview(next);
        setPreviousOffsets(reset ? [] : previous);
        setInvalidated(null);
      }
      onRefreshStatus();
    } catch (failure) {
      if (request === requestId.current) onError(syncIssue(failure));
    } finally {
      if (request === requestId.current) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  };
  const loadPreviewRef = useRef(loadPreview);
  loadPreviewRef.current = loadPreview;
  useEffect(() => {
    setPreview(null);
    setPreviousOffsets([]);
    setInvalidated(null);
    loadingRef.current = false;
    setLoading(false);
    if (session?.stage === 'preview') void loadPreviewRef.current(0, true);
    return () => {
      requestId.current += 1;
    };
  }, [session?.id, session?.stage]);

  const start = async () => {
    if (disabled || (!session && (!confirmRetire || !acceptJournalUpgrade))) return;
    // 会话存在时由服务端继续既有编号，不能用 UI 重建或替换恢复会话。
    const next = await onAction('/recover', { username, password, confirmRetire: true, acceptJournalUpgrade: true });
    if (next?.recoverySession?.id === session?.id && next?.recoverySession?.stage === 'preview')
      void loadPreview(0, true);
  };
  const resolve = async (choice: 'local' | 'remote') => {
    if (disabled || stale || !preview || preview.recoveryId !== session?.id || session.stage !== 'preview') return;
    const next = await onAction('/recover-resolve', {
      recoveryId: preview.recoveryId,
      revision: preview.revision,
      choice
    });
    // 服务端也会拒绝过期预览；失败后不沿用可能已经失效的核对结果。
    if (!next) setInvalidated('retry');
  };

  return (
    <section className={styles.recovery} aria-label="安全恢复云端同步">
      <p>
        <strong>同步结果尚未确认，普通登录、立即同步和逐项冲突处理已锁定。</strong>
      </p>
      <p>
        先完整备份本机资料，永久作废旧同步编号，再取得固定云端快照供核对。本步骤不会覆盖当前资料；完成核对前会继续暂停同步。
      </p>
      <p className={styles.hint}>恢复使用独立的新同步发送编号，不改变本机全局设备编号。旧编号的退役不能撤销。</p>
      {hasDraft && <p role="status">请先将当前编辑保存到本机，再进行恢复或刷新预览。</p>}
      {busy && <p role="status">正在处理同步操作，请等待完成后继续核对。</p>}
      {session ? (
        <div className={styles.form}>
          <p>恢复阶段：{stages[session.stage]}</p>
          <p className={styles.hint}>
            旧同步编号：{session.oldDeviceId}
            <br />
            新同步编号：{session.newDeviceId}
            <br />
            完整本机备份：{session.backupId}
          </p>
          <p className={styles.hint}>将继续同一个恢复会话并沿用此前确认，不会再生成新编号。</p>
        </div>
      ) : (
        <div className={styles.form}>
          <Checkbox isSelected={confirmRetire} onChange={setConfirmRetire} isDisabled={disabled}>
            我确认永久作废旧同步编号，同号旧备份或副本将不能继续同步；本机资料保留。
          </Checkbox>
          <Checkbox isSelected={acceptJournalUpgrade} onChange={setAcceptJournalUpgrade} isDisabled={disabled}>
            我接受服务端 journal 格式升级：旧服务端将无法读取，不能直接回滚旧备份；这不是 SQLite v8 升级。
          </Checkbox>
        </div>
      )}
      <div className={styles.actions}>
        <Button
          isDisabled={disabled || (!session && (!confirmRetire || !acceptJournalUpgrade))}
          onPress={() => {
            void start();
          }}
        >
          {session ? '继续核对既有恢复' : '先备份并核对恢复'}
        </Button>
      </div>
      {session?.stage === 'preview' && (
        <>
          <p>
            待恢复关联组共 {preview?.total ?? session.totalItems}{' '}
            项。以下选择将覆盖整个关联组，包括其他分页和未展开的项目，不是只处理当前页。
          </p>
          {(session.epochChanged || preview?.epochChanged) && (
            <p className={styles.hint}>
              云端资料批次已改变，请特别核对删除和关联关系；不支持的组合会继续暂停，不会强行覆盖。
            </p>
          )}
          {stale && (
            <p role="alert" className={styles.error}>
              {invalidated === 'retry'
                ? '恢复尚未完成，同步仍暂停。请刷新整组预览并重新核对后再决定。'
                : '本机资料已改变，旧预览不可用于决定。请先保存编辑，再刷新整组预览并重新核对。'}
            </p>
          )}
          <div className={styles.actions}>
            <Button
              isDisabled={disabled}
              onPress={() => {
                void loadPreview(0, true);
              }}
            >
              刷新整组预览
            </Button>
          </div>
          {loading && <p role="status">正在读取本机资料与固定云端快照…</p>}
          {preview && (
            <>
              <p className={styles.hint}>
                当前显示 {preview.total === 0 ? 0 : preview.offset + 1}–{preview.offset + preview.items.length} 项，共{' '}
                {preview.total} 项。
              </p>
              {preview.items.map(item => (
                <details key={`${item.collection}:${item.id}`}>
                  <summary>
                    {item.collection} · {item.id}
                  </summary>
                  <div className={styles.columns}>
                    <div>
                      <p>
                        <strong>本机值</strong>
                      </p>
                      <pre className={styles.recoveryValue}>
                        {item.local === null ? '不存在（可能已删除）' : JSON.stringify(item.local, null, 2)}
                      </pre>
                    </div>
                    <div>
                      <p>
                        <strong>固定云端值</strong>
                      </p>
                      <pre className={styles.recoveryValue}>
                        {item.remote === null ? '不存在（可能已删除）' : JSON.stringify(item.remote, null, 2)}
                      </pre>
                    </div>
                  </div>
                </details>
              ))}
              <div className={styles.actions}>
                <Button
                  isDisabled={disabled || stale || previousOffsets.length === 0}
                  onPress={() => {
                    const offsets = previousOffsets.slice(0, -1);
                    void loadPreview(previousOffsets.at(-1) ?? 0, false, offsets);
                  }}
                >
                  上一页
                </Button>
                <Button
                  isDisabled={disabled || stale || preview.nextOffset === null}
                  onPress={() => {
                    if (preview.nextOffset !== null)
                      void loadPreview(preview.nextOffset, false, [...previousOffsets, preview.offset]);
                  }}
                >
                  下一页
                </Button>
              </div>
            </>
          )}
          <p>
            确认保留本机将以本机这一组为准；确认采用云端将以固定云端快照这一组替换本机。完整本机备份会保留，只有整组安全提交成功后才恢复普通同步。
          </p>
          <div className={styles.actions}>
            <Button
              isDisabled={disabled || stale || !preview}
              onPress={() => {
                void resolve('local');
              }}
            >
              保留本机这一组并继续同步
            </Button>
            <Button
              isDisabled={disabled || stale || !preview}
              onPress={() => {
                void resolve('remote');
              }}
            >
              采用云端这一组并继续同步
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
