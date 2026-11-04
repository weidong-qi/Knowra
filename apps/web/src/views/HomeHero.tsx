// 首页首屏：铺满整页的插画背景、超大问候标题、三个常用入口，底部是浮出的最近笔记卡片（children）。
// 按钮的可访问名称与原 HomeHeader 保持一致。

import type { ReactNode } from 'react';
import { version as appVersion } from '../../../../package.json';
import { Button } from '../components/ui/button/Button';
import { PixelFace } from '../components/companion';
import { CalendarIcon, PlusIcon, SearchIcon } from '../components/icons/knowra';
import { HomeArt } from './HomeArt';
import styles from './HomeHero.module.css';

interface HomeHeroProps {
  id: string;
  today: string;
  title: string;
  subtitle: string;
  onOpenCreate?: () => void;
  onOpenSchedule?: () => void;
  onOpenSearch?: () => void;
  children?: ReactNode;
}

export function HomeHero({
  id,
  today,
  title,
  subtitle,
  onOpenCreate,
  onOpenSchedule,
  onOpenSearch,
  children
}: HomeHeroProps) {
  return (
    <header className={styles.hero}>
      <HomeArt />
      <div className={styles.sun} aria-hidden="true">
        <PixelFace className={styles.sunFace} proximity={220} idleAfterMs={25000} maxLookOffset={6} />
      </div>
      <div className={styles.copy}>
        <p className={styles.kicker}>
          <span className={styles.kickerPill}>{today}</span>
          <span className={styles.version}>版本 v{appVersion}</span>
        </p>
        <h1 id={id} className={styles.title}>
          {title}
        </h1>
        <p className={styles.subtitle}>{subtitle}</p>
        <div className={styles.actions}>
          <Button
            variant="primary"
            className={styles.createButton}
            onClick={onOpenCreate}
            isDisabled={!onOpenCreate}
            aria-label="新建笔记（Ctrl+N）"
          >
            <PlusIcon size={16} />
            <span>新建笔记</span>
            <kbd>Ctrl+N</kbd>
          </Button>
          {onOpenSearch ? (
            <Button className={styles.ghostButton} onClick={onOpenSearch} aria-label="打开全局搜索">
              <SearchIcon size={15} />
              <span>搜索</span>
              <kbd>Ctrl+K</kbd>
            </Button>
          ) : null}
          <Button
            className={styles.ghostButton}
            onClick={onOpenSchedule}
            isDisabled={!onOpenSchedule}
            aria-label="打开日程"
          >
            <CalendarIcon size={16} />
            <span>日程</span>
          </Button>
        </div>
      </div>
      {children ? <div className={styles.stage}>{children}</div> : null}
    </header>
  );
}
