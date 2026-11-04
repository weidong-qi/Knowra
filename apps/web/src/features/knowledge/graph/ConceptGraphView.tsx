import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Button, Checkbox } from '../../../components/ui';
import { KnowledgeIcon } from '../../../components/icons/knowra';
import { WorkspacePanel, WorkspacePanelBody, WorkspacePanelFooter, WorkspacePanelHeader } from '../../../components/workspace/WorkspacePanel';
import { PathTrail } from '../../../shell/PathTrail';
import { useNavigate } from '../../../app/router';
import { CONCEPT_GRAPH_SAMPLE, type ConceptGraphData, type GraphItem, type MasteryLevel, type SuggestionAction } from './conceptGraphData';
import { ExperimentResultError, conceptRadius, graphFromExperimentResult } from './experimentGraph';
import {
  KIND_LABELS, MASTERY_LABELS, VERIFICATION_LABELS, conceptEmphasis, conceptStatus, edgeLabelOffset, itemLabelPlacement, itemPositions, itemsOf,
  RELATION_LAYER_LABELS, neighborIds, relationLabel, relationLayer, relationMidpoint, relationsOf, type GraphFocus, type RelationLayer
} from './conceptGraphModel';
import styles from './ConceptGraphView.module.css';
import { IncrementalConfirmationDemo } from './IncrementalConfirmationDemo';
import { LocalReportReview } from './report-review/LocalReportReview';

const VIEW_WIDTH = 1040;
const VIEW_HEIGHT = 760;
const ITEM_SIZE = 24;
const LEVEL_CLASS: Record<MasteryLevel, string> = {
  notAssessed: styles.levelNotAssessed, weak: styles.levelWeak, basic: styles.levelBasic, mastered: styles.levelMastered
};

function activate(event: KeyboardEvent, action: () => void) {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); action(); }
}

const BADGE: Record<Exclude<SuggestionAction, 'keep'>, string> = { demote: '降', merge: '并', rename: '名', split: '拆' };
const PROTOTYPE_NOTICE = '原型：数据是根据《动手学深度学习》第 1–2 章笔记手填的示例，掌握状态也是手填的，不读写知识库。';

const shortTitle = (title: string) => (Array.from(title).length > 9 ? `${Array.from(title).slice(0, 8).join('')}…` : title);

