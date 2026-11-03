// 研究视图：把 concept-linking-r2 实验在本机生成的 result.json 转成概念图数据。
// 只在页面内存中使用，不写知识库；所有条目和关系都是模型提议，一律按候选展示。
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force';
import type { ConceptGraphData, GraphConcept, GraphItem, GraphRelation, GraphSourceIssue, ItemKind, SemanticRelationType, SuggestionAction } from './conceptGraphData';

export const GRAPH_WIDTH = 1040;
export const GRAPH_HEIGHT = 760;

const KIND: Record<string, ItemKind> = { definition: 'definition', fact: 'fact', procedure: 'process', application: 'application' };
const SEMANTIC = new Set<SemanticRelationType>(['isA', 'partOf', 'prerequisiteOf', 'appliesTo', 'contrastsWith', 'relatedTo']);
const ACTION_TEXT: Record<SuggestionAction, string> = { keep: '保留', demote: '降级到', merge: '合并到', rename: '改名为', split: '拆出' };

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value);
const list = (value: unknown): Json[] => (Array.isArray(value) ? value.filter(isRecord) : []);
const text = (value: unknown) => (typeof value === 'string' ? value : '');

export class ExperimentResultError extends Error {}

/** 概念圆点按条目数放大，过粗的概念一眼可见。 */
export const conceptRadius = (itemCount: number) => Math.min(44, 20 + 4 * Math.sqrt(itemCount));

export function graphFromExperimentResult(raw: unknown, fileName = 'result.json'): ConceptGraphData {
  if (!isRecord(raw) || !isRecord(raw.state) || !Array.isArray(raw.state.concepts) || !Array.isArray(raw.state.items)) {
    throw new ExperimentResultError('不是 concept-linking-r2 的 result.json：缺少 state.concepts 或 state.items');
  }
  const conceptRows = list(raw.state.concepts);
  const conceptIds = new Set(conceptRows.map(row => text(row.id)));
  const name = (id: string) => text(conceptRows.find(row => row.id === id)?.name) || id;
  const results = list(raw.results);
  const links = results.flatMap(result => list(isRecord(result.response) ? result.response.links : []).filter(link => link.accepted === true));

  // sourceIssue 记在挂靠记录上；它是 AI 的存疑意见，单独展示，不混进陈述。
  const issues = new Map<string, GraphSourceIssue[]>();
  for (const result of results) {
    for (const link of list(isRecord(result.response) ? result.response.links : [])) {
      if (link.accepted !== true || !text(link.sourceIssue) || !text(link.itemId)) continue;
      const itemId = text(link.itemId);
      const issue = { note: text(result.noteId), quote: text(link.quote), issue: text(link.sourceIssue) };
      issues.set(itemId, [...(issues.get(itemId) ?? []), issue]);
    }
  }

  const items: GraphItem[] = list(raw.state.items).filter(row => conceptIds.has(text(row.conceptId))).map(row => {
    const sources = list(row.sources).map(source => ({ note: text(source.noteId), quote: text(source.quote) }));
    const sourceIssues = issues.get(text(row.id)) ?? [];
    return {
      id: text(row.id), title: text(row.title), kind: KIND[text(row.kind)] ?? 'fact', statement: text(row.statement),
      conceptIds: [text(row.conceptId)], mastery: 'notAssessed',
      verification: sourceIssues.length ? 'disputed' : 'candidate',
      sourceIssues, sources,
      source: sources[0] ?? null,
      sourceCount: sources.length
    };
  });

  const relations: GraphRelation[] = [];
  const seen = new Set<string>();
  const add = (relation: Omit<GraphRelation, 'id'>) => {
    const key = `${relation.type}:${relation.from}:${relation.to}`;
    if (relation.from === relation.to || !conceptIds.has(relation.from) || !conceptIds.has(relation.to) || seen.has(key)) return;
    seen.add(key);
    relations.push({ id: key, ...relation });
  };

  for (const link of links) {
    if (text(link.possibleDuplicateOf)) add({ from: text(link.conceptId), to: text(link.possibleDuplicateOf), type: 'possibleDuplicate', verification: 'candidate' });
  }

  // 检索给了候选、模型却新建了概念：既可能是正确区分（x.grad 与数学梯度），也可能是漏了合并。
  for (const result of results) {
    const noteLinks = list(isRecord(result.response) ? result.response.links : []).filter(link => link.accepted === true);
    const used = new Set(noteLinks.map(link => text(link.conceptId)));
    const created = new Set(noteLinks.filter(link => link.conceptAction === 'create').map(link => text(link.conceptId)));
    for (const candidate of list(result.candidates)) {
      if (used.has(text(candidate.id))) continue;
      for (const from of created) add({ from, to: text(candidate.id), type: 'retrievedNotReused', label: '检索到未复用' });
    }
  }

  const suggestions = new Map<string, GraphConcept['suggestion']>();
  for (const entry of list(isRecord(raw.review) ? raw.review.suggestions : []).filter(entry => entry.accepted === true)) {
    const action = text(entry.action) as SuggestionAction;
    if (!(action in ACTION_TEXT)) continue;
    const conceptId = text(entry.conceptId);
    const target = text(entry.targetId);
    const parts = list(entry.split).map(part => `${text(part.name)}（${Array.isArray(part.itemIds) ? part.itemIds.length : 0} 条）`);
    const summary = `${ACTION_TEXT[action]}${target ? ` ${name(target)}` : ''}${text(entry.newName) ? ` ${text(entry.newName)}` : ''}${parts.length ? ` ${parts.join('、')}` : ''}`;
    suggestions.set(conceptId, { action, summary, reason: text(entry.reason) });
    if (target && (action === 'demote' || action === 'merge')) {
      add({ from: conceptId, to: target, type: action === 'demote' ? 'suggestDemote' : 'suggestMerge', verification: 'candidate', reason: text(entry.reason) });
    }
  }

  const itemIds = new Set(items.map(item => item.id));
  for (const proposal of list(isRecord(raw.relations) ? raw.relations.proposals : []).filter(entry => entry.accepted === true)) {
    const type = text(proposal.type) as SemanticRelationType;
    if (!SEMANTIC.has(type)) continue;
    add({
      from: text(proposal.from), to: text(proposal.to), type, verification: 'candidate', reason: text(proposal.reason) || undefined,
      basisItemId: itemIds.has(text(proposal.basisItemId)) ? text(proposal.basisItemId) : undefined
    });
  }

  const concepts: GraphConcept[] = conceptRows.map(row => ({
    id: text(row.id), name: text(row.name), sense: text(row.sense), aliases: [], x: 0, y: 0,
    noteId: text(row.noteId) || undefined, suggestion: suggestions.get(text(row.id))
  }));
  const relationCount = relations.filter(relation => SEMANTIC.has(relation.type as SemanticRelationType)).length;
  return layoutGraph({
    notice: `研究视图：来自本机实验结果 ${fileName}，只保存在本页内存中，不写知识库。所有条目与关系都是模型提议的候选；掌握状态未评估。${relationCount ? '' : '这份结果里没有概念之间的关系提议。'}`,
    concepts, items, relations
  });
}

