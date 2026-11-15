import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../components/ui';
import type { GraphRenderer } from './cytoscapeAdapter';
import type { RealConceptGraph } from './realConceptGraphModel';
import styles from './RealConceptGraph.module.css';

export function ConceptGraphCanvas({
  graph,
  selectedId,
  selectedEdgeId = null,
  themeKey = '',
  onSelect,
  onEdge
}: {
  graph: RealConceptGraph;
  selectedId: string | null;
  selectedEdgeId?: string | null;
  themeKey?: string;
  onSelect(id: string): void;
  onEdge(id: string): void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const renderer = useRef<GraphRenderer | null>(null);
  const latest = useRef({ graph, selectedId, selectedEdgeId, onSelect, onEdge });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    latest.current = { graph, selectedId, selectedEdgeId, onSelect, onEdge };
  }, [graph, selectedId, selectedEdgeId, onSelect, onEdge]);
  useEffect(() => {
    let active = true;
    let instance: GraphRenderer | null = null;
    // 渲染库只在进入真实图时下载；卸载后的迟到加载不能创建残留画布。
    void import('./cytoscapeAdapter')
      .then(({ createGraphRenderer }) => {
        if (!active || !container.current) return;
        instance = createGraphRenderer(
          container.current,
          id => latest.current.onSelect(id),
          id => latest.current.onEdge(id)
        );
        renderer.current = instance;
        instance.update(latest.current.graph);
        instance.select(latest.current.selectedId, latest.current.selectedEdgeId);
        setReady(true);
      })
      .catch(() => {
        if (active) setError('图形渲染暂不可用，可以使用下方概念与关系列表。');
      });
    const resize = () => instance?.resize();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    if (container.current) observer?.observe(container.current);
    window.addEventListener('resize', resize);
    return () => {
      active = false;
      observer?.disconnect();
      window.removeEventListener('resize', resize);
      instance?.destroy();
      renderer.current = null;
    };
  }, []);
  useEffect(() => {
    try {
      renderer.current?.update(graph);
      renderer.current?.select(selectedId, selectedEdgeId);
    } catch {
      setError('图形更新失败，可以使用下方列表继续浏览。');
    }
  }, [graph, selectedId, selectedEdgeId, themeKey]);
  return (
    <>
      <div className={styles.tools} aria-label="图形控制">
        <Button size="compact" isDisabled={!ready} onPress={() => renderer.current?.fit()}>
          适应画布
        </Button>
        <Button size="compact" isDisabled={!ready} onPress={() => renderer.current?.zoom(1.25)}>
          放大
        </Button>
        <Button size="compact" isDisabled={!ready} onPress={() => renderer.current?.zoom(0.8)}>
          缩小
        </Button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      <div
        ref={container}
        className={styles.canvas}
        role="img"
        data-renderer-state={ready ? 'ready' : 'loading'}
        aria-label="概念关系图。下方提供可键盘操作的等价列表。"
      />
    </>
  );
}
