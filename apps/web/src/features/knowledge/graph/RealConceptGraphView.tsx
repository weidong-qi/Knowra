import { useEffect, useMemo, useState } from 'react';
import type { KnowledgeItem } from '@study-accelerator/web-core';
import {
  Button,
  Checkbox,
  IconButton,
  LoadingState,
  Menu,
  MenuItem,
  MenuPopover,
  MenuTrigger,
  SearchBox
} from '../../../components/ui';
import { KnowledgeIcon, PanelIcon, SearchIcon } from '../../../components/icons/knowra';
import { LibraryIndexHeader, LibraryInspector } from '../../../components/workspace/LibraryIndex';
import { useLibraryInspector } from '../../../components/workspace/useLibraryInspector';
import { WorkspacePanel, WorkspacePanelBody, WorkspacePanelFooter } from '../../../components/workspace/WorkspacePanel';
import { PathTrail } from '../../../shell/PathTrail';
import { useNavigate } from '../../../app/router';
import { notesIndexAppearanceProps } from '../../notes/NotesIndexAppearance';
import { useNotesIndexAppearance } from '../../notes/notesIndexAppearanceModel';
import { useKnowledgeLibraryData } from '../library/KnowledgeLibraryProvider';
import { sharedConceptStore, useConceptState } from '../concepts/conceptStore';
import { ConceptGraphCanvas } from './ConceptGraphCanvas';
import { ConceptGraphInspector } from './ConceptGraphInspector';
import { realConceptGraph } from './realConceptGraphModel';
import indexStyles from '../KnowledgeIndex.module.css';
import styles from './RealConceptGraph.module.css';
export { ConceptGraphCanvas } from './ConceptGraphCanvas';
export type GraphExperimentTool = 'import' | 'confirmation' | 'review';

