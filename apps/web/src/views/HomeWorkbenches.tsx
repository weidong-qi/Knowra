// 首页「工作域」入口：三个紧凑入口卡，训练域尚未上线时保持锁定。

import type { ReactNode } from 'react';
import { PressableButton } from '../components/ui/button/PressableButton';
import { cx } from '../components/ui/classnames';
import { ArrowUpRightIcon, FolderIcon, NodesIcon, TargetIcon, type KnowraIconProps } from '../components/icons/knowra';
import styles from './HomeView.module.css';

interface DomainCardEntry {
  id: 'materials' | 'knowledge' | 'training';
  label: string;
  description: string;
  Icon: (props: KnowraIconProps) => ReactNode;
  available: boolean;
}

const DOMAIN_CARDS: readonly DomainCardEntry[] = [
  {
    id: 'materials',
    label: '笔记工作台',
    description: 'Markdown 笔记的采集、编辑与整理。',
    Icon: FolderIcon,
    available: true
  },
  {
    id: 'knowledge',
    label: '知识工作台',
    description: '整理知识候选、人工确认与来源追溯。',
    Icon: NodesIcon,
    available: true
  },
  {
    id: 'training',
    label: '训练工作台',
    description: '题目库与考试场景。后端联调未完成。',
    Icon: TargetIcon,
    available: false
  }
] as const;

interface WorkbenchesProps {
  activeNoteCount: number;
  onOpenMaterials?: () => void;
  onOpenKnowledge?: () => void;
}

export function Workbenches({ activeNoteCount, onOpenMaterials, onOpenKnowledge }: WorkbenchesProps) {
  return (
    <div className={styles.workbenchGrid}>
      {DOMAIN_CARDS.map(entry => (
        <WorkbenchCard
          key={entry.id}
          entry={entry}
          activeNoteCount={activeNoteCount}
          onActivate={entry.id === 'knowledge' ? onOpenKnowledge : entry.available ? onOpenMaterials : undefined}
        />
      ))}
    </div>
  );
}

interface WorkbenchCardProps {
  entry: DomainCardEntry;
  activeNoteCount: number;
  onActivate?: () => void;
}

function WorkbenchCard({ entry, activeNoteCount, onActivate }: WorkbenchCardProps) {
  const Icon = entry.Icon;
  const locked = !entry.available;
  return (
    <PressableButton
      type="button"
      className={cx(styles.workbench, entry.available ? styles.workbenchActive : styles.workbenchLocked)}
      onPress={entry.available ? onActivate : undefined}
      aria-label={entry.available ? entry.label : `${entry.label}（尚未上线）`}
      isDisabled={locked}
    >
      <span className={styles.workbenchIcon} aria-hidden="true">
        <Icon size={20} />
      </span>
      <span className={styles.workbenchCopy}>
        <span className={styles.workbenchTitleRow}>
          <h3 className={styles.workbenchTitle}>{entry.label}</h3>
          {locked ? <span className={styles.lockedBadge}>即将开放</span> : null}
        </span>
        <span className={styles.workbenchDescription}>{entry.description}</span>
      </span>
      <span className={styles.workbenchStatus}>
        <span
          className={cx(styles.statusDot, entry.available ? styles.statusDotActive : styles.statusDotLocked)}
          aria-hidden="true"
        />
        {entry.available ? (entry.id === 'materials' ? `${activeNoteCount} 篇笔记` : '知识整理') : '待联调'}
      </span>
      {entry.available ? <ArrowUpRightIcon size={16} className={styles.workbenchArrow} aria-hidden="true" /> : null}
    </PressableButton>
  );
}
