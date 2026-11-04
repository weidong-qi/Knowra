// V4-05 SearchCommand
//
// 全局搜索 + 跳转面板（Cmd/Ctrl+K 触发）。
// 1. 视觉：V5 共享 Dialog 与语义结果卡片；命令式键盘导航。
// 2. 数据源：当前空间的资料标题、正文片段、标签与动作。
// 3. 键盘：↑↓ 移动高亮、Enter 跳转、Esc 关闭、focus 由 Dialog 焦点陷阱接管。

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { COMMAND_SEARCH_QUERY_LIMIT, type CommandNoteSearcher, type CommandNoteSearchHit } from '@study-accelerator/web-core';
import { Dialog, DialogBody } from '../components/ui/overlay/Dialog';
import { EmptyState, LoadingState } from '../components/ui/status';
import { SearchBox } from '../components/ui/input';
import { cx } from '../components/ui/classnames';
import { SearchIcon } from '../components/icons/knowra';
import { useCommandNoteSearch } from './useCommandNoteSearch';
import { useCommandSelection, type CommandSelectionContext, type CommandSelectionResult } from './useCommandSelection';
import { MathText } from '../components/math/MathText';
import styles from './SearchCommand.module.css';

export interface SearchHit {
  id: string;
  primary: string;
  secondary?: string;
  hint?: string;
  group: '资料' | '标签' | '动作';
  onSelect(context: CommandSelectionContext): CommandSelectionResult;
}

export interface SearchCommandProps {
  isOpen: boolean;
  onOpenChange(open: boolean): void;
  hits: SearchHit[];
  isLoading?: boolean;
  commandSearch?: {
    spaceId: string | null;
    search: CommandNoteSearcher;
    scopeKey?: unknown;
    onSelect(note: CommandNoteSearchHit, context: CommandSelectionContext): CommandSelectionResult;
  };
  /** 输入框 placeholder。 */
  placeholder?: string;
}

