import cytoscape, { type Core, type ElementDefinition, type StylesheetJson } from 'cytoscape';
import type { RealConceptGraph } from './realConceptGraphModel';

export interface GraphRenderer {
  update(graph: RealConceptGraph): void;
  select(id: string | null, edgeId?: string | null): void;
  fit(): void;
  zoom(factor: number): void;
  resize(): void;
  destroy(): void;
}
export function graphElements(graph: RealConceptGraph): ElementDefinition[] {
  return [
    ...graph.nodes.map(node => ({
      data: {
        ...node,
        label: [node.label, node.sense].filter(Boolean).join('\n'),
        id: `concept:${node.id}`,
        conceptId: node.id
      }
    })),
    ...graph.edges.map(edge => ({
      data: { ...edge, source: `concept:${edge.source}`, target: `concept:${edge.target}` },
      classes: `${edge.kind} ${edge.directed ? 'directed' : ''}`
    }))
  ];
}
function themeStyles(container: HTMLElement): StylesheetJson {
  const computed = getComputedStyle(container);
  const color = (token: string, fallback = computed.color || 'gray') =>
    computed.getPropertyValue(token).trim() || fallback;
  const ink = color('--text-primary');
  const muted = color('--text-secondary');
  const accent = color('--accent');
  return [
    {
      selector: 'node',
      style: {
        label: 'data(label)',
        'background-color': color('--text-muted'),
        color: ink,
        'font-size': 12,
        width: 30,
        height: 30,
        'text-valign': 'bottom',
        'text-margin-y': 8,
        'text-wrap': 'wrap',
        'text-max-width': '140px'
      }
    },
    {
      selector: 'edge',
      style: {
        label: 'data(label)',
        width: 1.5,
        'line-color': muted,
        'target-arrow-color': muted,
        'curve-style': 'bezier',
        'font-size': 10,
        color: ink,
        'text-rotation': 'autorotate',
        'text-background-color': color('--ni-paper', 'transparent'),
        'text-background-opacity': 0.9,
        'text-background-padding': '2px'
      }
    },
    { selector: '.directed', style: { 'target-arrow-shape': 'triangle' } },
    { selector: '.projection', style: { 'line-style': 'dashed', 'line-color': accent, 'target-arrow-color': accent } },
    { selector: 'node:selected', style: { 'border-color': accent, 'border-width': 3 } },
    { selector: 'edge:selected', style: { 'line-color': accent, 'target-arrow-color': accent, width: 3 } }
  ];
}
/** 渲染器只负责图形，不承载领域写入；所有颜色从当前工作区 tokens 取值。 */
export function createGraphRenderer(
  container: HTMLElement,
  onSelect: (id: string) => void,
  onEdge: (id: string) => void
): GraphRenderer {
  const cy: Core = cytoscape({
    container,
    elements: [],
    minZoom: 0.15,
    maxZoom: 3,
    wheelSensitivity: 0.2,
    style: themeStyles(container)
  });
  cy.on('tap', 'node', event => onSelect(event.target.data('conceptId')));
  cy.on('tap', 'edge', event => onEdge(event.target.id()));
  let topology = '';
  const fit = () => {
    cy.fit(undefined, 40);
    // 单节点和小图不自动放到最大倍数；详情栏改变画布宽度后重新居中。
    if (cy.zoom() > 1.25) {
      cy.zoom(1.25);
      cy.center();
    }
  };
  return {
    update(graph) {
      cy.style(themeStyles(container));
      const elements = graphElements(graph);
      const next = JSON.stringify(
        elements
          .map(row => [row.data.id, row.data.source, row.data.target])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      );
      cy.batch(() => {
        const ids = new Set(elements.map(row => row.data.id));
        cy.elements()
          .filter(element => !ids.has(element.id()))
          .remove();
        for (const element of elements) {
          const existing = cy.getElementById(element.data.id!);
          if (existing.length) {
            if (existing.isEdge()) existing.move({ source: element.data.source, target: element.data.target });
            existing.data(element.data).classes(element.classes ?? '');
          } else cy.add(element);
        }
      });
      if (next !== topology) {
        topology = next;
        // 不保留常驻力模拟；大图使用线性网格布局，标签/主题变化不重排。
        cy.layout(
          graph.nodes.length > 250
            ? { name: 'grid', fit: false, padding: 40 }
            : { name: 'cose', fit: false, animate: false, randomize: true, numIter: 180, padding: 40 }
        ).run();
        fit();
      }
    },
    select(id, edgeId = null) {
      cy.elements().unselect();
      if (edgeId) cy.getElementById(edgeId).select();
      else if (id) cy.getElementById(`concept:${id}`).select();
    },
    fit() {
      fit();
    },
    zoom(factor) {
      cy.zoom({
        level: Math.max(cy.minZoom(), Math.min(cy.maxZoom(), cy.zoom() * factor)),
        renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 }
      });
    },
    resize() {
      cy.resize();
      fit();
    },
    destroy() {
      cy.destroy();
    }
  };
}