interface LayoutNode extends SimulationNodeDatum { id: string; r: number }

/** 力导向布局（d3-force），同步跑完后缩放进画布。同一篇笔记的概念轻微相吸，检索边几乎不参与布局。 */
export function layoutGraph(data: ConceptGraphData): ConceptGraphData {
  if (data.concepts.length === 0) return data;
  const count = (id: string) => data.items.filter(item => item.conceptIds.includes(id)).length;
  const nodes: LayoutNode[] = data.concepts.map(concept => ({ id: concept.id, r: conceptRadius(count(concept.id)) }));
  const strength: Record<string, number> = { relation: 0.6, suggestion: 0.4, retrieval: 0.03, note: 0.12 };
  const edges: Array<SimulationLinkDatum<LayoutNode> & { kind: string }> = data.relations.map(relation => ({
    source: relation.from, target: relation.to,
    kind: relation.type === 'retrievedNotReused' ? 'retrieval' : ['possibleDuplicate', 'suggestDemote', 'suggestMerge'].includes(relation.type) ? 'suggestion' : 'relation'
  }));
  const byNote = new Map<string, string[]>();
  for (const concept of data.concepts) if (concept.noteId) byNote.set(concept.noteId, [...(byNote.get(concept.noteId) ?? []), concept.id]);
  for (const ids of byNote.values()) for (let i = 1; i < ids.length; i += 1) edges.push({ source: ids[i - 1], target: ids[i], kind: 'note' });

  const simulation = forceSimulation(nodes)
    .force('link', forceLink<LayoutNode, (typeof edges)[number]>(edges).id(node => node.id).distance(edge => (edge.kind === 'note' ? 90 : 150)).strength(edge => strength[edge.kind]))
    .force('charge', forceManyBody().strength(-380))
    .force('collide', forceCollide<LayoutNode>(node => node.r + 34))
    .force('x', forceX(0).strength(0.05))
    .force('y', forceY(0).strength(0.07))
    .stop();
  simulation.tick(400);

  const margin = 80;
  const xs = nodes.map(node => node.x ?? 0);
  const ys = nodes.map(node => node.y ?? 0);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = Math.min((GRAPH_WIDTH - 2 * margin) / Math.max(maxX - minX, 1), (GRAPH_HEIGHT - 2 * margin) / Math.max(maxY - minY, 1), 1.6);
  const offsetX = (GRAPH_WIDTH - (maxX - minX) * scale) / 2;
  const offsetY = (GRAPH_HEIGHT - (maxY - minY) * scale) / 2;
  const position = new Map(nodes.map(node => [node.id, { x: offsetX + ((node.x ?? 0) - minX) * scale, y: offsetY + ((node.y ?? 0) - minY) * scale }]));
  return { ...data, concepts: data.concepts.map(concept => ({ ...concept, ...position.get(concept.id)! })) };
}