export function ConceptGraphView({ data: sample = CONCEPT_GRAPH_SAMPLE }: { data?: ConceptGraphData }) {
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [loaded, setLoaded] = useState<ConceptGraphData | null>(null);
  const [loadError, setLoadError] = useState('');
  const [confirmationDemoOpen, setConfirmationDemoOpen] = useState(false);
  const [reportReviewOpen, setReportReviewOpen] = useState(false);
  const [layers, setLayers] = useState<Record<RelationLayer, boolean>>({ relation: true, suggestion: true, retrieval: false });
  const [focus, setFocus] = useState<GraphFocus>({ kind: 'none' });
  const focusConceptId = focus.kind === 'concept' ? focus.id : focus.kind === 'item' ? focus.conceptId : null;
  const full = loaded ?? sample;
  // 检索边很多，默认只在选中它的一端时显示。
  const data = useMemo(() => ({ ...full, relations: full.relations.filter(relation => !loaded || layers[relationLayer(relation.type)]
    || (relationLayer(relation.type) === 'retrieval' && focusConceptId !== null && (relation.from === focusConceptId || relation.to === focusConceptId))) }), [full, loaded, layers, focusConceptId]);
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      setLoaded(graphFromExperimentResult(JSON.parse(await file.text()), file.name));
      setLoadError('');
      setFocus({ kind: 'none' });
    } catch (error) {
      setLoadError(error instanceof ExperimentResultError ? error.message : '无法读取这个文件：不是合法的 JSON。');
    }
  };
  const focusConcept = data.concepts.find(concept => concept.id === focusConceptId) ?? null;
  const focusItem = focus.kind === 'item' ? data.items.find(item => item.id === focus.id) ?? null : null;
  const statuses = useMemo(() => new Map(data.concepts.map(concept => [concept.id, conceptStatus(data, concept.id)])), [data]);
  // 靠近画布边缘的概念展开后，条目方块收回画布内。
  const expanded = focusConcept ? itemPositions(focusConcept, itemsOf(data, focusConcept.id)).map(entry => ({
    ...entry, x: Math.min(VIEW_WIDTH - 24, Math.max(24, entry.x)), y: Math.min(VIEW_HEIGHT - 24, Math.max(24, entry.y))
  })) : [];
  const basisItemIds = new Set(data.relations.map(relation => relation.basisItemId).filter(Boolean));

  const selectConcept = (id: string) => setFocus(current => (current.kind === 'concept' && current.id === id ? { kind: 'none' } : { kind: 'concept', id }));
  const selectItem = (item: GraphItem, conceptId: string | null) => setFocus({ kind: 'item', id: item.id, conceptId });
  const clear = () => setFocus({ kind: 'none' });
  const hasFocus = focus.kind !== 'none';
  useEffect(() => {
    if (!hasFocus || confirmationDemoOpen || reportReviewOpen) return undefined;
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setFocus({ kind: 'none' }); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hasFocus, confirmationDemoOpen, reportReviewOpen]);

  return <><WorkspacePanel as="main" aria-labelledby="concept-graph-title">
    <WorkspacePanelHeader title="概念图" code="KNOW" titleId="concept-graph-title" icon={<KnowledgeIcon size={13} />}
      breadcrumb={<PathTrail path={[
        { id: 'home', label: '主页', onNavigate: () => navigate('/') },
        { id: 'knowledge', label: '知识库', onNavigate: () => navigate('/knowledge') },
        { id: 'graph', label: '概念图（原型）', current: true }
      ]} variant="top" />}
      breadcrumbTitle="主页 / 知识库 / 概念图（原型）" actionsLabel="概念图操作"
      actions={<>
        <Button size="workspace" onPress={() => fileInput.current?.click()}>导入实验结果</Button>
        {loaded ? <Button size="workspace" onPress={() => { setLoaded(null); setFocus({ kind: 'none' }); }}>回到示例</Button> : null}
        <Button size="workspace" onPress={() => navigate('/knowledge')}>返回知识列表</Button>
        <input ref={fileInput} type="file" accept=".json,application/json" hidden aria-label="选择实验结果文件"
          onChange={event => { void importFile(event.target.files?.[0]); event.target.value = ''; }} />
      </>} />
    <WorkspacePanelBody className={styles.body}>
      <div className={styles.experimentActions}>
        <Button size="compact" onPress={() => setReportReviewOpen(true)}>离线报告审阅（实验）</Button>
        <Button size="compact" onPress={() => setConfirmationDemoOpen(true)}>增量确认演示（实验）</Button>
        <span>实验内容 · 仅本页有效 · 关闭即清空</span>
      </div>
      <p className={styles.prototype} role="note">{full.notice ?? PROTOTYPE_NOTICE}</p>
      {loadError ? <p className={styles.loadError} role="alert">{loadError}</p> : null}
      {loaded ? <div className={styles.layers} role="group" aria-label="显示哪些连线">
        {(Object.keys(RELATION_LAYER_LABELS) as RelationLayer[]).map(layer => <Checkbox key={layer} size="compact" isSelected={layers[layer]}
          onChange={value => setLayers(current => ({ ...current, [layer]: value }))}>
          {RELATION_LAYER_LABELS[layer]}（{full.relations.filter(relation => relationLayer(relation.type) === layer).length}）
        </Checkbox>)}
        <span className={styles.muted}>检索边不勾选时，只在选中它一端的概念时显示</span>
      </div> : null}
      <div className={styles.layout}>
        <div className={styles.canvas}>
          <svg viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} className={styles.svg} role="group" aria-label="概念图">
            <rect width={VIEW_WIDTH} height={VIEW_HEIGHT} className={styles.backdrop} onClick={clear} />
            {data.relations.map(relation => {
              const from = data.concepts.find(concept => concept.id === relation.from);
              const to = data.concepts.find(concept => concept.id === relation.to);
              const mid = relationMidpoint(data, relation);
              if (!from || !to || !mid) return null;
              const active = !focusConceptId || relation.from === focusConceptId || relation.to === focusConceptId;
              const basis = relation.basisItemId ? data.items.find(item => item.id === relation.basisItemId) : undefined;
              const layer = relationLayer(relation.type);
              return <g key={relation.id} className={active ? styles.edge : `${styles.edge} ${styles.faded}`} data-relation={relation.type} data-layer={layer}>
                <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} className={relation.type === 'prerequisiteOf' ? styles.edgeDashed : undefined} />
                {layer === 'retrieval' ? null : (() => {
                  const offset = edgeLabelOffset(from, to, basis ? 20 : 10);
                  return <text x={mid.x + offset.x} y={mid.y + offset.y + 4} className={styles.edgeLabel} textAnchor="middle">{relationLabel(relation)}</text>;
                })()}
                {basis ? <g role="button" tabIndex={0} aria-label={`关系说明：${basis.title}`} className={styles.edgeItem}
                  onClick={event => { event.stopPropagation(); selectItem(basis, null); }} onKeyDown={event => activate(event, () => selectItem(basis, null))}>
                  <rect x={mid.x - 7} y={mid.y - 7} width={14} height={14} rx={3} className={`${LEVEL_CLASS[basis.mastery]} ${focusItem?.id === basis.id ? styles.selectedItem : ''}`} />
                </g> : null}
              </g>;
            })}
            {data.concepts.map(concept => {
              const status = statuses.get(concept.id)!;
              const emphasis = conceptEmphasis(data, focusConceptId, concept.id);
              const coverage = status.total ? status.assessed / status.total : 0;
              const radius = conceptRadius(itemsOf(data, concept.id).length);
              const ringRadius = radius + 6;
              const circumference = 2 * Math.PI * ringRadius;
              const suggestion = concept.suggestion && concept.suggestion.action !== 'keep' ? concept.suggestion : null;
              return <g key={concept.id} role="button" tabIndex={0} aria-pressed={emphasis === 'focus'}
                aria-label={`${concept.name}，${MASTERY_LABELS[status.level]}，已评估 ${status.assessed}/${status.total}${suggestion ? `，整理建议：${suggestion.summary}` : ''}`}
                className={`${styles.concept} ${styles[emphasis]}`} transform={`translate(${concept.x} ${concept.y})`}
                onClick={event => { event.stopPropagation(); selectConcept(concept.id); }} onKeyDown={event => activate(event, () => selectConcept(concept.id))}>
                <circle r={ringRadius} className={styles.ringTrack} />
                {coverage > 0 ? <circle r={ringRadius} className={styles.ring} strokeDasharray={`${circumference * coverage} ${circumference}`} transform="rotate(-90)" /> : null}
                <circle r={radius} className={`${styles.node} ${LEVEL_CLASS[status.level]}`} />
                <text y={radius + 26} textAnchor="middle" className={styles.conceptName}>{concept.name}</text>
                {suggestion ? <g className={styles.badge} transform={`translate(${radius * 0.75} ${-radius * 0.75})`} aria-hidden="true">
                  <circle r={9} /><text y={4} textAnchor="middle">{BADGE[suggestion.action as keyof typeof BADGE]}</text>
                </g> : null}
              </g>;
            })}
            {focusConcept ? <g className={styles.expansion} aria-label={`${focusConcept.name} 的知识条目`} role="group">
              {expanded.map(({ item, x, y }) => <line key={`link-${item.id}`} x1={focusConcept.x} y1={focusConcept.y} x2={x} y2={y} className={styles.itemLink} />)}
              {expanded.map(({ item, x, y, angle }) => <g key={item.id} role="button" tabIndex={0} aria-pressed={focusItem?.id === item.id}
                aria-label={`${item.title}，${KIND_LABELS[item.kind]}，${VERIFICATION_LABELS[item.verification]}，${MASTERY_LABELS[item.mastery]}`}
                className={styles.item} transform={`translate(${x} ${y})`}
                onClick={event => { event.stopPropagation(); selectItem(item, focusConcept.id); }} onKeyDown={event => activate(event, () => selectItem(item, focusConcept.id))}>
                <rect x={-ITEM_SIZE / 2} y={-ITEM_SIZE / 2} width={ITEM_SIZE} height={ITEM_SIZE} rx={4}
                  className={`${LEVEL_CLASS[item.mastery]} ${item.verification !== 'confirmed' ? styles.unconfirmed : ''} ${focusItem?.id === item.id ? styles.selectedItem : ''}`} />
                {item.verification === 'disputed' ? <text y={5} textAnchor="middle" className={styles.disputedMark}>!</text> : null}
                {basisItemIds.has(item.id) ? <circle cx={ITEM_SIZE / 2} cy={-ITEM_SIZE / 2} r={3.5} className={styles.basisDot} /> : null}
                {(() => {
                  const label = itemLabelPlacement(angle, ITEM_SIZE);
                  return <text x={label.dx} y={label.dy} textAnchor={label.anchor} className={styles.itemLabel}>{shortTitle(item.title)}</text>;
                })()}
              </g>)}
            </g> : null}
          </svg>
          <Legend research={!!full.notice} />
        </div>
        <section className={styles.panel} aria-label="详情" aria-live="polite">
          {focusItem ? <ItemDetail data={data} item={focusItem} onSelectConcept={id => setFocus({ kind: 'concept', id })} />
            : focusConcept ? <ConceptDetail data={data} conceptId={focusConcept.id} onSelectItem={item => selectItem(item, focusConcept.id)} onSelectConcept={id => setFocus({ kind: 'concept', id })} />
            : full.notice ? <ResearchIntro data={full} /> : <Intro />}
        </section>
      </div>
    </WorkspacePanelBody>
    <WorkspacePanelFooter><span>{data.concepts.length} 个概念 · {data.items.length} 条知识 · 显示 {data.relations.length}/{full.relations.length} 条连线</span><span>点击圆点展开，Esc 收起</span></WorkspacePanelFooter>
  </WorkspacePanel>{confirmationDemoOpen ? <IncrementalConfirmationDemo onClose={() => setConfirmationDemoOpen(false)} /> : null}{reportReviewOpen ? <LocalReportReview onClose={() => setReportReviewOpen(false)} /> : null}</>;
}

