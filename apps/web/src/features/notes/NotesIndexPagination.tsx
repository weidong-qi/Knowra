import styles from './NotesIndexView.module.css';
import { Button, IconButton, Menu, MenuItem, MenuPopover, MenuTrigger } from '../../components/ui';
import { ChevronDownIcon, ChevronRightIcon } from '../../components/icons/knowra';
import { WorkspacePanelFooter } from '../../components/workspace/WorkspacePanel';
import { notesIndexAppearanceProps } from './NotesIndexAppearance';
import { useNotesIndexAppearance } from './notesIndexAppearanceModel';

const PAGE_SIZES = [5, 10, 20, 50];
export function NotesIndexPagination({ page, pageCount, total, noteTotal, folderTotal, pageSize, loading, hasMore, onLoadMore, onPageChange, onPageSizeChange }: {
  page: number; pageCount: number; total: number; noteTotal: number; folderTotal: number; pageSize: number; loading: boolean; hasMore: boolean;
  onLoadMore(): void; onPageChange(page: number): void; onPageSizeChange(size: number): void;
}) {
  const theme = notesIndexAppearanceProps(useNotesIndexAppearance());
  const pages = Array.from(new Set([0, pageCount - 1, page - 1, page, page + 1])).filter(value => value >= 0 && value < pageCount).sort((a, b) => a - b);
  return <WorkspacePanelFooter className={styles.pagination}>
    <span className={styles.pageCount}>
      {hasMore ? '已载入 ' : ''}{noteTotal || !folderTotal ? `${noteTotal} 篇笔记` : `${folderTotal} 个文件夹`}
      <span className={styles.srOnly} aria-live="polite">第 {page + 1} / {pageCount} 页 · {hasMore ? `已载入 ${total} 条` : `共 ${total} 条`}</span>
    </span>
    <div className={styles.pageNavigation}>
      <nav aria-label="笔记分页">
        <IconButton size={24} aria-label="上一页" isDisabled={loading || page === 0} onPress={() => onPageChange(page - 1)}><span className={styles.previous}><ChevronRightIcon size={12} /></span></IconButton>
        {pages.map((value, index) => <span className={styles.pageEntry} key={value}>
          {index > 0 && value - pages[index - 1] > 1 ? <span aria-hidden="true">…</span> : null}
          <Button size="footer" variant="ghost" aria-label={`第 ${value + 1} 页`} aria-current={page === value ? 'page' : undefined} isDisabled={loading} onPress={() => onPageChange(value)}>{value + 1}</Button>
        </span>)}
        <IconButton size={24} aria-label="下一页" isDisabled={loading || page + 1 >= pageCount} onPress={() => onPageChange(page + 1)}><ChevronRightIcon size={12} /></IconButton>
      </nav>
      <MenuTrigger><Button size="footer" variant="ghost" aria-label="每页条数">每页 {pageSize} 条<ChevronDownIcon size={11} /></Button>
        <MenuPopover {...theme}><Menu ariaLabel="每页条数" selectionMode="single" selectedKeys={[String(pageSize)]} onAction={key => onPageSizeChange(Number(key))}>
          {PAGE_SIZES.map(size => <MenuItem id={String(size)} key={size}>每页 {size} 条</MenuItem>)}
        </Menu></MenuPopover>
      </MenuTrigger>
      {hasMore ? <Button size="footer" isDisabled={loading} onPress={onLoadMore}>{loading ? '正在加载…' : '加载更多'}</Button> : null}
    </div>
    <span className={styles.keyboardHint} aria-label="快捷键提示"><kbd>J</kbd><kbd>K</kbd>移动<kbd>X</kbd>选择<kbd>Space</kbd>预览<kbd>↵</kbd>打开</span>
  </WorkspacePanelFooter>;
}
