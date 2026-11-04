import { useEffect, useState } from 'react';
import { ApiRequestError } from '@study-accelerator/web-core';
import { Button } from '../../components/ui/button/Button';
import { Checkbox } from '../../components/ui/input/Checkbox';
import { Dialog, DialogBody, DialogFooter } from '../../components/ui/overlay/Dialog';
import { aiFeatures } from './aiFeatures';
import styles from './SettingsView.module.css';

export function AiFeatureSettings() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    aiFeatures.get().then(value => { if (active) setEnabled(value.knowledgeProposals); })
      .catch((failure: unknown) => {
        if (!active) return;
        setEnabled(null);
        setError(failure instanceof ApiRequestError && failure.status === 404
          ? '当前服务未提供 AI 功能开关接口，请更新或重启服务后重试。' : '无法读取 AI 功能开关，请检查当前服务后重试。');
      }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadAttempt]);

  async function apply(next: boolean) {
    setBusy(true); setError(''); setNotice('');
    try {
      const value = await aiFeatures.set({ knowledgeProposals: next });
      setEnabled(value.knowledgeProposals);
      setNotice(value.knowledgeProposals ? '已开启 AI 提炼知识点。读取范围仍需在每次对话中授权。' : '已关闭 AI 提炼知识点。');
      setConfirmOpen(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '操作失败，请重试。');
    } finally { setBusy(false); }
  }

  // 开启前必须确认外发与审核说明；关闭不弹提示，直接生效。
  const toggle = (next: boolean) => { if (next) { setError(''); setNotice(''); setConfirmOpen(true); } else void apply(false); };

  return <section className={styles.group} aria-labelledby="settings-ai-features-heading">
    <h3 id="settings-ai-features-heading">AI 功能</h3>
    <div className={styles.settingList}>
      <div className={styles.settingRow}>
        <div className={styles.settingCopy}>
          <h4>AI 提炼知识点</h4>
          <p>开启后，助手可以根据你标记的重点提炼出待审核的知识候选。默认关闭。此开关只决定助手能否提交候选，不替代每次对话里的读取范围与外发授权。</p>
        </div>
        <div className={styles.settingControl}>
          <span>{loading ? '读取中' : enabled === null ? '状态未知' : enabled ? '已开启' : '未开启'}</span>
          <Checkbox className={styles.settingCheckbox} isSelected={enabled === true} isDisabled={loading || enabled === null || busy}
            onChange={toggle} aria-label="AI 提炼知识点" />
        </div>
      </div>
    </div>
    {notice ? <p role="status" className={styles.modelNotice}>{notice}</p> : null}
    {error && !confirmOpen ? <p role="alert" className={styles.modelError}>{error}</p> : null}
    {enabled === null && !loading ? <Button size="compact" onPress={() => setLoadAttempt(value => value + 1)}>重试读取</Button> : null}
    <Dialog title="开启“AI 提炼知识点”？" isOpen={confirmOpen} onOpenChange={open => { if (!busy) setConfirmOpen(open); }} size="sm">
      <DialogBody>
        <p>开启后，助手可以根据你标记的重点，把笔记内容提炼成待审核的知识候选。提炼时相关笔记片段会被发送到外部服务，且只有在你明确授权读取范围后才会读取。候选不会自动入库，需要你在知识库逐条审核。</p>
        {error ? <p role="alert" className={styles.modelError}>{error}</p> : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" isDisabled={busy} onPress={() => setConfirmOpen(false)}>取消</Button>
        <Button variant="primary" isPending={busy} onPress={() => void apply(true)}>确认开启</Button>
      </DialogFooter>
    </Dialog>
  </section>;
}
