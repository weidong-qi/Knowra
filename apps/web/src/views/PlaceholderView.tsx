// V4-05 PlaceholderView
//
// 给未上线的工作域（知识库 / 试题 / 执行 / 我的）使用的占位页。
// 1. 不引入业务逻辑；只显示当前模块名 + 简短描述 + 即将上线提示。
// 2. 主页入口与 rail / mobile tab 跳转都使用同一份文案。

import { useEffect, useState, type ReactNode } from 'react';
import { EmptyState } from '../components/ui/status';
import { Button } from '../components/ui/button/Button';
import { RefreshIcon } from '../components/icons/knowra';
import styles from './HomeView.module.css';

export interface PlaceholderViewProps {
  moduleId: string;
  title: string;
  description: string;
  onReturnHome(): void;
  primaryAction?: ReactNode;
}

export function PlaceholderView({
  moduleId,
  title,
  description,
  onReturnHome,
  primaryAction
}: PlaceholderViewProps) {
  // 每次进入页面时触发一个轻量宣告（live region 在 AppShell 中）。
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setTick((t) => t + 1);
  }, [moduleId]);
  void tick;

  return (
    <div className={styles.view}>
      <section className={styles.header} aria-labelledby="placeholder-title">
        <div>
          <p className={styles.kicker}>模块 / {moduleId}</p>
          <h1 id="placeholder-title" className={styles.title}>{title}</h1>
          <p className={styles.subtitle}>{description}</p>
        </div>
        <div className={styles.headerActions}>
          {primaryAction ?? null}
        </div>
      </section>
      <EmptyState
        title="该工作域尚未上线"
        description="V4-05 公共 Shell 已落地；本页内容将在后续阶段按 V4-06～V4-08 任务书接入。"
        primaryAction={
          <Button variant="primary" onClick={onReturnHome}>
            <RefreshIcon size={14} />
            <span>返回主页</span>
          </Button>
        }
      />
    </div>
  );
}
