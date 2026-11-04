import { useState } from 'react';
import type { Note } from '@study-accelerator/web-core';
import {
  ChevronLeftIcon,
  FocusIcon,
  ListIcon,
  MoreHorizontalIcon,
  PanelIcon,
  RefreshIcon,
  SearchIcon
} from '../../components/icons/knowra';
import { IconButton, SearchBox, SegmentedButton, SegmentedControl } from '../../components/ui';
import { Menu, MenuItem, MenuPopover, MenuTrigger } from '../../components/ui/overlay';
import type { usePdfViewer } from './usePdfViewer';
import styles from './PdfReader.module.css';
interface PdfReaderToolbarProps {
  note: Note;
  viewer: ReturnType<typeof usePdfViewer>;
  canWrite: boolean;
  editable: boolean;
  loaded: boolean;
  panel: boolean;
  outlineOpen: boolean;
  tool: string;
  onBack(): void;
  onFavorite(): Promise<void>;
  onOutline(): void;
  onDownload(): Promise<void>;
  onExport(): Promise<void>;
  onExtract(): Promise<void>;
  onPanel(): void;
  onTool(tool: string): void;
}
export function PdfReaderToolbar({
  note,
  viewer,
  canWrite,
  editable,
  loaded,
  panel,
  outlineOpen,
  tool,
  onBack,
  onFavorite,
  onOutline,
  onDownload,
  onExport,
  onExtract,
  onPanel,
  onTool
}: PdfReaderToolbarProps) {
  const [query, setQuery] = useState(''),
    [searchOpen, setSearchOpen] = useState(false);
  const engine = () => viewer.viewerRef.current;
  return (
    <div className={styles.toolbar} role="toolbar" aria-label="PDF 阅读工具">
      <IconButton size={28} aria-label="返回资料库" title="返回资料库" onPress={() => onBack()}>
        <ChevronLeftIcon size={18} />
      </IconButton>
      <strong className={styles.title} title={note.title}>
        {note.title}
      </strong>
      <span className={styles.separator} aria-hidden="true" />
      <IconButton size={28} aria-label="缩小 PDF" title="缩小" onPress={() => engine()?.decreaseScale()}>
        <span className={styles.glyph}>−</span>
      </IconButton>
      <IconButton size={28} aria-label="放大 PDF" title="放大" onPress={() => engine()?.increaseScale()}>
        <span className={styles.glyph}>＋</span>
      </IconButton>
      <IconButton
        size={28}
        aria-label="适合宽度"
        title="适合宽度"
        onPress={() => {
          if (engine()) engine()!.currentScaleValue = 'page-width';
        }}
      >
        <FocusIcon size={16} />
      </IconButton>
      <IconButton
        size={28}
        aria-label="旋转"
        title="旋转"
        onPress={() => {
          if (engine()) engine()!.pagesRotation = (engine()!.pagesRotation + 90) % 360;
        }}
      >
        <RefreshIcon size={16} />
      </IconButton>
      <span className={styles.separator} aria-hidden="true" />
      <SegmentedControl density="compact" aria-label="PDF 标注工具">
        <SegmentedButton aria-label="文字选择" aria-pressed={tool === 'text'} onPress={() => onTool('text')}>
          文字
        </SegmentedButton>
        <SegmentedButton
          aria-label="区域框选"
          aria-pressed={tool === 'region'}
          isDisabled={!editable}
          onPress={() => onTool('region')}
        >
          区域
        </SegmentedButton>
        <SegmentedButton
          aria-label="便签工具"
          aria-pressed={tool === 'note'}
          isDisabled={!editable}
          onPress={() => onTool('note')}
        >
          便签
        </SegmentedButton>
      </SegmentedControl>
      <span className={styles.toolbarSpacer} />
      {searchOpen ? (
        <div className={styles.search}>
          <SearchBox
            label="在 PDF 中搜索"
            value={query}
            autoFocus
            onChange={event => setQuery(event.target.value)}
            onClear={() => {
              setQuery('');
              viewer.eventRef.current?.dispatch('findbarclose', {});
            }}
            onKeyDown={event => {
              if (event.key === 'Escape') {
                setSearchOpen(false);
                viewer.eventRef.current?.dispatch('findbarclose', {});
              }
              if (event.key === 'Enter')
                viewer.eventRef.current?.dispatch('find', {
                  type: 'again',
                  query,
                  phraseSearch: true,
                  caseSensitive: false,
                  highlightAll: true,
                  findPrevious: event.shiftKey
                });
            }}
            placeholder="搜索 PDF，回车查找"
          />
        </div>
      ) : (
        <IconButton size={28} aria-label="搜索" title="在 PDF 中搜索" onPress={() => setSearchOpen(true)}>
          <SearchIcon size={16} />
        </IconButton>
      )}
      <IconButton size={28} aria-label="目录" title="目录" aria-pressed={outlineOpen} onPress={() => onOutline()}>
        <ListIcon size={16} />
      </IconButton>
      <IconButton size={28} aria-label="标注" title="标注" aria-pressed={panel} onPress={() => onPanel()}>
        <PanelIcon size={16} />
      </IconButton>
      <MenuTrigger>
        <IconButton size={28} aria-label="更多" title="更多">
          <MoreHorizontalIcon size={16} />
        </IconButton>
        <MenuPopover>
          <Menu
            ariaLabel="PDF 更多操作"
            onAction={key => {
              if (key === 'favorite') void onFavorite();
              if (key === 'download') void onDownload();
              if (key === 'export') void onExport();
              if (key === 'extract') void onExtract();
            }}
          >
            <MenuItem id="favorite" isDisabled={!canWrite}>
              {note.favorite ? '取消收藏' : '收藏'}
            </MenuItem>
            <MenuItem id="download">下载原文件</MenuItem>
            <MenuItem id="extract" isDisabled={!loaded || !canWrite}>
              提取到笔记
            </MenuItem>
            <MenuItem id="export" isDisabled={!loaded}>
              导出摘录
            </MenuItem>
          </Menu>
        </MenuPopover>
      </MenuTrigger>
    </div>
  );
}
