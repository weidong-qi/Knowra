// 首页欢迎区：大标题、一句话摘要、三个常用入口，右侧是插画。
// 对应原 HomeHeader：按钮的可访问名称保持不变。

import { version as appVersion } from '../../../../package.json';
import { Button } from '../components/ui/button/Button';
import { CalendarIcon, PlusIcon, SearchIcon } from '../components/icons/knowra';
import { HomeIllustration } from './HomeIllustration';
import styles from './HomeHero.module.css';

interface HomeHeroProps {
  id: string;
  today: string;
  title: string;
  subtitle: string;
  onOpenCreate?: () => void;
  onOpenSchedule?: () => void;
  onOpenSearch?: () => void;
}

export function HomeHero({ id, today, title, subtitle, onOpenCreate, onOpenSchedule, onOpenSearch }: HomeHeroProps) {
  return (
    <header className={styles.hero}>
      <div className={styles.copy}>
        <p className={styles.kicker}>
          {today}
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
            <Button onClick={onOpenSearch} aria-label="打开全局搜索">
              <SearchIcon size={15} />
              <span>搜索</span>
              <kbd>Ctrl+K</kbd>
            </Button>
          ) : null}
          <Button onClick={onOpenSchedule} isDisabled={!onOpenSchedule} aria-label="打开日程">
            <CalendarIcon size={16} />
            <span>日程</span>
          </Button>
        </div>
      </div>
      <HomeIllustration />
    </header>
  );
}
