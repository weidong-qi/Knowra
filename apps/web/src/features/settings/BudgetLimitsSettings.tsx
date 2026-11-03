import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button/Button';
import { Select } from '../../components/ui/input/Select';
import { TextField } from '../../components/ui/input/Input';
import { assistantApi, type BudgetMode, type BudgetRuleName, type BudgetSettings } from '../assistant/assistantApi';
import styles from './SettingsView.module.css';

const RULES: Array<{ name: BudgetRuleName; label: string; hint: string }> = [
  { name: 'daily', label: '每日上限', hint: '按北京时间自然日累计。' },
  { name: 'monthly', label: '每月上限', hint: '按北京时间自然月累计。' },
  { name: 'turn', label: '单次回合上限', hint: '一次提问（含工具调用的多轮请求）最多预留的费用。' },
  { name: 'balanceFloor', label: '账户余额下限', hint: '依据 DeepSeek 实际余额，低于下限即停；需要能读取余额，读不到时会拦截。' }
];
const MODES = [{ id: 'off', label: '关闭' }, { id: 'warn', label: '仅提醒' }, { id: 'stop', label: '达到即停' }];
const toYuan = (microunits: number | null) => microunits === null ? '' : String(+(microunits / 1_000_000).toFixed(6));
const toMicro = (text: string) => {
  if (!/^\d{1,9}(\.\d{1,6})?$/.test(text.trim())) return null;
  const micro = Math.round(Number(text) * 1_000_000);
  return micro >= 1 ? micro : null;
};
const toPrice = (text: string) => /^\d{1,6}(\.\d{1,6})?$/.test(text.trim()) ? Math.round(Number(text) * 1_000_000) : null;

type Draft = Record<BudgetRuleName, { mode: BudgetMode; yuan: string }>;
const draftOf = (settings: BudgetSettings): Draft => Object.fromEntries(RULES.map(({ name }) => [name,
  { mode: settings.rules[name].mode, yuan: toYuan(settings.rules[name].limitMicrounits) }])) as Draft;