export function SearchCommand({
  isOpen,
  onOpenChange,
  hits,
  isLoading,
  commandSearch,
  placeholder = '搜索资料正文、标签、动作…'
}: SearchCommandProps) {
  const [query, setQuery] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const spaceId = commandSearch?.spaceId ?? null;
  const bodySearch = useCommandNoteSearch({ isOpen, isComposing, query, spaceId, search: commandSearch?.search, scopeKey: commandSearch?.scopeKey });
  const selectionScope = useMemo(() => ({}), [query, spaceId, isOpen, isComposing, commandSearch?.search, commandSearch?.scopeKey, bodySearch.hits]);
  const opening = useCommandSelection(selectionScope, () => onOpenChange(false));
  const [selection, setSelection] = useState({ scope: selectionScope, index: 0 });
  const activeIndex = selection.scope === selectionScope ? selection.index : 0;
  const setActiveIndex = (index: number) => setSelection({ scope: selectionScope, index });
  const inputRef = useRef<HTMLInputElement>(null);
  const pending = Boolean(isLoading) || bodySearch.state === 'loading' || isComposing || opening.pending;
  const selectable = isOpen && !pending && bodySearch.state !== 'error';

  // 每次打开清空 query 并聚焦。
  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setIsComposing(false);
      return;
    }
    const handle = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(handle);
  }, [isOpen]);

  const filtered = useMemo(() => {
    if (!isOpen) return [];
    if (!query.trim()) return hits;
    const needle = query.trim().toLowerCase();
    const localHits = hits.filter((hit) => {
      const haystack = `${hit.primary} ${hit.secondary ?? ''}`.toLowerCase();
      return haystack.includes(needle);
    });
    const remoteHits = new Map(bodySearch.hits.map(note => [`note:${note.id}`, note]));
    const merged = localHits.map(hit => remoteHits.has(hit.id) ? { ...hit, secondary: remoteHits.get(hit.id)!.snippet } : hit);
    const localIds = new Set(localHits.map(hit => hit.id));
    // 正文已由服务端匹配，不能再次用标题过滤丢弃。
    for (const [id, note] of remoteHits) {
      if (localIds.has(id) || !commandSearch) continue;
      merged.push({ id, primary: note.title || '（无标题）', secondary: note.snippet, hint: '资料', group: '资料', onSelect: context => commandSearch.onSelect(note, context) });
    }
    return merged;
  }, [hits, query, isOpen, bodySearch.hits, commandSearch]);

  // 当过滤结果变化时，保证 activeIndex 不越界。
  useEffect(() => {
    const boundedIndex = Math.min(activeIndex, Math.max(0, filtered.length - 1));
    if (boundedIndex !== activeIndex) setActiveIndex(boundedIndex);
  }, [filtered, activeIndex, selectionScope]);

  const handleOpenChange = (open: boolean) => { if (!open) opening.cancel(); onOpenChange(open); };

  function handleKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || isComposing || event.nativeEvent.keyCode === 229) return;
    if (!selectable) {
      if (['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) event.preventDefault();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (filtered.length === 0) return;
      setActiveIndex((activeIndex + 1) % filtered.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (filtered.length === 0) return;
      setActiveIndex((activeIndex - 1 + filtered.length) % filtered.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const hit = filtered[activeIndex];
      if (hit) opening.select(hit.onSelect);
    }
  }

  const activeHit = selectable ? filtered[activeIndex] : undefined;

  return (
    <Dialog
      title="全局搜索"
      description="使用 ⌘ K / Ctrl K 随时唤起。"
      isOpen={isOpen}
      onOpenChange={handleOpenChange}
      size="md"
    >
      <DialogBody>
        <div className={styles.commandPanel}>
          <SearchBox size="command" label="搜索关键字" icon={<SearchIcon size={18} />}
            ref={inputRef} type="text" name="global-search" autoComplete="off"
            value={query} maxLength={COMMAND_SEARCH_QUERY_LIMIT} placeholder={placeholder} onChange={(event) => { opening.cancel(); setQuery(event.target.value); }} onKeyDown={handleKey}
            onCompositionStart={() => { opening.cancel(); setIsComposing(true); }}
            onCompositionEnd={(event) => { setQuery(event.currentTarget.value); setIsComposing(false); }}
            aria-controls="search-command-results" aria-activedescendant={activeHit ? `search-hit-${activeHit.id}` : undefined}
            role="combobox" aria-autocomplete="list" aria-expanded={isOpen}
            onClear={query ? () => { opening.cancel(); setQuery(''); setIsComposing(false); inputRef.current?.focus(); } : undefined}
            clearText="清除" clearLabel="清除搜索关键字" />
          <div
            id="search-command-results"
            className={styles.hitList}
            aria-busy={pending ? 'true' : undefined}
          >
            {opening.error ? <div role="alert"><EmptyState title="打开笔记失败" description={opening.error} /></div> : null}
            {pending ? (
              <LoadingState label={opening.pending ? '正在载入笔记…' : isComposing ? '输入完成后搜索…' : '正在搜索…'} />
            ) : bodySearch.state === 'error' ? (
              <div role="alert"><EmptyState title="正文搜索失败" description={bodySearch.error ?? '请重新输入关键字重试。'} /></div>
            ) : filtered.length === 0 ? (
              <EmptyState
                title={query ? `没有匹配「${query.trim()}」的结果` : '没有可跳转的目标'}
                description={query ? '试试更换关键词，或新建一份资料。' : '连接资料服务后可搜索资料标题、正文与标签。'}
              />
            ) : (
              <SearchResults
                hits={filtered}
                activeIndex={activeIndex}
                onActiveChange={setActiveIndex}
                onSelect={(hit) => {
                  if (!selectable || !filtered.includes(hit)) return;
                  opening.select(hit.onSelect);
                }}
              />
            )}
          </div>
        </div>
      </DialogBody>
    </Dialog>
  );
}

interface SearchResultsProps {
  hits: SearchHit[];
  activeIndex: number;
  onActiveChange(index: number): void;
  onSelect(hit: SearchHit): void;
}

function SearchResults({ hits, activeIndex, onActiveChange, onSelect }: SearchResultsProps) {
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const list = listRef.current;
    const scrollport = list?.parentElement;
    const active = list?.children.item(activeIndex);
    if (!scrollport || !(active instanceof HTMLElement)) return;
    // 只滚动结果区，不能移动对话框/页面，也不从 combobox 抢走键盘焦点。
    const row = active.getBoundingClientRect();
    const viewport = scrollport.getBoundingClientRect();
    const top = viewport.top + scrollport.clientTop;
    const bottom = top + scrollport.clientHeight;
    if (row.top < top) scrollport.scrollTop += row.top - top;
    else if (row.bottom > bottom) scrollport.scrollTop += row.bottom - bottom;
  }, [activeIndex, hits]);
  return (
    <ul ref={listRef} className={styles.resultList} role="listbox">
      {hits.map((hit, index) => {
        const isActive = index === activeIndex;
        return (
          <li
            key={hit.id}
            id={`search-hit-${hit.id}`}
            role="option"
            aria-selected={isActive}
            className={cx(styles.hit, isActive && styles.hitActive)}
            onMouseEnter={() => onActiveChange(index)}
            onClick={() => onSelect(hit)}
          >
            <span className={styles.hitGroup}>{hit.group}</span>
            <span className={styles.hitBody}>
              <span className={styles.hitPrimary}><MathText text={hit.primary} inlineOnly /></span>
              {hit.secondary ? <span className={styles.hitSecondary}><MathText text={hit.secondary} inlineOnly /></span> : null}
            </span>
            {hit.hint ? <span className={styles.hitHint}>{hit.hint}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}
