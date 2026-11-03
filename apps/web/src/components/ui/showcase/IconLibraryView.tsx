import { useMemo, useState, type CSSProperties } from 'react';
import { SearchBox } from '../input/SearchBox';
import * as icons from '../../icons/knowra';
import styles from './IconLibraryView.module.css';

type IconName = Exclude<keyof typeof icons, 'IconBase' | 'ACCENT'>;

interface IconGroup {
  id: string;
  title: string;
  caption: string;
  columns: number;
  names: readonly IconName[];
}

export const iconGroups: readonly IconGroup[] = [
  {
    id: 'entities', title: '文件、知识与实体', caption: 'FILES, KNOWLEDGE & ENTITIES', columns: 9,
    names: [
      'NoteIcon', 'BookIcon', 'KnowledgeIcon', 'QuestionIcon', 'FolderIcon', 'TagIcon', 'LinkIcon',
      'PaperclipIcon', 'StarIcon', 'SparkIcon', 'NodesIcon', 'TargetIcon', 'ClockIcon',
      'CalendarIcon', 'CheckIcon', 'UserIcon', 'HomeIcon', 'BellIcon', 'InboxIcon'
    ]
  },
  {
    id: 'navigation', title: '导航与常用操作', caption: 'NAVIGATION & COMMON ACTIONS', columns: 9,
    names: [
      'SearchIcon', 'PlusIcon', 'FilterIcon', 'SettingsIcon', 'ArrowRightIcon',
      'ChevronRightIcon', 'ChevronDownIcon', 'CloseIcon', 'ArrowUpRightIcon',
      'RefreshIcon', 'UploadIcon', 'SortArrowsIcon', 'SidebarIcon', 'PanelIcon',
      'FocusIcon', 'ComponentLibraryIcon', 'MoreHorizontalIcon', 'MoreVerticalIcon'
    ]
  },
  {
    id: 'editing', title: '编辑、排版与内容', caption: 'EDITING, TYPOGRAPHY & CONTENT', columns: 10,
    names: [
      'CodeIcon', 'ListIcon', 'OrderedListIcon', 'TaskListIcon', 'QuoteIcon',
      'TableIcon', 'ImageIcon', 'BoldIcon', 'ItalicIcon', 'HighlightIcon',
      'StrikethroughIcon', 'CutIcon', 'CopyIcon', 'PasteIcon', 'DeleteIcon',
      'EditIcon', 'IndentIcon', 'OutdentIcon', 'HorizontalRuleIcon', 'ParagraphAddIcon'
    ]
  },
  {
    id: 'states', title: '行内状态与辅助符号', caption: 'INLINE STATES & UTILITY GLYPHS', columns: 9,
    names: [
      'DropdownArrowIcon', 'TreeExpandIcon', 'SearchClearIcon', 'DialogCloseIcon',
      'CheckboxCheckedIcon', 'CheckboxIndeterminateIcon', 'TagSelectedCheckIcon',
      'TagRemoveIcon', 'StatusDotIcon'
    ]
  },
  {
    id: 'extensions', title: '扩展图标', caption: 'FILES, HISTORY & EXPORT', columns: 11,
    names: [
      'ExpandedFolderIcon', 'MarkdownFileIcon', 'PdfFileIcon', 'ResourceFileIcon',
      'DuplicateIcon', 'DownloadIcon', 'ExportIcon', 'BackupIcon', 'RestoreIcon',
      'UndoIcon', 'RedoIcon'
    ]
  }
];

const totalIcons = iconGroups.reduce((total, group) => total + group.names.length, 0);

export function IconLibraryView() {
  const [query, setQuery] = useState('');
  const groups = useMemo(() => iconGroups.map((group, index) => ({
    ...group,
    number: index + 1,
    names: group.names.filter((name) => name.toLowerCase().includes(query.trim().toLowerCase()))
  })).filter((group) => group.names.length > 0), [query]);
  const count = groups.reduce((total, group) => total + group.names.length, 0);

  return <main className={styles.library} aria-labelledby="icon-library-title">
    <div className={styles.inner}>
      <header className={styles.masthead}>
        <div>
          <h1 id="icon-library-title" className={styles.wordmark}>Knowra<span aria-hidden="true" /></h1>
          <p className={styles.tagline}>知境图标库 · 把想法整理成知识</p>
        </div>
        <div className={styles.mastheadNote} aria-label="图标库说明">
          <span>捕捉</span><span>组织</span><span>思考</span><span>成长</span>
        </div>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.summary}>
          <a href="#/showcase" className={styles.backLink}>组件展台 /</a>
          <strong>图标库</strong>
          <span>{count} / {totalIcons}</span>
        </div>
        <div className={styles.search}>
          <SearchBox
            size="field"
            label="搜索图标"
            placeholder="搜索图标名称…"
            value={query}
            onChange={event => setQuery(event.target.value)}
            onClear={query ? () => setQuery('') : undefined}
          />
        </div>
      </div>

      {groups.length ? groups.map((group) => <section key={group.id} className={styles.section} aria-labelledby={`icon-group-${group.id}`}>
        <div className={styles.sectionHeading}>
          <span className={styles.marker} aria-hidden="true" />
          <span className={styles.index}>{String(group.number).padStart(2, '0')}</span>
          <h2 id={`icon-group-${group.id}`}>{group.title}</h2>
          <span className={styles.rule} aria-hidden="true" />
          <span className={styles.caption}>{group.caption}</span>
        </div>
        <div className={styles.iconGrid} style={{ '--icon-columns': group.columns } as CSSProperties}>
          {group.names.map((name) => {
            const Icon = icons[name];
            return <figure key={name} className={styles.iconCard}>
              <div className={styles.iconStage} aria-hidden="true"><Icon size={56} strokeWidth={1.25} /></div>
              <figcaption>{name}</figcaption>
            </figure>;
          })}
        </div>
      </section>) : <p className={styles.empty}>没有匹配的图标。试试英文组件名，例如 Search 或 Folder。</p>}

      <footer className={styles.footer}>
        <span>KNOWRA · YOUR IDEAS, IN ORDER.</span>
        <span className={styles.footerRule} aria-hidden="true" />
        <span><i aria-hidden="true" /> KNOWLEDGE WORKS BETTER HERE.</span>
      </footer>
    </div>
  </main>;
}
