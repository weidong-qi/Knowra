import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button/Button';
import { assistantApi, type AssistantStatus } from '../assistant/assistantApi';
import { ASSISTANT_STATUS_CHANGED_EVENT } from '../assistant/assistantEvents';
import { CREDENTIAL_CHANGED_EVENT } from './credentialEvents';
import styles from './SettingsView.module.css';

/** 只读取既有运行状态，不探测生成接口，也不更改功能或读取授权。 */
export function ModelRuntimeStatus() {
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let epoch = 0;
    const refresh = () => {
      const mine = ++epoch;
      setStatus(null); setFailed(false);
      void assistantApi.status().then(value => { if (mine === epoch) setStatus(value); })
        .catch(() => { if (mine === epoch) setFailed(true); });
    };
    refresh();
    window.addEventListener(CREDENTIAL_CHANGED_EVENT, refresh);
    window.addEventListener(ASSISTANT_STATUS_CHANGED_EVENT, refresh);
    return () => {
      epoch += 1;
      window.removeEventListener(CREDENTIAL_CHANGED_EVENT, refresh);
      window.removeEventListener(ASSISTANT_STATUS_CHANGED_EVENT, refresh);
    };
  }, [attempt]);
  return <div className={`${styles.settingCopy} ${styles.budgetPrice}`}>
    <h4>AI 运行状态</h4>
    <p>{status ? status.simulation ? '当前为模拟模式，未使用真实模型。'
      : status.generationAvailable ? '当前运行端已就绪，可在助手中发起任务。实际调用仍可能受账户余额、网络或服务限制。'
        : `当前不可运行：${status.unavailableReason || '请检查模型配置与预算。'}`
      : failed ? '暂时无法读取运行状态。配置保存与连接检查结果不受影响。' : '正在读取运行状态…'}</p>
    {status?.priceNotice ? <p className={styles.modelHint}>{status.priceNotice}</p> : null}
    <p>保存密钥或检查连接不会开启 AI 功能，也不代表已授权读取笔记。AI 提炼知识点由下方开关控制；读取范围与外发仍需在对话中授权。</p>
    {failed ? <Button size="compact" onPress={() => setAttempt(value => value + 1)}>重试读取运行状态</Button> : null}
  </div>;
}
