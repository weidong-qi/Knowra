import { useEffect, useMemo, useRef, useState } from 'react';
import type { KnowledgeItem } from '@study-accelerator/web-core';
import { Button, Checkbox, LoadingState, SearchBox } from '../../../components/ui';
import { LibraryIndexHeader } from '../../../components/workspace/LibraryIndex';
import { WorkspacePanel, WorkspacePanelBody } from '../../../components/workspace/WorkspacePanel';
import { useKnowledgeLibraryData } from '../library/KnowledgeLibraryProvider';
import { sharedConceptStore, useConceptState } from '../concepts/conceptStore';
import { createGraphRenderer, type GraphRenderer } from './cytoscapeAdapter';
import { realConceptGraph, type RealConceptGraph } from './realConceptGraphModel';
import styles from './RealConceptGraph.module.css';

export function ConceptGraphCanvas({
  graph,
  selectedId,
  onSelect,
  onEdge
}: {
  graph: RealConceptGraph;
  selectedId: string | null;
  onSelect(id: string): void;
  onEdge(id: string): void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const renderer = useRef<GraphRenderer | null>(null);
  const callbacks = useRef({ onSelect, onEdge });
  const [error, setError] = useState('');
  useEffect(() => {
    callbacks.current = { onSelect, onEdge };
  }, [onSelect, onEdge]);
  useEffect(() => {
    if (!container.current) return;
    let instance: GraphRenderer | null = null;
    try {
      instance = createGraphRenderer(
        container.current,
        id => callbacks.current.onSelect(id),
        id => callbacks.current.onEdge(id)
      );
      renderer.current = instance;
    } catch {
      setError('图形渲染暂不可用，可以使用下方概念与关系列表。');
    }
    const resize = () => instance?.resize();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    observer?.observe(container.current);
    window.addEventListener('resize', resize);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', resize);
      instance?.destroy();
      renderer.current = null;
    };
  }, []);
  useEffect(() => {
    try {
      renderer.current?.update(graph);
      renderer.current?.select(selectedId);
    } catch {
      setError('图形更新失败，可以使用下方列表继续浏览。');
    }
  }, [graph, selectedId]);
  return (
    <>
      <div className={styles.tools} aria-label="图形控制">
        <Button size="compact" onPress={() => renderer.current?.fit()}>
          适应画布
        </Button>
        <Button size="compact" onPress={() => renderer.current?.zoom(1.25)}>
          放大
        </Button>
        <Button size="compact" onPress={() => renderer.current?.zoom(0.8)}>
          缩小
        </Button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      <div
        ref={container}
        className={styles.canvas}
        role="img"
        aria-label="概念关系图。下方提供可键盘操作的等价列表。"
      />
    </>
  );
}