function Legend({ research }: { research: boolean }) {
  return <ul className={styles.legend} aria-label="图例">
    {research ? <>
      <li><span className={`${styles.edgeSample} ${styles.edgeSampleRelation}`} />关系提议（候选）</li>
      <li><span className={`${styles.edgeSample} ${styles.edgeSampleSuggestion}`} />整理建议 / 疑似重复</li>
      <li><span className={`${styles.edgeSample} ${styles.edgeSampleRetrieval}`} />检索到但未复用</li>
      <li><span className={styles.badgeSample}>降</span>角标：整理建议（降 / 并 / 名 / 拆）</li>
      <li>圆点越大，条目越多</li>
    </> : null}
    {(['notAssessed', 'weak', 'basic', 'mastered'] as MasteryLevel[]).map(level => <li key={level}><span className={`${styles.swatch} ${LEVEL_CLASS[level]}`} />{MASTERY_LABELS[level]}</li>)}
    <li><span className={`${styles.swatch} ${styles.swatchSquare} ${styles.unconfirmed}`} />虚线框：未确认</li>
    <li><span className={styles.ringSample} />外环：已评估比例</li>
  </ul>;
}

function Intro() {
  return <div className={styles.intro}>
    <h2>怎么看这张图</h2>
    <p>圆点是概念，颜色是它的掌握情况。颜色只由已确认、已评估的知识汇总得出；从没测过的概念显示为“未评估”，不会被当成薄弱。</p>
    <p>点击圆点，它会变蓝，下面的知识条目以方块形式展开；相邻概念保持半清晰，其余淡出。</p>
    <p>连线中点的小方块，是一条需要说明的关系，比如“向量是一维张量”。它和概念下的条目是同一份数据。</p>
    <p className={styles.muted}>可以留意：“链式法则”没有任何条目，是先搭好的骨架；“梯度”和“x.grad”同名易混，是两个概念；“点积”下有一条待核查的笔记原话。</p>
  </div>;
}

