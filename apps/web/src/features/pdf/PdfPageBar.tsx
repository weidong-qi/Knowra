import { useEffect, useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from '../../components/icons/knowra';
import { IconButton, TextField } from '../../components/ui';
import type { usePdfViewer } from './usePdfViewer';
import styles from './PdfReader.module.css';

/** 悬浮在阅读区底部的页码条：上一页、页码输入、总页数、下一页。 */
export function PdfPageBar({ viewer }: { viewer: ReturnType<typeof usePdfViewer> }) {
  const [pageInput, setPageInput] = useState('1');
  useEffect(() => {
    setPageInput(String(viewer.page));
  }, [viewer.page]);
  const engine = () => viewer.viewerRef.current;
  return (
    <div className={styles.pageBar} role="group" aria-label="PDF 页码">
      <IconButton
        size={28}
        aria-label="上一页"
        title="上一页"
        isDisabled={viewer.page <= 1}
        onPress={() => {
          if (engine()) engine()!.currentPageNumber--;
        }}
      >
        <ChevronLeftIcon size={16} />
      </IconButton>
      <div className={styles.pageField}>
        <TextField
          label="页码"
          type="number"
          appearance="inline"
          value={pageInput}
          onChange={setPageInput}
          onBlur={() => setPageInput(String(viewer.page))}
          onKeyDown={event => {
            if (event.key === 'Enter' && engine())
              engine()!.currentPageNumber = Math.max(1, Math.min(viewer.count, Number(pageInput) || 1));
          }}
        />
      </div>
      <span className={styles.pageCount}>/ {viewer.count}</span>
      <IconButton
        size={28}
        aria-label="下一页"
        title="下一页"
        isDisabled={viewer.page >= viewer.count}
        onPress={() => {
          if (engine()) engine()!.currentPageNumber++;
        }}
      >
        <ChevronRightIcon size={16} />
      </IconButton>
    </div>
  );
}
