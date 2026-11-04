import { Checkbox } from '../../components/ui/input/Checkbox';
import styles from './SettingsView.module.css';

/** 知识外发与候选质量确认独立；总开关不要求用户逐条选择知识。 */
export function KnowledgeReadConsent({ label, isSelected, onChange, isDisabled = false }: {
  label: string; isSelected: boolean; onChange: (value: boolean) => void; isDisabled?: boolean;
}) {
  const recipient = label.trim() ? `“${label.trim()}”及其所属厂商` : '该客户端及其所属厂商';
  return <>
    <p className={styles.dialogNote}>开启后，{recipient}可读取当前资料库中的全部知识点，包括归纳、改写、手写内容、没有来源记录的旧知识，以及开启期间新建或编辑的知识。无需逐条选择，可随时关闭。</p>
    <p className={styles.dialogNote}>没有来源记录的手工或旧知识不受所选笔记范围进一步缩小；已知来源仍受笔记授权范围、排除项和私密标记限制。没有来源记录不代表内容不敏感。此授权仅允许读取，不会确认知识质量，也不会自动提交或确认候选。</p>
    <Checkbox isSelected={isSelected} onChange={onChange} isDisabled={isDisabled}>我允许{recipient}读取上述全部知识内容及开启期间的后续变化</Checkbox>
  </>;
}
