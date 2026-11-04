import { version as appVersion } from '../../../../package.json';
import { Button } from '../components/ui/button/Button';
import { PixelFace } from '../components/companion';
import { CalendarIcon, PlusIcon, SearchIcon } from '../components/icons/knowra';
import styles from './HomeView.module.css';

interface HomeHeaderProps {
  id: string;
  today: string;
  title: string;
  subtitle: string;
  onOpenCreate?: () => void;
  onOpenSchedule?: () => void;
  onOpenSearch?: () => void;
}

export function HomeHeader({ id, today, title, subtitle, onOpenCreate, onOpenSchedule, onOpenSearch }: HomeHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.headerLead}>
        <PixelFace className={styles.headerFace} proximity={120} idleAfterMs={25000} />
        <p className={styles.kicker}>{today}<span className={styles.version}>版本 v{appVersion}</span></p>
        <h1 id={id} className={styles.title}>{title}</h1>
        <p className={styles.subtitle}>{subtitle}</p>
      </div>
      <div className={styles.headerActions}>
        {onOpenSearch ? (
          <Button className={styles.searchButton} onClick={onOpenSearch} aria-label="打开全局搜索">
            <SearchIcon size={15} />
            <span>搜索</span>
            <kbd>Ctrl+K</kbd>
          </Button>
        ) : null}
        <Button className={styles.scheduleButton} onClick={onOpenSchedule} isDisabled={!onOpenSchedule} aria-label="打开日程">
          <CalendarIcon size={16} />
          <span>日程</span>
        </Button>
        <Button variant="primary" className={styles.createButton} onClick={onOpenCreate} isDisabled={!onOpenCreate} aria-label="新建笔记（Ctrl+N）">
          <PlusIcon size={16} />
          <span>新建笔记</span>
          <kbd>Ctrl+N</kbd>
        </Button>
      </div>
    </header>
  );
}