export function RealConceptGraphView({
  query,
  onQueryChange,
  selectedId,
  onSelect,
  onOpenConcept,
  onOpenItem,
  onOpenExperiment,
  onListItems,
  refreshKey
}: {
  query: string;
  onQueryChange(query: string): void;
  selectedId: string | null;
  onSelect(id: string): void;
  onOpenConcept(id: string): void;
  onOpenItem(id: string): void;
  onOpenExperiment(): void;
  onListItems(): Promise<KnowledgeItem[]>;
  refreshKey?: number;
}) {
  const store = sharedConceptStore();
  const state = useConceptState(store);
  const data = useKnowledgeLibraryData();
  const [localItems, setLocalItems] = useState<KnowledgeItem[]>([]);
  const [ready, setReady] = useState(false);
  const [itemError, setItemError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [includeMuted, setIncludeMuted] = useState(false);
  const [includeProjections, setIncludeProjections] = useState(true);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setReady(false);
    setItemError('');
    void store.load();
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
  }, [store, onListItems, refreshKey, refresh]);
  const items = data.cache ? data.items : localItems;
  const loaded = ready && (!data.cache || data.status === 'ready') && state.status === 'ready';
  const graph = useMemo(
    () => realConceptGraph(state, items, { query, includeMuted, includeProjections }),
    [state, items, query, includeMuted, includeProjections]
  );
  const node = graph.nodes.find(row => row.id === selectedId);
  const edge = graph.edges.find(row => row.id === selectedEdge);
  const select = (id: string) => {
    setSelectedEdge(null);
    onSelect(id);
  };
  const names = new Map(graph.nodes.map(row => [row.id, row.label]));
  return (
    <WorkspacePanel as="main" aria-label="概念图工作区">
      <LibraryIndexHeader title="概念图" icon={null} breadcrumb={<span>知识库 / 概念图</span>}>
        <Button
          variant="ghost"
          size="compact"
          onPress={() => {
            data.cache?.invalidate();
            setRefresh(value => value + 1);
          }}
        >
          刷新
        </Button>
        <Button variant="ghost" size="compact" onPress={onOpenExperiment}>
          实验入口
        </Button>
      </LibraryIndexHeader>
      <WorkspacePanelBody className={styles.body}>
        <div className={styles.tools}>
          <SearchBox
            label="搜索图中概念"
            value={query}
            onChange={event => onQueryChange(event.target.value)}
            onClear={() => onQueryChange('')}
          />
          <Checkbox isSelected={includeMuted} onChange={setIncludeMuted}>
            显示不关注概念
          </Checkbox>
          <Checkbox isSelected={includeProjections} onChange={setIncludeProjections}>
            显示条目投影候选
          </Checkbox>
        </div>
        <p className={styles.hint}>
          实线：已确认关系；虚线：主体→提及的条目投影，仅为候选，尚未保存。所有概念掌握状态均为未评估。
        </p>
        {state.error || itemError || data.error ? <p role="alert">{state.error || itemError || data.error}</p> : null}
        {!loaded && !state.error && !itemError && !data.error ? (
          <LoadingState label="正在加载真实概念与知识点…" />
        ) : null}
        {loaded ? (
          <>
            <p role="status">
              {graph.nodes.length} 个概念 · {graph.edges.filter(row => row.kind === 'relation').length} 条正式关系 ·{' '}
              {graph.edges.filter(row => row.kind === 'projection').length} 条投影候选
            </p>
            {!graph.nodes.length ? (
              <p>没有符合条件的概念。请调整筛选，或在概念页创建概念并关联知识点。</p>
            ) : (
              <ConceptGraphCanvas
                graph={graph}
                selectedId={node?.id ?? null}
                onSelect={select}
                onEdge={setSelectedEdge}
              />
            )}
            {selectedId && !node ? (
              <p role="status">所选概念已隐藏或不可用，请调整搜索或开启“显示不关注概念”。</p>
            ) : null}
            {node ? (
              <section className={styles.detail} aria-label="所选概念">
                <strong>{node.label}</strong>
                <span>{node.sense}</span>
                <span>掌握状态：未评估</span>
                <Button size="compact" onPress={() => onOpenConcept(node.id)}>
                  打开概念详情与关系
                </Button>
              </section>
            ) : null}
            {edge ? (
              <section className={styles.detail} aria-label="所选关系">
                <strong>
                  {names.get(edge.source)} → {names.get(edge.target)} · {edge.label}
                </strong>
                <Button size="compact" onPress={() => onOpenConcept(edge.source)}>
                  {edge.kind === 'projection' ? '前往概念详情确认候选' : '前往概念详情管理关系'}
                </Button>
                {edge.basisItemId ? (
                  <Button size="compact" onPress={() => onOpenItem(edge.basisItemId!)}>
                    查看依据知识点
                  </Button>
                ) : (
                  <span>手工骨架关系，未指定依据知识点。</span>
                )}
              </section>
            ) : null}
            <section aria-label="概念与关系的可访问列表">
              <h3>概念</h3>
              <ul className={styles.list}>
                {graph.nodes.map(row => (
                  <li key={row.id}>
                    <Button size="compact" aria-pressed={row.id === selectedId} onPress={() => select(row.id)}>
                      {row.label}
                      {row.sense ? `（${row.sense}）` : ''} · 未评估
                    </Button>
                  </li>
                ))}
              </ul>
              <h3>关系</h3>
              <ul>
                {graph.edges.map(row => (
                  <li key={row.id}>
                    <Button variant="ghost" size="compact" onPress={() => setSelectedEdge(row.id)}>
                      {names.get(row.source)} {row.directed ? '→' : '↔'} {names.get(row.target)} · {row.label}
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          </>
        ) : null}
      </WorkspacePanelBody>
    </WorkspacePanel>
  );
}
