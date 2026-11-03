import { useEffect, useState } from 'react';
import type { Note } from '@study-accelerator/web-core';
import { Button, SearchBox, SegmentedButton, SegmentedControl, TextField } from '../../components/ui';
import type { usePdfViewer } from './usePdfViewer';
import styles from './PdfReader.module.css';
interface PdfReaderToolbarProps {
  note: Note;
  viewer: ReturnType<typeof usePdfViewer>;
  canWrite: boolean;
  editable: boolean;
  loaded: boolean;
  panel: boolean;
  tool: string;
  selection: boolean;
  onBack(): void;
  onFavorite(): Promise<void>;
  onOutline(): void;
  onDownload(): Promise<void>;
  onExport(): Promise<void>;
  onPanel(): void;
  onTool(tool: string): void;
  onHighlight(): void;
}
export function PdfReaderToolbar({
  note,
  viewer,
  canWrite,
  editable,
  loaded,
  panel,
  tool,
  selection,
  onBack,
  onFavorite,
  onOutline,
  onDownload,
  onExport,
  onPanel,
  onTool,
  onHighlight
}: PdfReaderToolbarProps) {
  const [pageInput, setPageInput] = useState('1'),
    [query, setQuery] = useState('');
  useEffect(() => {
    setPageInput(String(viewer.page));
  }, [viewer.page]);
  return (
    <>
      <div className={styles.toolbar} role="toolbar" aria-label="PDF 阅读工具">
        <Button size="compact" variant="ghost" onPress={() => onBack()}>
          资料库
        </Button>
        <strong className={styles.title}>{note.title}</strong>
        <Button size="compact" variant="ghost" isDisabled={!canWrite} onPress={() => void onFavorite()}>
          {note.favorite ? '取消收藏' : '收藏'}
        </Button>
        <Button size="compact" variant="ghost" onPress={() => onOutline()}>
          目录
        </Button>
        <Button size="compact" variant="ghost" onPress={() => void onDownload()}>
          原文件
        </Button>
        <Button size="compact" variant="ghost" isDisabled={!loaded} onPress={() => void onExport()}>
          导出摘录
        </Button>
        <Button size="compact" variant="ghost" aria-pressed={panel} onPress={() => onPanel()}>
          标注
        </Button>
      </div>
      <div className={styles.toolbar} role="toolbar" aria-label="PDF 页面和标注工具">
        <Button
          size="compact"
          variant="ghost"
          isDisabled={viewer.page <= 1}
          onPress={() => {
            if (viewer.viewerRef.current) viewer.viewerRef.current.currentPageNumber--;
          }}
        >
          上一页
        </Button>
        <div className={styles.pageField}>
          <TextField
            label="页码"
            type="number"
            value={pageInput}
            onChange={setPageInput}
            onKeyDown={event => {
              if (event.key === 'Enter' && viewer.viewerRef.current)
                viewer.viewerRef.current.currentPageNumber = Math.max(
                  1,
                  Math.min(viewer.count, Number(pageInput) || 1)
                );
            }}
          />
        </div>
        <span>/ {viewer.count}</span>
        <Button
          size="compact"
          variant="ghost"
          isDisabled={viewer.page >= viewer.count}
          onPress={() => {
            if (viewer.viewerRef.current) viewer.viewerRef.current.currentPageNumber++;
          }}
        >
          下一页
        </Button>
        <Button
          size="compact"
          variant="ghost"
          aria-label="缩小 PDF"
          onPress={() => viewer.viewerRef.current?.decreaseScale()}
        >
          −
        </Button>
        <Button
          size="compact"
          variant="ghost"
          onPress={() => {
            if (viewer.viewerRef.current) viewer.viewerRef.current.currentScaleValue = 'page-width';
          }}
        >
          适合宽度
        </Button>
        <Button
          size="compact"
          variant="ghost"
          aria-label="放大 PDF"
          onPress={() => viewer.viewerRef.current?.increaseScale()}
        >
          ＋
        </Button>
        <Button
          size="compact"
          variant="ghost"
          onPress={() => {
            const engine = viewer.viewerRef.current;
            if (engine) engine.pagesRotation = (engine.pagesRotation + 90) % 360;
          }}
        >
          旋转
        </Button>
        <SegmentedControl density="compact" aria-label="PDF 标注工具">
          <SegmentedButton aria-pressed={tool === 'text'} onPress={() => onTool('text')}>
            文字选择
          </SegmentedButton>
          <SegmentedButton aria-pressed={tool === 'region'} isDisabled={!editable} onPress={() => onTool('region')}>
            区域框选
          </SegmentedButton>
        </SegmentedControl>
        <Button
          size="compact"
          isDisabled={!editable || !selection}
          onPress={() => {
            onHighlight();
          }}
        >
          高亮选区
        </Button>
        <div className={styles.search}>
          <SearchBox
            label="在 PDF 中搜索"
            value={query}
            onChange={event => setQuery(event.target.value)}
            onClear={() => {
              setQuery('');
              viewer.eventRef.current?.dispatch('findbarclose', {});
            }}
            onKeyDown={event => {
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
      </div>
    </>
  );
}
