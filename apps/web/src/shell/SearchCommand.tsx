import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  COMMAND_SEARCH_QUERY_LIMIT,
  type CommandNoteSearcher,
  type CommandNoteSearchHit
} from '@study-accelerator/web-core';
import { Dialog, DialogBody, DialogFooter } from '../components/ui/overlay/Dialog';
import { EmptyState, LoadingState } from '../components/ui/status';
import { SearchBox, Select } from '../components/ui/input';
import { cx } from '../components/ui/classnames';
import { ListBoxOption } from '../components/ui/collection/ListBoxOption';
import { hasMath } from '../components/math/splitMath';
import { ArrowUpRightIcon, NoteIcon, SearchIcon, TagIcon } from '../components/icons/knowra';
import { useCommandNoteSearch } from './useCommandNoteSearch';
import { useCommandSelection, type CommandSelectionContext, type CommandSelectionResult } from './useCommandSelection';
import { MathText } from '../components/math/MathText';
import styles from './SearchCommand.module.css';

export interface SearchHit {
  id: string;
  primary: string;
  secondary?: string;
  hint?: string;
  isSnippet?: boolean;
  group: '资料' | '标签' | '动作';
  onSelect(context: CommandSelectionContext): CommandSelectionResult;
}

const searchScopes = ['全部', '资料', '标签', '动作'] as const;
type SearchScope = (typeof searchScopes)[number];
const scopeOptions = searchScopes.map(id => ({ id, label: id === '全部' ? '全部类型' : id }));
const groupIcons = { 资料: NoteIcon, 标签: TagIcon, 动作: ArrowUpRightIcon };
const placeholders = {
  全部: '搜索工作区…',
  资料: '搜索资料标题或正文…',
  标签: '搜索标签名称…',
  动作: '搜索可执行的动作…'
};

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
  placeholder
}: SearchCommandProps) {
  const [query, setQuery] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const [scope, setScope] = useState<SearchScope>('全部');
  const includeNotes = scope === '全部' || scope === '资料';
  const spaceId = commandSearch?.spaceId ?? null;
  const bodySearch = useCommandNoteSearch({
    isOpen,
    isComposing,
    query,
    spaceId,
    search: includeNotes ? commandSearch?.search : undefined,
    scopeKey: commandSearch?.scopeKey
  });
  const selectionScope = useMemo(
    () => ({
      scope,
      query,
      spaceId,
      isOpen,
      isComposing,
      search: commandSearch?.search,
      scopeKey: commandSearch?.scopeKey,
      hits: bodySearch.hits
    }),
    [scope, query, spaceId, isOpen, isComposing, commandSearch?.search, commandSearch?.scopeKey, bodySearch.hits]
  );
  const opening = useCommandSelection(selectionScope, () => onOpenChange(false));
  const [selection, setSelection] = useState({ scope: selectionScope, index: 0 });
  const activeIndex = selection.scope === selectionScope ? selection.index : 0;
  const setActiveIndex = useCallback(
    (index: number) => setSelection({ scope: selectionScope, index }),
    [selectionScope]
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const pending = Boolean(isLoading) || bodySearch.state === 'loading' || isComposing || opening.pending;
  const selectable = isOpen && !pending && bodySearch.state !== 'error';

  // 每次打开清空 query 并聚焦。
  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setIsComposing(false);
      setScope('全部');
      return;
    }
    const handle = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(handle);
  }, [isOpen]);

  const matches = useMemo(() => {
    if (!isOpen) return [];
    const scopedHits = scope === '全部' ? hits : hits.filter(hit => hit.group === scope);
    if (!query.trim()) return scopedHits;
    const needle = query.trim().toLowerCase();
    const localHits = scopedHits.filter(hit => {
      const haystack = `${hit.primary} ${hit.secondary ?? ''}`.toLowerCase();
      return haystack.includes(needle);
    });
    const remoteHits = new Map(bodySearch.hits.map(note => [`note:${note.id}`, note]));
    const merged = localHits.map(hit =>
      remoteHits.has(hit.id) ? { ...hit, secondary: remoteHits.get(hit.id)!.snippet, isSnippet: true } : hit
    );
    const localIds = new Set(localHits.map(hit => hit.id));
    // 正文已由服务端匹配，不能再次用标题过滤丢弃。
    for (const [id, note] of remoteHits) {
      if (localIds.has(id) || !commandSearch) continue;
      merged.push({
        id,
        primary: note.title || '（无标题）',
        secondary: note.snippet,
        isSnippet: true,
        hint: '资料',
        group: '资料',
        onSelect: context => commandSearch.onSelect(note, context)
      });
    }
    return merged;
  }, [hits, scope, query, isOpen, bodySearch.hits, commandSearch]);

  const filtered = useMemo(
    () =>
      scope === '全部' ? searchScopes.slice(1).flatMap(group => matches.filter(hit => hit.group === group)) : matches,
    [matches, scope]
  );

  // 当过滤结果变化时，保证 activeIndex 不越界。
  useEffect(() => {
    const boundedIndex = Math.min(activeIndex, Math.max(0, filtered.length - 1));
    if (boundedIndex !== activeIndex) setActiveIndex(boundedIndex);
  }, [filtered, activeIndex, setActiveIndex]);

  const handleOpenChange = (open: boolean) => {
    if (!open) opening.cancel();
    onOpenChange(open);
  };

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
      placement="top"
      isOpen={isOpen}
      onOpenChange={handleOpenChange}
      size="md"
      headerContent={
        <div className={styles.searchLine}>
          <SearchBox
            size="palette"
            label="搜索关键字"
            icon={<SearchIcon size={21} />}
            ref={inputRef}
            type="text"
            name="global-search"
            autoComplete="off"
            value={query}
            maxLength={COMMAND_SEARCH_QUERY_LIMIT}
            placeholder={placeholder ?? placeholders[scope]}
            onChange={event => {
              opening.cancel();
              setQuery(event.target.value);
            }}
            onKeyDown={handleKey}
            onCompositionStart={() => {
              opening.cancel();
              setIsComposing(true);
            }}
            onCompositionEnd={event => {
              setQuery(event.currentTarget.value);
              setIsComposing(false);
            }}
            aria-controls="search-command-options"
            aria-activedescendant={activeHit ? `search-hit-${activeHit.id}` : undefined}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={isOpen}
            onClear={
              query
                ? () => {
                    opening.cancel();
                    setQuery('');
                    setIsComposing(false);
                    inputRef.current?.focus();
                  }
                : undefined
            }
            clearLabel="清除搜索关键字"
          />
          <Select
            label="搜索范围"
            presentation="toolbar"
            className={styles.scope}
            options={scopeOptions}
            selectedKey={scope}
            onSelectionChange={key => {
              const nextScope = searchScopes.find(item => item === key);
              if (!nextScope) return;
              opening.cancel();
              setScope(nextScope);
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
          />
        </div>
      }
    >
      <DialogBody>
        <div id="search-command-results" className={styles.hitList} aria-busy={pending ? 'true' : undefined}>
          {opening.error ? (
            <div role="alert">
              <EmptyState title="打开笔记失败" description={opening.error} />
            </div>
          ) : null}
          <SearchResults
            hits={selectable ? filtered : []}
            query={query.trim()}
            scope={scope}
            activeIndex={activeIndex}
            onActiveChange={setActiveIndex}
            onSelect={hit => {
              if (!selectable || !filtered.includes(hit)) return;
              opening.select(hit.onSelect);
            }}
          />
          {pending ? (
            <LoadingState label={opening.pending ? '正在载入笔记…' : isComposing ? '输入完成后搜索…' : '正在搜索…'} />
          ) : bodySearch.state === 'error' ? (
            <div role="alert">
              <EmptyState title="正文搜索失败" description={bodySearch.error ?? '请重新输入关键字重试。'} />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<SearchIcon size={24} />}
              title={
                query.trim() ? `没有匹配「${query.trim()}」的结果` : `暂无${scope === '全部' ? '可搜索的内容' : scope}`
              }
              description={
                scope !== '全部'
                  ? '切换到「全部」可查看其他类型的结果。'
                  : query.trim()
                    ? '试试更短的关键词或其他名称。'
                    : undefined
              }
            />
          ) : null}
        </div>
      </DialogBody>
      <DialogFooter>
        <div className={styles.footer}>
          <span role="status">{selectable ? `${filtered.length} 项结果` : ''}</span>
          <span className={styles.shortcuts} aria-hidden="true">
            ↑ ↓ 选择<span>↵ 打开</span>
          </span>
        </div>
      </DialogFooter>
    </Dialog>
  );
}