function ResearchIntro({ data }: { data: ConceptGraphData }) {
  const suggested = data.concepts.filter(concept => concept.suggestion && concept.suggestion.action !== 'keep').length;
  const disputed = data.items.filter(item => item.verification === 'disputed').length;
  const largest = [...data.concepts].map(concept => ({ concept, count: itemsOf(data, concept.id).length })).sort((a, b) => b.count - a.count)[0];
  return <div className={styles.intro}>
    <h2>怎么看这张图</h2>
    <p>圆点是实验新建的概念，大小表示挂了多少条目；点击圆点，条目以方块展开，带“!”的方块是 AI 认为原文可能有误的地方，意见与对应原文单独显示；条目陈述是模型复述，原文请看来源。</p>
    <p>实线是模型提议的概念关系，橙色虚线是整理建议和疑似重复，灰色点线是“检索给了这个候选，但模型新建了概念”。所有连线都是候选，没有写入知识库。</p>
    <p className={styles.muted}>这份结果：{suggested} 个概念有整理建议，{disputed} 条条目带存疑意见{largest ? `；条目最多的是“${largest.concept.name}”（${largest.count} 条）` : ''}。</p>
  </div>;
}

function ConceptDetail({ data, conceptId, onSelectItem, onSelectConcept }: { data: ConceptGraphData; conceptId: string; onSelectItem(item: GraphItem): void; onSelectConcept(id: string): void }) {
  const concept = data.concepts.find(entry => entry.id === conceptId)!;
  const status = conceptStatus(data, conceptId);
  const items = itemsOf(data, conceptId);
  const neighbors = neighborIds(data, conceptId);
  return <div className={styles.detail}>
    <p className={styles.eyebrow}>概念</p>
    <h2>{concept.name}</h2>
    <p className={styles.sense}>{concept.sense}</p>
    {concept.aliases.length ? <p className={styles.muted}>别名：{concept.aliases.join('、')}</p> : null}
    {concept.noteId ? <p className={styles.muted}>首次出现：{concept.noteId}</p> : null}
    {concept.suggestion ? <p className={concept.suggestion.action === 'keep' ? styles.note : styles.suggestionNote}>
      整理建议（未执行）：{concept.suggestion.summary}。{concept.suggestion.reason}
    </p> : null}
    <p className={styles.statusLine}><span className={`${styles.swatch} ${LEVEL_CLASS[status.level]}`} />{MASTERY_LABELS[status.level]}<span className={styles.muted}>已评估 {status.assessed}/{status.total} 条已确认知识</span></p>
    <h3>知识条目 <span className={styles.count}>{items.length}</span></h3>
    {items.length === 0 ? <p className={styles.muted}>还没有内容。概念可以先于笔记存在，之后再补。</p> : <ul className={styles.itemList}>
      {items.map(item => <li key={item.id}><button type="button" onClick={() => onSelectItem(item)}>
        <span className={`${styles.swatch} ${styles.swatchSquare} ${LEVEL_CLASS[item.mastery]} ${item.verification !== 'confirmed' ? styles.unconfirmed : ''}`} />
        <span className={styles.itemText}><strong>{item.title}</strong><small>{KIND_LABELS[item.kind]} · {VERIFICATION_LABELS[item.verification]} · {MASTERY_LABELS[item.mastery]}</small></span>
      </button></li>)}
    </ul>}
    <h3>相邻概念 <span className={styles.count}>{neighbors.size}</span></h3>
    <ul className={styles.chips}>{relationsOf(data, conceptId).map(relation => {
      const otherId = relation.from === conceptId ? relation.to : relation.from;
      const other = data.concepts.find(entry => entry.id === otherId);
      return other ? <li key={relation.id}><button type="button" title={relation.reason} onClick={() => onSelectConcept(other.id)}>{relation.from === conceptId ? `${relationLabel(relation)} → ${other.name}` : `${other.name} → ${relationLabel(relation)}`}{relation.verification === 'candidate' ? '（候选）' : ''}</button></li> : null;
    })}</ul>
  </div>;
}

