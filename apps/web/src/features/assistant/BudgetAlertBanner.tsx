import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/button/Button';
import { useNavigate } from '../../app/router';
import { assistantApi, type BudgetAlert, type BudgetAlerts } from './assistantApi';
import { notifyAssistantStatusChanged } from './assistantEvents';
import styles from './BudgetAlertBanner.module.css';

const POLL_MS = 60_000;
const RULE_LABEL = { daily: '今日', monthly: '本月' } as const;
type Rule = keyof typeof RULE_LABEL;
const yuan = (microunits: number) => `¥${(microunits / 1_000_000).toFixed(2)}`;

/** 每条规则只展示已越过的最高阈值；同规则更低的阈值一并视为已看过。 */
function crossed(data: BudgetAlerts, rule: Rule): { top: BudgetAlert; ids: string[] } | null {
  const list = data.alerts.filter(item => item.rule === rule).sort((a, b) => a.threshold - b.threshold);
  const top = list.at(-1);
  return top ? { top, ids: list.map(item => item.id) } : null;
}

/** 由 Mac 主进程发系统通知（窗口会话不授予渲染进程通知权限）；只有确实交给系统时才返回 true。 */
async function systemNotify(alert: BudgetAlert, blocked: boolean): Promise<boolean> {
  try {
    if (typeof window.knowraDesktop?.notify !== 'function') return false;
    return (await window.knowraDesktop.notify({
      title: blocked ? `知境 AI 已达${RULE_LABEL[alert.rule]}上限` : `知境 AI 用量已达${RULE_LABEL[alert.rule]}上限的 ${alert.threshold}%`,
      body: `${RULE_LABEL[alert.rule]}已用 ${yuan(alert.usedMicrounits)} / ${yuan(alert.limitMicrounits)}。` })) === true;
  } catch { return false; }
}

type Card =
  | { kind: 'blocked'; rule: Rule; key: string; used: number; limit: number }
  | { kind: 'warning'; rule: Rule; key: string; top: BudgetAlert; ids: string[]; allowed: boolean };