export function BudgetLimitsSettings() {
  const [saved, setSaved] = useState<BudgetSettings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [thresholds, setThresholds] = useState('50, 80, 100');
  const [customPrice, setCustomPrice] = useState(false);
  const [prices, setPrices] = useState({ input: '', hit: '', output: '' });
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  function apply(settings: BudgetSettings) {
    setSaved(settings); setDraft(draftOf(settings));
    setThresholds(settings.alerts.thresholds.join(', '));
    setCustomPrice(Boolean(settings.price));
    setPrices({ input: toYuan(settings.price?.inputMicrounitsPerMillion ?? null), hit: toYuan(settings.price?.inputCacheHitMicrounitsPerMillion ?? null),
      output: toYuan(settings.price?.outputMicrounitsPerMillion ?? null) });
  }
  useEffect(() => {
    let active = true;
    setLoading(true); setFailed(false);
    assistantApi.budgetSettings().then(value => { if (active) apply(value); })
      .catch(() => { if (active) setFailed(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt]);

  function build(): Pick<BudgetSettings, 'rules' | 'price' | 'alerts'> | string {
    if (!draft) return '设置尚未读取。';
    const rules = {} as BudgetSettings['rules'];
    for (const { name, label } of RULES) {
      const { mode, yuan } = draft[name];
      if (mode === 'off') { rules[name] = { mode, limitMicrounits: null }; continue; }
      const micro = toMicro(yuan);
      if (micro === null) return `请填写“${label}”的金额（元，最多六位小数）。`;
      rules[name] = { mode, limitMicrounits: micro };
    }
    const parsed = thresholds.split(/[,，\s]+/).filter(Boolean).map(Number);
    if (!parsed.length || parsed.length > 6 || !parsed.every(value => Number.isInteger(value) && value >= 1 && value <= 100)) {
      return '提醒阈值请填写 1–100 的整数百分比，用逗号分隔，最多 6 个。';
    }
    const alerts = { thresholds: [...new Set(parsed)].sort((a, b) => a - b) };
    if (!customPrice) return { rules, price: null, alerts };
    const input = toPrice(prices.input), output = toPrice(prices.output), hit = prices.hit.trim() ? toPrice(prices.hit) : null;
    if (input === null || output === null || (prices.hit.trim() && hit === null)) return '请填写有效的单价（元 / 百万 token）。';
    if (hit !== null && hit > input) return '缓存命中单价不能高于未命中单价。';
    return { rules, alerts, price: { inputMicrounitsPerMillion: input, inputCacheHitMicrounitsPerMillion: hit, outputMicrounitsPerMillion: output } };
  }
  const newlyOff = () => Boolean(saved && draft && RULES.some(({ name }) => draft[name].mode === 'off' && saved.rules[name].mode !== 'off'));

  async function save(confirmed = false) {
    setNotice(''); setError('');
    const built = build();
    if (typeof built === 'string') { setError(built); return; }
    if (!confirmed && newlyOff()) { setConfirmOff(true); return; }
    setBusy(true); setConfirmOff(false);
    try { apply(await assistantApi.saveBudgetSettings(built)); setNotice('预算设置已保存，下一次调用起生效。'); }
    catch (failure) { setError(failure instanceof Error && failure.message ? failure.message : '保存失败，请重试。'); }
    finally { setBusy(false); }
  }

  return <section className={styles.group} aria-labelledby="settings-budget-heading">
    <h3 id="settings-budget-heading">预算与价格</h3>
    <div className={styles.settingList}>
      <div className={styles.modelContent}>
        <div className={styles.settingCopy}>
          <h4>用量上限</h4>
          <p>{saved?.location === 'local' ? '这是本机的设置，只约束本机发出的请求。' : saved ? '这是云端的设置，约束网页版发出的请求。' : '决定知境何时拦截模型调用。'}
            默认每日 20 元、单次回合 2 元，均为“达到即停”。“仅提醒”只在达到阈值时提醒，不拦截请求。</p>
        </div>
        {loading ? <p className={styles.modelState}>正在读取预算设置…</p> : null}
        {failed ? <div>
          <p role="alert" className={styles.modelError}>无法读取预算设置，模型调用可能被阻止。请检查服务后重试。</p>
          <div className={styles.modelActions}><Button size="compact" onPress={() => setAttempt(value => value + 1)}>重试读取</Button></div>
        </div> : null}
        {draft ? <>
          <div className={styles.budgetRules}>
            {RULES.map(({ name, label, hint }) => <div key={name} className={styles.budgetRule}>
              <Select label={label} description={hint} isDisabled={busy} selectedKey={draft[name].mode} options={MODES}
                onSelectionChange={key => setDraft({ ...draft, [name]: { ...draft[name], mode: String(key) as BudgetMode } })} />
              <TextField label={`${label}金额（元）`} value={draft[name].yuan} isDisabled={busy || draft[name].mode === 'off'}
                onChange={yuan => setDraft({ ...draft, [name]: { ...draft[name], yuan } })} />
            </div>)}
          </div>
          <div className={styles.budgetPrice}>
            <TextField label="提醒阈值（占上限的百分比）" description="每日、每月两条规则用到上限的这些比例时提醒，每个周期每个阈值只提醒一次；界面横幅之外，Mac 版还会发系统通知。"
              value={thresholds} isDisabled={busy} onChange={setThresholds} />
          </div>
          <div className={styles.budgetPrice}>
            <Select label="计费单价" description={saved?.basePrice ? `默认使用已核对的价格档案（${saved.basePrice.version}，输入 ¥${toYuan(saved.basePrice.inputMicrounitsPerMillion)}、输出 ¥${toYuan(saved.basePrice.outputMicrounitsPerMillion)} / 百万 token，核对至 ${new Date(saved.basePrice.reviewedUntil).toLocaleDateString('zh-CN')}）。` : undefined}
              isDisabled={busy} selectedKey={customPrice ? 'custom' : 'default'}
              options={[{ id: 'default', label: '使用价格档案' }, { id: 'custom', label: '自定义单价' }]}
              onSelectionChange={key => setCustomPrice(key === 'custom')} />
            {customPrice ? <div className={styles.modelFields}>
              <TextField label="输入（未命中缓存），元 / 百万 token" value={prices.input} isDisabled={busy} onChange={input => setPrices({ ...prices, input })} />
              <TextField label="输入（命中缓存），元 / 百万 token" description="可留空，留空时命中部分也按未命中价计算。" value={prices.hit} isDisabled={busy} onChange={hit => setPrices({ ...prices, hit })} />
              <TextField label="输出，元 / 百万 token" value={prices.output} isDisabled={busy} onChange={output => setPrices({ ...prices, output })} />
            </div> : null}
          </div>
          {confirmOff ? <div role="alertdialog" aria-label="确认不设上限" className={styles.budgetConfirm}>
            <p>您将关闭部分上限。关闭后知境不会因费用拦截请求，意外的循环或大量调用可能产生超出预期的费用。确定要继续吗？</p>
            <div className={styles.modelActions}>
              <Button variant="danger" size="compact" isDisabled={busy} onPress={() => void save(true)}>确认不设上限</Button>
              <Button size="compact" onPress={() => setConfirmOff(false)}>取消</Button>
            </div>
          </div> : <div className={styles.modelActions}>
            <Button variant="primary" size="compact" isDisabled={busy} onPress={() => void save()}>保存设置</Button>
            <Button size="compact" isDisabled={busy} onPress={() => saved && apply(saved)}>还原</Button>
          </div>}
        </> : null}
        {notice ? <p role="status" className={styles.modelNotice}>{notice}</p> : null}
        {error ? <p role="alert" className={styles.modelError}>{error}</p> : null}
        <p className={styles.modelHint}>无论如何设置，单次请求的最坏费用（2 元）、单回合的轮数与工具调用次数始终有技术上限，防止错误循环持续消耗。</p>
      </div>
    </div>
  </section>;
}