interface SearchResultsProps {
  query: string;
  scope: SearchScope;
  hits: SearchHit[];
  activeIndex: number;
  onActiveChange(index: number): void;
  onSelect(hit: SearchHit): void;
}

function SearchResults({ hits, query, scope, activeIndex, onActiveChange, onSelect }: SearchResultsProps) {
  const matchPattern = useMemo(
    () => (query ? new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi') : null),
    [query]
  );
  const activeRef = useRef<HTMLLIElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const list = listRef.current;
    const scrollport = list?.parentElement;
    const active = activeRef.current;
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
    <ul ref={listRef} className={styles.resultList} role="listbox" aria-label="搜索结果" id="search-command-options">
      {hits.map((hit, index) => {
        const Icon = groupIcons[hit.group];
        const isActive = index === activeIndex;
        return (
          <Fragment key={hit.id}>
            {scope === '全部' && hits[index - 1]?.group !== hit.group && (
              <li role="presentation" aria-hidden="true" className={styles.sectionLabel}>
                {hit.group === '动作' ? '快捷动作' : hit.group}
              </li>
            )}
            <ListBoxOption
              ref={isActive ? activeRef : undefined}
              selected={isActive}
              id={`search-hit-${hit.id}`}
              aria-label={[hit.primary, hit.secondary, hit.group].filter(Boolean).join('，')}
              className={styles.hit}
              onMouseEnter={() => onActiveChange(index)}
              onClick={() => onSelect(hit)}
            >
              <span className={styles.hitIcon} aria-hidden="true">
                <Icon size={18} />
              </span>
              <span className={cx(styles.hitBody, hit.isSnippet && styles.withSnippet)}>
                <span className={styles.hitPrimary}>
                  <MatchText text={hit.primary} pattern={matchPattern} />
                </span>
                {hit.secondary && (hit.group === '资料' || query) ? (
                  <span className={styles.hitSecondary}>
                    <MatchText text={hit.secondary} pattern={matchPattern} />
                  </span>
                ) : null}
              </span>
              {isActive && (
                <span className={styles.returnKey} aria-hidden="true">
                  ↵
                </span>
              )}
            </ListBoxOption>
          </Fragment>
        );
      })}
    </ul>
  );
}

/** 仅标记普通文本，公式交给原有的数学排版组件完整渲染。 */
function MatchText({ text, pattern }: { text: string; pattern: RegExp | null }) {
  if (!pattern || hasMath(text)) return <MathText text={text} inlineOnly />;
  const parts = text.split(pattern);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 ? (
          <mark key={index} className={styles.match}>
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  );
}
