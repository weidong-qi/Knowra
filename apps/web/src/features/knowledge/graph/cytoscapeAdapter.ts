import cytoscape, { type Core, type ElementDefinition } from 'cytoscape';
import type { RealConceptGraph } from './realConceptGraphModel';

export interface GraphRenderer {
  update(graph: RealConceptGraph): void;
  select(id: string | null): void;
  fit(): void;
  zoom(factor: number): void;
  resize(): void;
  destroy(): void;
}
export function graphElements(graph: RealConceptGraph): ElementDefinition[] {
  return [
    ...graph.nodes.map(node => ({ data: { ...node, id: `concept:${node.id}`, conceptId: node.id } })),
    ...graph.edges.map(edge => ({
      data: { ...edge, source: `concept:${edge.source}`, target: `concept:${edge.target}` },
      classes: `${edge.kind} ${edge.directed ? 'directed' : ''}`
    }))
  ];
}
/** 唯一接触渲染库的边界；领域模型与 React 不依赖 Cytoscape Core。 */
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
    style: [
      {
        selector: 'node',
        style: {
          label: 'data(label)',
          'background-color': '#7b8494',
          color: '#354052',
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
          'line-color': '#a3aaba',
          'target-arrow-color': '#a3aaba',
          'curve-style': 'bezier',
          'font-size': 10,
          color: '#626c7c',
          'text-rotation': 'autorotate',
          'text-background-color': '#ffffff',
          'text-background-opacity': 0.85,
          'text-background-padding': '2px'
        }
      },
      { selector: '.directed', style: { 'target-arrow-shape': 'triangle' } },
      {
        selector: '.projection',
        style: { 'line-style': 'dashed', 'line-color': '#b09b73', 'target-arrow-color': '#b09b73' }
      },
      { selector: 'node:selected', style: { 'border-color': '#426bb2', 'border-width': 3 } }
    ]
  });
  cy.on('tap', 'node', event => onSelect(event.target.data('conceptId')));
  cy.on('tap', 'edge', event => onEdge(event.target.id()));
  let topology = '';
  return {
    update(graph) {
      const elements = graphElements(graph);
      const next = JSON.stringify(elements.map(row => [row.data.id, row.data.source, row.data.target]));
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
        // 有限迭代、无动画，不启动常驻力模拟；大图采用线性网格布局。
        cy.layout(
          graph.nodes.length > 250
            ? { name: 'grid', padding: 40 }
            : { name: 'cose', animate: false, randomize: true, numIter: 180, padding: 40 }
        ).run();
      }
    },
    select(id) {
      cy.nodes().unselect();
      if (id) cy.getElementById(`concept:${id}`).select();
    },
    fit() {
      cy.fit(undefined, 40);
    },
    zoom(factor) {
      cy.zoom({
        level: Math.max(cy.minZoom(), Math.min(cy.maxZoom(), cy.zoom() * factor)),
        renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 }
      });
    },
    resize() {
      cy.resize();
    },
    destroy() {
      cy.destroy();
    }
  };
}