export function RealConceptGraphView({
  query,
  onQueryChange,
  selectedId,
  onSelect,
  onOpenConcept,
  onOpenItem,
  onOpenExperiment,
  onListItems,
  refreshKey,
  canWrite = true,
  selectedEdgeId: routeEdge,
  onSelectEdge,
  includeMuted: routeMuted,
  includeProjections: routeProjections,
  onFiltersChange
}: {
  query: string;
  onQueryChange(query: string): void;
  selectedId: string | null;
  onSelect(id: string | null): void;
  onOpenConcept(id: string): void;
  onOpenItem(id: string): void;
  onOpenExperiment(tool?: GraphExperimentTool): void;
  onListItems(): Promise<KnowledgeItem[]>;
  refreshKey?: number;
  canWrite?: boolean;
  selectedEdgeId?: string | null;
  onSelectEdge?(id: string | null): void;
  includeMuted?: boolean;
  includeProjections?: boolean;
  onFiltersChange?(filters: { includeMuted: boolean; includeProjections: boolean }): void;
}) {
  const navigate = useNavigate();
  const appearance = useNotesIndexAppearance();
  const theme = notesIndexAppearanceProps(appearance);
  const store = sharedConceptStore();
  const state = useConceptState(store);
  const data = useKnowledgeLibraryData();
  const [localItems, setLocalItems] = useState<KnowledgeItem[]>([]);
  const [ready, setReady] = useState(false);
  const [itemError, setItemError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [localMuted, setIncludeMuted] = useState(false);
  const includeMuted = routeMuted ?? localMuted;
  const [localProjections, setIncludeProjections] = useState(true);
  const includeProjections = routeProjections ?? localProjections;
  const [localEdge, setSelectedEdge] = useState<string | null>(null);
  const selectedEdge = routeEdge === undefined ? localEdge : routeEdge;
  const [inspectorOpen, setInspectorOpen] = useLibraryInspector(
    'knowra:concept-graph-inspector-open',
    selectedId ?? selectedEdge
  );
  useEffect(() => {
    let active = true;
    setReady(false);
    setItemError('');
    if (!data.cache || store.getState().status === 'idle') void store.load();
    void onListItems()
      .then(items => {
        if (active) {
          setLocalItems(items);
          setReady(true);
        }
      })
      .catch(error => {
        if (active) setItemError(error instanceof Error ? error.message : '知识点加载失败');
      });
    return () => {
      active = false;
    };
  }, [store, data.cache, onListItems, refreshKey, refresh]);
  const items = data.cache ? data.items : localItems;
  const loaded = ready && (!data.cache || data.status === 'ready') && state.status === 'ready';
  const graph = useMemo(
    () => realConceptGraph(state, items, { query, includeMuted, includeProjections }),
    [state, items, query, includeMuted, includeProjections]
  );
  const node = graph.nodes.find(row => row.id === selectedId);
  const edge = graph.edges.find(row => row.id === selectedEdge);
  const names = new Map(graph.nodes.map(row => [row.id, `${row.label}${row.sense ? ` · ${row.sense}` : ''}`]));
  const select = (id: string) => {
    setSelectedEdge(null);
    setInspectorOpen(true);
    onSelect(id);
  };
  const selectEdge = (id: string) => {
    if (onSelectEdge) onSelectEdge(id);
    else setSelectedEdge(id);
    setInspectorOpen(true);
  };
  const reload = () => {
    data.cache?.invalidate();
    void store.load();
    setRefresh(value => value + 1);
  };
  const error = state.error || itemError || data.error;
  return (
    <WorkspacePanel
      as="main"
      {...theme}
      className={`${theme.className} ${indexStyles.panel}`}
      aria-label="概念图工作区"
    >
      <LibraryIndexHeader
        title="概念图"
        count={graph.nodes.length}
        icon={<KnowledgeIcon size={17} />}
        breadcrumb={
          <PathTrail
            variant="top"
            path={[
              { id: 'knowledge', label: '知识库', onNavigate: () => navigate('/knowledge') },
              { id: 'graph', label: '概念图', current: true }
            ]}
          />
        }
      >
        <div className={styles.headerTools} role="toolbar" aria-label="概念图工具栏">
          <SearchBox
            icon={<SearchIcon size={15} />}
            label="搜索图中概念"
            placeholder="名称、区分标签或别名"
            value={query}
            onChange={event => onQueryChange(event.target.value)}
            onClear={query ? () => onQueryChange('') : undefined}
          />
          <IconButton
            aria-label="切换图谱详情"
            aria-pressed={inspectorOpen}
            onPress={() => setInspectorOpen(value => !value)}
          >
            <PanelIcon size={16} />
          </IconButton>
          <Button size="compact" variant="ghost" onPress={reload}>
            刷新
          </Button>
          <MenuTrigger>
            <Button size="compact" variant="ghost">
              实验
            </Button>
            <MenuPopover>
              <Menu ariaLabel="概念图实验" onAction={key => onOpenExperiment(String(key) as GraphExperimentTool)}>
                <MenuItem id="import">导入实验结果</MenuItem>
                <MenuItem id="confirmation">增量确认演示</MenuItem>
                <MenuItem id="review">离线报告审阅</MenuItem>
              </Menu>
            </MenuPopover>
          </MenuTrigger>
        </div>
      </LibraryIndexHeader>
      <WorkspacePanelBody className={indexStyles.content}>
        {!canWrite ? (
          <p className={styles.notice} role="note">
            当前资料库为只读模式，可以浏览概念图。
          </p>
        ) : null}
        <div className={indexStyles.indexWrap}>
          <section className={indexStyles.indexMain} aria-label="真实概念图">
            <div className={styles.body}>
              <div className={styles.tools}>
                <Checkbox
                  isSelected={includeMuted}
                  onChange={includeMuted =>
                    onFiltersChange
                      ? onFiltersChange({ includeMuted, includeProjections })
                      : setIncludeMuted(includeMuted)
                  }
                >
                  显示不关注概念
                </Checkbox>
                <Checkbox
                  isSelected={includeProjections}
                  onChange={includeProjections =>
                    onFiltersChange
                      ? onFiltersChange({ includeMuted, includeProjections })
                      : setIncludeProjections(includeProjections)
                  }
                >
                  显示条目投影候选
                </Checkbox>
              </div>
              <p className={styles.hint}>
                实线：已确认关系；虚线：主体→提及的待定类型提示，选择类型后才会保存。掌握状态均为未评估。
              </p>
              {error ? (
                <div role="alert" className={styles.notice}>
                  <span>{state.unavailable ? '当前资料库暂不支持概念，请升级云端与 Mac 应用。' : error}</span>
                  <Button size="compact" variant="ghost" onPress={reload}>
                    重新加载概念图
                  </Button>
                </div>
              ) : null}
              {!loaded && !error ? <LoadingState label="正在加载真实概念与知识点…" /> : null}
              {loaded ? (
                <>
                  <p role="status">
                    {graph.nodes.length} 个概念 · {graph.edges.filter(row => row.kind === 'relation').length} 条正式关系
                    · {graph.edges.filter(row => row.kind === 'projection').length} 条投影候选
                  </p>
                  {graph.nodes.length ? (
                    <ConceptGraphCanvas
                      graph={graph}
                      selectedId={node?.id ?? null}
                      selectedEdgeId={edge?.id ?? null}
                      themeKey={JSON.stringify(appearance)}
                      onSelect={select}
                      onEdge={selectEdge}
                    />
                  ) : (
                    <div className={indexStyles.empty}>
                      <strong>没有符合条件的概念</strong>
                      <p>调整搜索或筛选，或在概念页创建概念并关联知识点。</p>
                      <Button size="compact" onPress={() => navigate('/knowledge/concepts')}>
                        查看全部概念
                      </Button>
                    </div>
                  )}
                  {selectedId && !node ? (
                    <p className={styles.hint}>所选概念已归档、删除或被筛选隐藏，可以调整筛选或返回概念详情查看。</p>
                  ) : null}
                  {selectedEdge && !edge ? (
                    <p className={styles.hint}>所选关系已隐藏或不可用，请调整筛选或返回概念详情查看。</p>
                  ) : null}
                  <section aria-label="概念与关系的可访问列表">
                    <h3>概念</h3>
                    <ul className={styles.list}>
                      {graph.nodes.map(row => (
                        <li key={row.id}>
                          <Button
                            size="compact"
                            variant="ghost"
                            aria-pressed={row.id === selectedId}
                            onPress={() => select(row.id)}
                          >
                            {row.label}
                            {row.sense ? `（${row.sense}）` : ''} · 未评估
                          </Button>
                        </li>
                      ))}
                    </ul>
                    <h3>关系</h3>
                    {graph.edges.length ? (
                      <ul className={styles.list}>
                        {graph.edges.map(row => (
                          <li key={row.id}>
                            <Button size="compact" variant="ghost" onPress={() => selectEdge(row.id)}>
                              {names.get(row.source)} {row.directed ? '→' : '↔'} {names.get(row.target)} · {row.label}
                            </Button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className={styles.hint}>还没有关系。可以在概念详情中手工建立，或确认条目投影。</p>
                    )}
                  </section>
                </>
              ) : null}
            </div>
          </section>
          <LibraryInspector
            isOpen={inspectorOpen}
            label="图谱检查器"
            onClose={() => {
              setInspectorOpen(false);
              setSelectedEdge(null);
              if (onSelectEdge) onSelectEdge(null);
              else if (selectedId) onSelect(null);
            }}
          >
            <ConceptGraphInspector
              node={node}
              edge={edge}
              graph={graph}
              state={state}
              items={items}
              onOpenConcept={onOpenConcept}
              onOpenItem={onOpenItem}
            />
          </LibraryInspector>
        </div>
      </WorkspacePanelBody>
      <WorkspacePanelFooter className={indexStyles.footer}>
        <span>
          {graph.nodes.length} 个概念 · {graph.edges.length} 条连线
        </span>
        <span>基于当前知识库 · 未评估掌握度</span>
      </WorkspacePanelFooter>
    </WorkspacePanel>
  );
}
