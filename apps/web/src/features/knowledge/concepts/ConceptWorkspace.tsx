import { useEffect, useMemo, useState } from 'react';
import {
  conceptItemLinks,
  searchConcepts,
  type ConceptCommand,
  type KnowledgeConcept,
  type KnowledgeItem
} from '@study-accelerator/web-core';
import { Button, EmptyArt, LoadingState, PressableButton } from '../../../components/ui';
import { KnowledgeIcon } from '../../../components/icons/knowra';
import { useLibraryInspector } from '../../../components/workspace/useLibraryInspector';
import { LibraryIndexHeader, LibraryInspector } from '../../../components/workspace/LibraryIndex';
import { WorkspacePanel, WorkspacePanelBody, WorkspacePanelFooter } from '../../../components/workspace/WorkspacePanel';
import { PathTrail } from '../../../shell/PathTrail';
import { useNavigate } from '../../../app/router';
import { randomId } from '../../../browser/randomId';
import { notesIndexAppearanceProps } from '../../notes/NotesIndexAppearance';
import { useNotesIndexAppearance } from '../../notes/notesIndexAppearanceModel';
import { formatUpdatedAt } from '../../notes/notesIndexModel';
import { useKnowledgeLibraryData } from '../library/KnowledgeLibraryProvider';
import { CONCEPT_SCOPES } from '../library/knowledgeLibraryRoute';
import { handleKnowledgeListKeys } from '../KnowledgeIndexItems';
import { ConceptActionDialog } from './ConceptActionDialog';
import { ConceptDetail } from './ConceptDetail';
import { sharedConceptStore, useConceptState } from './conceptStore';
import { ConceptEditor } from './ConceptEditor';
import { LinkItemsDialog, RemoveLinksDialog } from './ConceptLinkDialogs';
import { ConceptIndexTools } from './ConceptIndexTools';
import { useConceptDisplay } from './conceptIndexModel';
import indexStyles from '../KnowledgeIndex.module.css';
import styles from './Concepts.module.css';
export interface ConceptWorkspaceProps {
  selectedId: string | null;
  canWrite: boolean;
  refreshKey?: number;
  scope?: string;
  query?: string;
  onScopeChange?(value: string): void;
  onQueryChange?(value: string): void;
  onResetFilters?(): void;
  onCreatedConcept?(id: string): void;
  onSelect(id: string | null): void;
  onOpenItem(id: string): void;
  onListItems(): Promise<KnowledgeItem[]>;
}
export function ConceptWorkspace({
  selectedId,
  canWrite,
  refreshKey,
  scope: routeScope,
  query: routeQuery,
  onScopeChange,
  onQueryChange,
  onResetFilters,
  onCreatedConcept,
  onSelect,
  onOpenItem,
  onListItems
}: ConceptWorkspaceProps) {
  const store = sharedConceptStore();
  const state = useConceptState(store);
  const data = useKnowledgeLibraryData();
  const cache = data.cache;
  const theme = notesIndexAppearanceProps(useNotesIndexAppearance());
  const navigate = useNavigate();
  const display = useConceptDisplay();
  const [localItems, setItems] = useState<KnowledgeItem[]>([]);
  const [itemError, setItemError] = useState('');
  const [localItemsReady, setItemsReady] = useState(false);
  const items = cache ? data.items : localItems;
  const itemsReady = localItemsReady && (!cache || data.status === 'ready');
  const [refresh, setRefresh] = useState(0);
  const [localQuery, setQuery] = useState('');
  const [localScope, setScope] = useState('all');
  const query = routeQuery ?? localQuery;
  const scope = routeScope ?? localScope;
  const changeQuery = onQueryChange ?? setQuery;
  const changeScope = onScopeChange ?? setScope;
  const [inspectorOpen, setInspectorOpen] = useLibraryInspector('knowra:concept-inspector-open', selectedId);
  const [editor, setEditor] = useState<KnowledgeConcept | 'new' | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [removal, setRemoval] = useState<{ ids: string[]; move: boolean } | null>(null);
  const [action, setAction] = useState<'merge' | 'delete' | null>(null);
  useEffect(() => {
    if (!cache) void store.load();
  }, [cache, store, refreshKey]);
  useEffect(() => {
    let active = true;
    setItemsReady(false);
    setItemError('');
    void onListItems()
      .then(rows => {
        if (active) {
          setItems(rows);
          setItemsReady(true);
        }
      })
      .catch(error => {
        if (active) setItemError(error instanceof Error ? error.message : '知识点加载失败');
      });
    return () => {
      active = false;
    };
  }, [onListItems, refreshKey, refresh]);
  useEffect(() => {
    if (selectedId) setInspectorOpen(true);
    setAction(null);
    setLinkOpen(false);
    setRemoval(null);
  }, [selectedId, setInspectorOpen]);
  const write = canWrite && state.status === 'ready' && !state.unavailable && itemsReady;
  const concept = state.concepts.find(row => row.id === selectedId && !row.deletedAt);
  const itemsById = useMemo(() => new Map(items.map(item => [item.id, item])), [items]);
  const allLinks = useMemo(() => conceptItemLinks(state, items), [state, items]);
  const links = allLinks.filter(row => row.conceptId === selectedId);
  const countsById = useMemo(() => {
    const result = new Map<string, { subject: number; mentions: number }>();
    for (const link of allLinks) {
      const count = result.get(link.conceptId) ?? { subject: 0, mentions: 0 };
      count[link.role] += 1;
      result.set(link.conceptId, count);
    }
    return result;
  }, [allLinks]);
  const candidates = searchConcepts(state, query)
    .filter(row =>
      scope === 'archived'
        ? row.reviewStatus === 'archived'
        : row.reviewStatus !== 'archived' && (scope === 'all' || row.focus === scope)
    )
    .sort((a, b) =>
      display.sort === 'name-asc'
        ? a.name.localeCompare(b.name, 'zh-CN')
        : (display.sort === 'updated-asc'
            ? a.updatedAt.localeCompare(b.updatedAt)
            : b.updatedAt.localeCompare(a.updatedAt)) || a.name.localeCompare(b.name, 'zh-CN')
    );
  const counts = Object.fromEntries(
    CONCEPT_SCOPES.map(([key]) => [
      key,
      state.concepts.filter(
        row =>
          !row.deletedAt &&
          (key === 'archived'
            ? row.reviewStatus === 'archived'
            : row.reviewStatus !== 'archived' && (key === 'all' || row.focus === key))
      ).length
    ])
  );
  const run = async (command: ConceptCommand) => {
    if (!write) return false;
    try {
      await store.execute(command);
      return true;
    } catch {
      return false;
    }
  };
  const base = (row: KnowledgeConcept) => ({ id: row.id, expectedRevision: row.revision, operationId: randomId() });
  const reload = () => {
    cache?.invalidate();
    void store.load();
    setRefresh(value => value + 1);
  };
  return (
    <WorkspacePanel
      as="main"
      {...theme}
      className={`${theme.className} ${indexStyles.panel}`}
      aria-label="概念工作区"
      onKeyDown={event => {
        if (
          event.key === '/' &&
          !event.ctrlKey &&
          !event.metaKey &&
          !(event.target as Element).closest(
            'input,textarea,select,[contenteditable="true"],[role="dialog"],[role="menu"]'
          )
        ) {
          event.preventDefault();
          event.currentTarget.querySelector<HTMLInputElement>('input[name],input[aria-label="搜索概念"]')?.focus();
        }
      }}
    >
      <LibraryIndexHeader
        title="概念"
        count={candidates.length}
        icon={<KnowledgeIcon size={17} />}
        breadcrumb={
          <PathTrail
            path={[
              { id: 'knowledge', label: '知识库', onNavigate: () => navigate('/knowledge') },
              { id: 'concepts', label: '概念', current: true }
            ]}
            variant="top"
          />
        }
      >
        <ConceptIndexTools
          query={query}
          onQueryChange={changeQuery}
          scope={scope}
          onScopeChange={changeScope}
          display={display}
          counts={counts}
          canWrite={write}
          busy={state.pending || !itemsReady}
          inspectorOpen={inspectorOpen}
          onToggleInspector={() => setInspectorOpen(value => !value)}
          onRefresh={reload}
          onCreate={() => setEditor('new')}
        />
      </LibraryIndexHeader>
      <WorkspacePanelBody className={indexStyles.content}>
        {!canWrite ? (
          <p className={styles.notice} role="status">
            当前资料库为只读模式，可以浏览概念，暂不能修改。
          </p>
        ) : null}
        {state.error || itemError ? (
          <div className={indexStyles.loadError} role="alert">
            <span>
              {state.unavailable ? '当前资料库暂不支持概念，请升级云端与 Mac 应用。' : state.error || itemError}
            </span>
            <Button variant="ghost" size="compact" onPress={reload}>
              重新加载概念
            </Button>
          </div>
        ) : null}
        {state.undo ? (
          <div className={styles.notice} role="status">
            <span>概念已删除，知识点正文保留。</span>
            {write ? (
              <Button
                size="compact"
                onPress={() => {
                  const undo = state.undo!;
                  void run({
                    type: 'undeleteConcept',
                    operationId: randomId(),
                    id: undo.id,
                    expectedRevision: undo.revision
                  }).then(saved => {
                    if (saved) {
                      store.dismissUndo();
                      onSelect(undo.id);
                    }
                  });
                }}
              >
                撤销删除
              </Button>
            ) : null}
            <Button size="compact" variant="ghost" onPress={() => store.dismissUndo()}>
              关闭提示
            </Button>
          </div>
        ) : null}
        <div className={indexStyles.indexWrap}>
          <section className={indexStyles.indexMain} aria-label="概念列表">
            <div
              className={indexStyles.listScroll}
              tabIndex={0}
              aria-label="概念列表内容"
              role="region"
              onKeyDown={handleKnowledgeListKeys}
            >
              {state.status === 'loading' || state.status === 'idle' ? <LoadingState label="正在加载概念…" /> : null}
              <ul
                className={display.view === 'card' ? indexStyles.cardGrid : indexStyles.rows}
                aria-label={display.view === 'card' ? '概念卡片视图' : '概念列表视图'}
              >
                {candidates.map(row => {
                  const count = countsById.get(row.id) ?? { subject: 0, mentions: 0 };
                  return (
                    <li key={row.id} data-entry-item>
                      <PressableButton
                        className={
                          display.view === 'card' ? `${indexStyles.card} ${styles.conceptCard}` : indexStyles.row
                        }
                        aria-current={row.id === selectedId ? 'true' : undefined}
                        onPress={() => onSelect(row.id)}
                      >
                        <span className={styles.conceptName}>
                          <strong>{row.name}</strong>
                          {display.properties.sense && row.sense ? <span>{row.sense}</span> : null}
                        </span>
                        {display.properties.counts ? (
                          <span className={styles.conceptCounts}>
                            主体 {count.subject} · 提及 {count.mentions}
                          </span>
                        ) : null}
                        {display.properties.status ? (
                          <span className={indexStyles.status} data-status={row.reviewStatus}>
                            <i aria-hidden="true" />
                            {row.reviewStatus === 'archived' ? '已归档' : row.focus === 'active' ? '关注' : '不关注'}
                          </span>
                        ) : null}
                        {display.properties.updated ? (
                          <small className={indexStyles.updated}>{formatUpdatedAt(row.updatedAt)}</small>
                        ) : null}
                      </PressableButton>
                    </li>
                  );
                })}
              </ul>
              {!candidates.length && state.status === 'ready' ? (
                <div className={indexStyles.empty}>
                  <EmptyArt variant={query ? 'search' : 'knowledge'} />
                  <strong>{query || scope !== 'all' ? '暂无符合条件的概念' : '还没有概念'}</strong>
                  <p>
                    {query || scope !== 'all'
                      ? '试试其他关键词或清除筛选。'
                      : '新建概念，再将已有知识点作为主体或提及挂入。'}
                  </p>
                  {query || scope !== 'all' ? (
                    <Button
                      variant="ghost"
                      onPress={() => {
                        if (onResetFilters) onResetFilters();
                        else {
                          changeQuery('');
                          changeScope('all');
                        }
                      }}
                    >
                      清除搜索与筛选
                    </Button>
                  ) : write ? (
                    <Button onPress={() => setEditor('new')}>新建概念</Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>
          {inspectorOpen ? (
            <LibraryInspector
              label="概念检查器"
              onClose={() => {
                setInspectorOpen(false);
                onSelect(null);
              }}
            >
              {concept ? (
                <ConceptDetail
                  key={concept.id}
                  concept={concept}
                  items={itemsById}
                  links={links}
                  write={write}
                  pending={state.pending}
                  onEdit={() => setEditor(concept)}
                  onAttach={() => setLinkOpen(true)}
                  onOpenItem={onOpenItem}
                  onAction={key => {
                    if (key === 'merge' || key === 'delete') setAction(key);
                    else if (key === 'focus')
                      void run({
                        ...base(concept),
                        type: 'updateConcept',
                        patch: { focus: concept.focus === 'active' ? 'muted' : 'active' }
                      });
                    else
                      void run({
                        ...base(concept),
                        type: concept.reviewStatus === 'archived' ? 'restoreConcept' : 'archiveConcept'
                      });
                  }}
                  onRole={link => {
                    void run({
                      ...base(concept),
                      type: 'setLinkRole',
                      linkIds: [link.id],
                      role: link.role === 'subject' ? 'mentions' : 'subject'
                    });
                  }}
                  onRemove={(ids, move) => setRemoval({ ids, move })}
                />
              ) : (
                <div className={indexStyles.empty}>
                  <KnowledgeIcon size={26} />
                  <strong>
                    {selectedId && state.status === 'ready' ? '此概念已删除或合并' : '选择一个概念以查看详情'}
                  </strong>
                  <p>这里会显示概念信息和挂靠知识点。</p>
                </div>
              )}
            </LibraryInspector>
          ) : null}
        </div>
      </WorkspacePanelBody>
      <WorkspacePanelFooter className={indexStyles.footer}>
        <span>
          显示 {candidates.length} / {state.concepts.filter(row => !row.deletedAt).length} 个概念
        </span>
        <span>主体：知识讲述它 · 提及：知识用到它</span>
      </WorkspacePanelFooter>
      {editor ? (
        <ConceptEditor
          key={editor === 'new' ? 'new' : editor.id}
          concept={editor === 'new' ? undefined : editor}
          canWrite={write}
          store={store}
          onClose={() => setEditor(null)}
          onSaved={id => (editor === 'new' && onCreatedConcept ? onCreatedConcept(id) : onSelect(id))}
        />
      ) : null}
      {concept && linkOpen ? (
        <LinkItemsDialog
          concept={concept}
          items={items}
          canWrite={write}
          store={store}
          onClose={() => setLinkOpen(false)}
        />
      ) : null}
      {concept && removal ? (
        <RemoveLinksDialog
          concept={concept}
          linkIds={removal.ids}
          move={removal.move}
          canWrite={write}
          store={store}
          onClose={() => setRemoval(null)}
        />
      ) : null}
      {concept && action ? (
        <ConceptActionDialog
          concept={concept}
          action={action}
          canWrite={write}
          store={store}
          onSelect={onSelect}
          onClose={() => setAction(null)}
        />
      ) : null}
    </WorkspacePanel>
  );
}
