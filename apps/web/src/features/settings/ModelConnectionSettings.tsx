import { useEffect, useRef, useState } from 'react';
import { ApiRequestError } from '@study-accelerator/web-core';
import { Button } from '../../components/ui/button/Button';
import { TextField } from '../../components/ui/input/Input';
import { Select, type SelectOption } from '../../components/ui/input/Select';
import { Dialog, DialogBody, DialogFooter } from '../../components/ui/overlay/Dialog';
import { modelSettings, SUPPORTED_MODEL_IDS, modelSettingsError, type ModelSettingsStatus } from './modelSettings';
import { CREDENTIAL_CHANGED_EVENT, notifyCredentialChanged } from './credentialEvents';
import { notifyAssistantStatusChanged } from '../assistant/assistantEvents';
import { ModelRuntimeStatus } from './ModelRuntimeStatus';
import styles from './SettingsView.module.css';

type Action = 'save' | 'check' | 'remove';
export function ModelConnectionSettings() {
  const [status, setStatus] = useState<ModelSettingsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [modelId, setModelId] = useState<string>(SUPPORTED_MODEL_IDS[0]);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<'save' | 'remove' | null>(null);
  const [notice, setNotice] = useState('');
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [error, setError] = useState('');
  const epoch = useRef(0);
  const inFlight = useRef(false);
  const notifying = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const changed = () => {
      if (notifying.current) return;
      epoch.current += 1;
      setStatus(null); setCheckedAt(null); setNotice(''); setApiKey(''); setConfirmation(null);
      setLoading(true); setLoadAttempt(value => value + 1);
    };
    window.addEventListener(CREDENTIAL_CHANGED_EVENT, changed);
    return () => { mounted.current = false; epoch.current += 1; window.removeEventListener(CREDENTIAL_CHANGED_EVENT, changed); };
  }, []);
  useEffect(() => {
    const mine = ++epoch.current;
    setLoading(true); setError('');
    modelSettings.status().then(value => {
      if (mine === epoch.current) { setStatus(value); setModelId(value.modelId); }
    }).catch((failure: unknown) => {
      if (mine !== epoch.current) return;
      setError(failure instanceof ApiRequestError && failure.status === 404
        ? '当前 API 服务未提供模型配置接口，请更新或重启 API 服务后重试。'
        : '无法读取模型配置状态，请检查当前服务后重试。');
    }).finally(() => { if (mine === epoch.current) setLoading(false); });
    return () => { epoch.current += 1; };
  }, [loadAttempt]);

  const supported = SUPPORTED_MODEL_IDS.some(id => id === modelId);
  const dirty = modelId !== status?.modelId || Boolean(apiKey);
  function edit(field: 'model' | 'key', value: string) {
    setCheckedAt(null); setNotice(''); setError('');
    if (field === 'model') setModelId(value); else setApiKey(value);
  }
  async function perform(action: Action) {
    // React 状态更新前也阻止重复提交；所有响应与当前凭据代际绑定。
    if (inFlight.current || loading || !status || (action !== 'remove' && !supported)
      || (action === 'check' && (!status.configured || dirty))
      || (action === 'save' && !status.configured && !apiKey.trim())) return;
    inFlight.current = true;
    const mine = epoch.current;
    setBusy(true); setNotice(''); setError(''); setCheckedAt(null);
    try {
      const next = action === 'save' ? await modelSettings.save({ modelId, apiKey })
        : action === 'check' ? await modelSettings.check() : await modelSettings.remove();
      // 实际写入成功必须使当前消费者重读，即便设置页已离开；不传播旧响应。
      if (action !== 'check') {
        notifying.current = true;
        try { notifyCredentialChanged(); notifyAssistantStatusChanged(); } finally { notifying.current = false; }
      }
      if (mine !== epoch.current || !mounted.current) return;
      setStatus(next); setModelId(next.modelId); setApiKey(''); setConfirmation(null);
      if (action === 'check') setCheckedAt(next.checkedAt ?? new Date().toISOString());
      setNotice(action === 'save' ? '配置已保存，尚未检查连接。'
        : action === 'check' ? '连接检查通过：所选模型在账号模型列表中。' : '已移除当前运行端保存的密钥。');
    } catch (failure) {
      if (mine === epoch.current && mounted.current) setError(modelSettingsError(failure));
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function requestSave() {
    if (inFlight.current) return;
    if (status?.configured && apiKey.trim()) { setError(''); setConfirmation('save'); }
    else void perform('save');
  }
  const options: SelectOption[] = SUPPORTED_MODEL_IDS.map(id => ({ id, label: `${id}（已适配）` }));
  if (!supported) options.unshift({ id: modelId, label: `${modelId}（当前版本不支持）` });

  return <section className={styles.group} aria-labelledby="settings-model-heading">
    <h3 id="settings-model-heading">模型接入</h3>
    <div className={styles.settingList}><div className={styles.modelContent}>
      <div className={styles.settingCopy}>
        <h4>使用自己的 DeepSeek API Key</h4>
        <p>不配置 AI 也能继续使用离线笔记。需要 AI 时，在 DeepSeek 官方平台创建自己的 API Key，再在这里保存并检查连接。</p>
        <p>模型调用由你的 DeepSeek 账户付费。Knowra 的预算是费用控制与估算，不是充值余额；实际费用以 DeepSeek 账单为准。</p>
        <p><a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer">DeepSeek 密钥管理</a> · <a href="https://api-docs.deepseek.com/quick_start/pricing/" target="_blank" rel="noreferrer">官方计费说明</a></p>
        <p>{window.knowraDesktop?.modelSettings
          ? '桌面版：密钥保存在这台电脑的 Knowra 应用数据目录中，由系统安全存储加密（Mac 使用钥匙串保护）。其他设备需要分别配置。'
          : '网页版：密钥保存在当前 API 服务器运行账户的 ~/.config/knowra/ai-provider.json 中，文件权限限制为该账户可读写，并非保存在浏览器中。仅在你信任的服务器上配置。'} API Key 不会在此页再次显示。</p>
      </div>
      <div className={styles.modelFields}>
        <Select label="模型" selectedKey={modelId} onSelectionChange={key => { if (key !== null) edit('model', String(key)); }} options={options} isDisabled={busy || loading} description="仅列出当前版本已适配并配置计价的模型。" />
        <TextField label="API Key" type="password" value={apiKey} onChange={value => edit('key', value)} isDisabled={busy}
          description={status?.configured ? '留空保留已保存的密钥；输入新密钥并确认后替换。' : '请在这里输入密钥，不要发给他人。'} />
      </div>
      {!supported ? <p className={styles.modelError}>已保留原配置 {modelId} 和密钥，当前版本无法使用此模型。请选择受支持的模型后保存；不会自动切换或删除。</p> : null}
      <p className={styles.modelState}>{loading ? '正在读取配置…' : status === null ? '配置状态读取失败' : status.configured ? `已配置 · ${status.modelId}` : '尚未配置'}</p>
      <p className={styles.modelHint}>{checkedAt ? `最近一次连接检查：${new Date(checkedAt).toLocaleString('zh-CN')}。仅对应当时保存的配置。` : '当前配置尚无有效的连接检查结果。'}{dirty && status?.configured ? ' 有未保存的修改，请先保存再检查。' : ''}</p>
      <div className={styles.modelActions}>
        <Button variant="primary" size="compact" isDisabled={busy || loading || status === null || !supported || (!status.configured && !apiKey.trim())} onPress={requestSave}>保存配置</Button>
        <Button size="compact" isDisabled={busy || loading || !status?.configured || dirty || !supported} onPress={() => void perform('check')}>检查连接</Button>
        <Button variant="danger" size="compact" isDisabled={busy || loading || !status?.configured} onPress={() => { setError(''); setConfirmation('remove'); }}>移除配置</Button>
        {status === null && !loading ? <Button size="compact" isDisabled={busy} onPress={() => setLoadAttempt(value => value + 1)}>重试读取</Button> : null}
      </div>
      {notice ? <p role="status" className={styles.modelNotice}>{notice}</p> : null}
      {error && !confirmation ? <p role="alert" className={styles.modelError}>{error}</p> : null}
      <p className={styles.modelHint}>连接检查仅读取 DeepSeek 的 /models 账号模型列表，不发送笔记，也不执行生成。通过检查不代表账户余额充足、生成成功或工具调用已验证。费用上限可在下方“预算与价格”中调整，默认每日 20 元。</p>
      <ModelRuntimeStatus />
    </div></div>
    <Dialog title={confirmation === 'remove' ? '移除已保存的密钥？' : '替换已保存的密钥？'} isOpen={confirmation !== null} isDismissable={!busy} onOpenChange={open => { if (!open && !inFlight.current) { setConfirmation(null); setError(''); } }} size="sm">
      <DialogBody>
        <p>{confirmation === 'remove' ? '只移除当前运行端保存的 API Key，之后需重新配置才能使用 AI。不会撤销 DeepSeek 平台上的密钥，也不会删除笔记；如需撤销密钥，请前往 DeepSeek 密钥管理。'
          : '新密钥将替换当前运行端的密钥，后续 AI 调用使用新密钥所属的 DeepSeek 账户并由该账户付费。原密钥不会在 DeepSeek 平台被撤销。'}</p>
        {error ? <p role="alert" className={styles.modelError}>{error}</p> : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" isDisabled={busy} onPress={() => { setConfirmation(null); setError(''); }}>取消</Button>
        <Button variant={confirmation === 'remove' ? 'danger' : 'primary'} isPending={busy} isDisabled={busy} onPress={() => { if (confirmation) void perform(confirmation); }}>{confirmation === 'remove' ? '确认移除' : '确认替换'}</Button>
      </DialogFooter>
    </Dialog>
  </section>;
}