function ItemDetail({ data, item, onSelectConcept }: { data: ConceptGraphData; item: GraphItem; onSelectConcept(id: string): void }) {
  const relation = data.relations.find(entry => entry.basisItemId === item.id);
  const sources = item.sources ?? (item.source ? [item.source] : []);
  return <div className={styles.detail}>
    <p className={styles.eyebrow}>{KIND_LABELS[item.kind]}{relation ? ' · 关系说明' : ''}</p>
    <h2>{item.title}</h2>
    {item.sources ? <p className={styles.eyebrow}>条目陈述（模型复述）</p> : null}
    <p className={styles.statement}>{item.statement}</p>
    <dl className={styles.facts}>
      <dt>审阅</dt><dd className={item.verification === 'disputed' ? styles.warning : undefined}>{VERIFICATION_LABELS[item.verification]}</dd>
      <dt>掌握</dt><dd><span className={`${styles.swatch} ${styles.swatchSquare} ${LEVEL_CLASS[item.mastery]}`} />{MASTERY_LABELS[item.mastery]}</dd>
      <dt>来源</dt><dd>{sources.length ? sources.map((source, index) => <div key={index}>
        <span>{source.note || '笔记未标明'}</span><blockquote>{source.quote || '原文未提供'}</blockquote>
      </div>) : <span className={styles.muted}>没有笔记来源</span>}</dd>
    </dl>
    {item.sourceIssues?.length ? <section aria-label="AI 存疑意见">
      <h3>AI 存疑意见（不是笔记原话）</h3>
      {item.sourceIssues.map((source, index) => <div key={index} className={styles.warningNote}>
        <p>对应笔记：{source.note || '笔记未标明'}</p>
        <blockquote>{source.quote || '对应原文未提供'}</blockquote>
        <p>{source.issue}</p>
      </div>)}
    </section> : null}
    {item.verificationNote ? <p className={item.verification === 'disputed' ? styles.warningNote : styles.note}>{item.verificationNote}</p> : null}
    <h3>涉及概念</h3>
    <ul className={styles.chips}>{item.conceptIds.map(id => {
      const concept = data.concepts.find(entry => entry.id === id);
      return concept ? <li key={id}><button type="button" onClick={() => onSelectConcept(id)}>{concept.name}</button></li> : null;
    })}</ul>
  </div>;
}
