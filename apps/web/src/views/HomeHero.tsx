// 首页首屏：铺满整页的手绘涂鸦背景，底部浮出最近笔记便签（children）。
// 不放大标题、摘要和入口按钮；问候语仅作为读屏可见的一级标题保留。

import type { ReactNode } from 'react';
import { version as appVersion } from '../../../../package.json';
import { HomeArt } from './HomeArt';
import styles from './HomeHero.module.css';

interface HomeHeroProps {
  id: string;
  today: string;
  /** 读屏可见的一级标题（问候语）。 */
  title: string;
  children?: ReactNode;
}

export function HomeHero({ id, today, title, children }: HomeHeroProps) {
  return (
    <header className={styles.hero}>
      <HomeArt />
      <h1 id={id} className={styles.srOnly}>
        {title}
      </h1>
      <p className={styles.kicker}>
        <span className={styles.kickerPill}>{today}</span>
        <span className={styles.version}>版本 v{appVersion}</span>
      </p>
      {children ? <div className={styles.stage}>{children}</div> : null}
    </header>
  );
}