export function BudgetAlertBanner() {
  const navigate = useNavigate();
  const [data, setData] = useState<BudgetAlerts | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // 已被用户在本次会话中关闭的“已拦截”提示（刷新页面后会再次出现，因为拦截是持续的状态）。
  const [hiddenBlocked, setHiddenBlocked] = useState<string[]>([]);
  const notifying = useRef(new Set<string>());
  // 影响“助手能否发起调用”的状态指纹：暂停、拦截、状态文件损坏任一变化（包括暂停到期、跨日恢复）都要让助手视图刷新。
  const gateKey = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await assistantApi.alerts();
      const key = JSON.stringify([next.pauses, next.rules.map(item => [item.rule, item.blocked]), next.overrides, Boolean(next.stateInvalid)]);
      const changed = gateKey.current !== null && gateKey.current !== key;
      gateKey.current = key;
      setData(next);
      if (changed) notifyAssistantStatusChanged();
    }
    catch { /* 未启用 AI 或暂时读不到时不打扰用户。 */ }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [refresh]);

  // Mac 版：每条规则对新越过的最高阈值发一次系统通知。只有主进程确认已交给系统，才记为已通知；
  // 被系统拒绝或不可用时不记，之后（下次打开应用）还有机会补发；同一次会话内不重复尝试。
  useEffect(() => {
    if (!data || typeof window.knowraDesktop?.notify !== 'function') return;
    for (const rule of ['daily', 'monthly'] as const) {
      const fresh = data.alerts.filter(item => item.rule === rule && !item.notified && !notifying.current.has(item.id));
      if (!fresh.length) continue;
      fresh.forEach(item => notifying.current.add(item.id));
      const top = [...fresh].sort((a, b) => b.threshold - a.threshold)[0];
      const blocked = data.rules.some(item => item.rule === rule && item.blocked);
      void systemNotify(top, blocked).then(shown => {
        if (shown) return assistantApi.markAlerts(fresh.map(item => item.id), 'notified').then(setData);
      }).catch(() => undefined);
    }
  }, [data]);

  /** statusChanged：该操作改变了助手能否发起调用（暂停/恢复/放行/重置），需要通知助手视图重新读取状态。 */
  async function run(action: () => Promise<BudgetAlerts | void>, statusChanged = false) {
    setBusy(true); setError('');
    try {
      const next = await action();
      if (next) {
        // 操作结果就是新的基准，避免随后一次轮询把同一变化再通知一遍。
        gateKey.current = JSON.stringify([next.pauses, next.rules.map(item => [item.rule, item.blocked]), next.overrides, Boolean(next.stateInvalid)]);
        setData(next);
      } else await refresh();
      if (statusChanged) notifyAssistantStatusChanged();
    }
    catch (failure) { setError(failure instanceof Error && failure.message ? failure.message : '操作失败，请重试。'); }
    finally { setBusy(false); }
  }
  const dismiss = (ids: string[]) => run(() => assistantApi.markAlerts(ids, 'dismissed'));
  // 暂停只记录“本周期暂停”，不改写预算设置；周期结束自动恢复，也可随时提前恢复。
  const pause = (item: BudgetAlert, ids: string[]) => run(async () => {
    await assistantApi.pauseRule(item.rule);
    return assistantApi.markAlerts(ids, 'dismissed');
  }, true);

  const pausedRules = data?.pauses.map(item => item.rule) ?? [];
  const cards: Card[] = !data ? [] : (['daily', 'monthly'] as const).filter(rule => !pausedRules.includes(rule)).flatMap((rule): Card[] => {
    const state = data.rules.find(item => item.rule === rule);
    const found = crossed(data, rule);
    // 已拦截由实际用量与上限决定，独立于提醒阈值；阈值只决定“接近上限”的提醒。
    if (state?.blocked) {
      const key = `${rule}:${state.period}`;
      return hiddenBlocked.includes(key) ? [] : [{ kind: 'blocked', rule, key, used: state.usedMicrounits, limit: state.limitMicrounits }];
    }
    if (found && !found.top.dismissed) {
      return [{ kind: 'warning', rule, key: found.top.id, top: found.top, ids: found.ids,
        allowed: data.overrides.some(item => item.rule === rule) }];
    }
    return [];
  });
  const pauses = data?.pauses ?? [];
  if (!cards.length && !pauses.length && !data?.stateInvalid) return null;
  return <div className={styles.stack} role="region" aria-label="AI 费用提醒">
    {data?.stateInvalid ? <div className={`${styles.banner} ${styles.blocked}`} role="alert">
      <p>暂停/提醒状态文件已损坏，AI 已被阻止<span>（为避免误放行，不会自动忽略；重置后恢复正常）</span></p>
      <div className={styles.actions}>
        <Button size="compact" variant="primary" isDisabled={busy} onPress={() => void run(() => assistantApi.resumeRule('daily'), true)}>重置并恢复</Button>
      </div>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    </div> : null}
    {pauses.map(item => <div key={`pause:${item.rule}`} className={`${styles.banner} ${styles.blocked}`} role="status">
      <p>AI 已暂停至{item.rule === 'daily' ? '明天' : '下月'}<span>（按您的操作暂停，周期结束自动恢复）</span></p>
      <div className={styles.actions}>
        <Button size="compact" variant="primary" isDisabled={busy} onPress={() => void run(() => assistantApi.resumeRule(item.rule), true)}>立即恢复</Button>
      </div>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    </div>)}
    {cards.map(card => {
      const name = RULE_LABEL[card.rule];
      if (card.kind === 'blocked') {
        return <div key={card.key} className={`${styles.banner} ${styles.blocked}`} role="alert">
          <p>{name}费用已达上限，AI 已暂停<span>（已用 {yuan(card.used)} / {yuan(card.limit)}）</span></p>
          <div className={styles.actions}>
            <Button size="compact" variant="primary" isDisabled={busy} onPress={() => void run(() => assistantApi.allowRule(card.rule), true)}>{name}放行</Button>
            <Button size="compact" isDisabled={busy} onPress={() => navigate('/settings')}>提高上限</Button>
            <Button size="compact" variant="ghost" isDisabled={busy} onPress={() => setHiddenBlocked([...hiddenBlocked, card.key])}>关闭提示</Button>
          </div>
          {error ? <p role="alert" className={styles.error}>{error}</p> : null}
        </div>;
      }
      return <div key={card.key} className={styles.banner} role="status">
        <p>{name} AI 费用已达上限的 {card.top.threshold}%
          <span>（已用 {yuan(card.top.usedMicrounits)} / {yuan(card.top.limitMicrounits)}{card.allowed ? `，${name}已放行` : ''}）</span></p>
        <div className={styles.actions}>
          <Button size="compact" isDisabled={busy} onPress={() => navigate('/settings')}>提高上限</Button>
          {!card.allowed ? <Button size="compact" isDisabled={busy} onPress={() => void pause(card.top, card.ids)}>暂停 AI 至{card.rule === 'daily' ? '明天' : '下月'}</Button> : null}
          <Button size="compact" variant="ghost" isDisabled={busy} onPress={() => void dismiss(card.ids)}>继续</Button>
        </div>
        {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      </div>;
    })}
  </div>;
}
