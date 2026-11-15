import { conceptItemLinks, type ConceptState, type KnowledgeItem } from '@study-accelerator/web-core';
import { Button } from '../../../components/ui';
import { MathText } from '../../../components/math/MathText';
import { knowledgeStatusLabel } from '../knowledgeViewModel';
import type { GraphEdge, GraphNode, RealConceptGraph } from './realConceptGraphModel';
import styles from './RealConceptGraph.module.css';

export function ConceptGraphInspector({
  node,
  edge,
  graph,
  state,
  items,
  onOpenConcept,
  onOpenItem
}: {
  node?: GraphNode;
  edge?: GraphEdge;
  graph: RealConceptGraph;
  state: ConceptState;
  items: KnowledgeItem[];
  onOpenConcept(id: string): void;
  onOpenItem(id: string): void;
}) {
  if (edge) {
    const names = new Map(graph.nodes.map(row => [row.id, `${row.label}${row.sense ? ` · ${row.sense}` : ''}`]));
    return (
      <section className={styles.detail} aria-label="所选关系">
        <span>{edge.kind === 'projection' ? '投影 · 待定类型，尚未保存' : '已确认关系'}</span>
        <h3>
          {names.get(edge.source)} {edge.directed ? '→' : '↔'} {names.get(edge.target)}
        </h3>
        <p>{edge.label}</p>
        <Button size="compact" onPress={() => onOpenConcept(edge.source)}>
          {edge.kind === 'projection' ? '前往概念详情确认候选' : '前往概念详情管理关系'}
        </Button>
        {edge.basisItemId ? (
          <Button variant="ghost" size="compact" onPress={() => onOpenItem(edge.basisItemId!)}>
            查看依据知识点
          </Button>
        ) : (
          <p className={styles.hint}>手工骨架关系，未指定依据知识点。</p>
        )}
      </section>
    );
  }
  if (!node)
    return (
      <div className={styles.detail}>
        <h3>选择概念或关系</h3>
        <p className={styles.hint}>点击图中节点、连线或下方列表，在这里查看详情。</p>
      </div>
    );
  const links = conceptItemLinks(state, items).filter(link => link.conceptId === node.id);
  const byId = new Map(items.map(item => [item.id, item]));
  return (
    <section className={styles.detail} aria-label="所选概念">
      <h3>{node.label}</h3>
      {node.sense ? <p>{node.sense}</p> : null}
      <p className={styles.hint}>掌握状态：未评估</p>
      <Button size="compact" onPress={() => onOpenConcept(node.id)}>
        打开概念详情与关系
      </Button>
      <h4>关联知识点 · {links.length}</h4>
      {links.length ? (
        <ul className={styles.itemList}>
          {links.map(link => {
            const item = byId.get(link.knowledgeItemId)!;
            return (
              <li key={link.id}>
                <Button variant="ghost" size="compact" onPress={() => onOpenItem(item.id)}>
                  <MathText text={item.title} inlineOnly />
                </Button>
                <span className={styles.hint}>
                  {link.role === 'subject' ? '主体' : '提及'} · {knowledgeStatusLabel(item.reviewStatus)}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={styles.hint}>这个概念还没有关联知识点。</p>
      )}
    </section>
  );
}
