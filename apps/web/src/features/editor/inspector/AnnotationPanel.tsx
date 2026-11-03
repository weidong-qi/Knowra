import { MathText } from '../../../components/math/MathText';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Annotation } from '@study-accelerator/web-core';
import { Button, Checkbox, Select, PressableButton } from '../../../components/ui';
import { Menu, MenuItem, MenuPopover, MenuTrigger, PointMenu, Popover, PopoverTrigger, PopoverDialog } from '../../../components/ui/overlay';
import { IconButton, SegmentedControl, SegmentedButton } from '../../../components/ui/button';
import { StarIcon, FilterIcon, SortArrowsIcon, MoreHorizontalIcon, CloseIcon } from '../../../components/icons/knowra';
import { AnalysisScopeDialog } from '../AnalysisScopeDialog';
import { KnowledgeExtractionTaskPanel } from '../KnowledgeExtractionTaskPanel';
import { buildAnnotationListRows, type AnnotationSort } from '../annotationListModel';
import type { EditorInspectorProps } from './types';
import { useAnnotationDetails } from './useAnnotationDetails';
import { AnnotationDetailDialog } from './AnnotationDetailDialog';
import { KIND_OPTIONS, IMPORTANCE_OPTIONS, STATUS_FILTERS, scopeLabel } from './annotationOptions';
import { useInspectorAnalysis } from './useInspectorAnalysis';
import { InspectorAnalysisIntro, InspectorSavedScopes } from './InspectorAnalysisPanels';
import styles from '../EditorInspector.module.css';

type AnnotationPanelProps = Pick<EditorInspectorProps,
  'note' | 'annotations' | 'annotationsLoading' | 'canWrite'
  | 'focusedAnnotationId' | 'knowledgeWriteDisabledReason' | 'onClearOverlappingAnnotations' | 'onConfirmAnnotationRange'
  | 'onCreateAnalysisScope' | 'onCreateAnnotationExclusion' | 'onCreateKnowledgeCandidate' | 'onDeleteAnnotation'
  | 'onDeleteAnnotationExclusion' | 'onExtractWithAssistant' | 'onGetAnnotationKnowledgeLinks' | 'onListAnalysisScopes'
  | 'onOpenKnowledgeItem' | 'onPreviewAnalysisScope' | 'onPreviewAnnotation' | 'onReanchorAnnotation'
  | 'onRestoreAnalysisScope' | 'onRestoreAnnotation' | 'onSelectAnnotation' | 'onTrashAnalysisScope'
  | 'onUpdateAnnotation' | 'overlappingAnnotationIds'> & { analysisOnly?: boolean };

export function AnnotationPanel(props: AnnotationPanelProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set());
  // 同步引用防止同一事件轮次重复提交；每次变更向 UI 发布同一份不可变集合。
  const pendingActions = useRef(pendingIds);
  function setActionPending(id: string, pending: boolean) {
    const next = new Set(pendingActions.current);
    if (pending) next.add(id); else next.delete(id);
    pendingActions.current = next;
    setPendingIds(next);
  }
  const [error, setError] = useState('');
  const [undo, setUndo] = useState<{ id: string; revision?: number; inline?: boolean } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [scopeFilter, setScopeFilter] = useState('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [sectionFilter, setSectionFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [kindFilter, setKindFilter] = useState('all');
  const [sortOrder, setSortOrder] = useState<AnnotationSort>('document');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const currentAnnotations = useMemo(
    () => props.annotations.filter((item) => item.lifecycleStatus === 'active' || (!item.lifecycleStatus && item.status !== 'archived' && !item.deletedAt)),
    [props.annotations]
  );

  useEffect(() => {
    const available = new Set(currentAnnotations.map((item) => item.id));
    setSelectedIds((ids) => ids.filter((id) => available.has(id)));
  }, [currentAnnotations]);

  const sections = [...new Set(currentAnnotations.map((item) => item.headingPath.at(-1) || '未分章节'))];
  const visible = currentAnnotations.filter((annotation) => {
    const status = (annotation.anchorStatus ? annotation.anchorStatus !== 'resolved' : annotation.status === 'stale') ? 'needsReview' : 'active';
    return (scopeFilter === 'all' || (annotation.scopeType ?? 'selection') === scopeFilter)
      && (sectionFilter === 'all' || (annotation.headingPath.at(-1) || '未分章节') === sectionFilter)
      && (statusFilter === 'all' || status === statusFilter)
      && (kindFilter === 'all' || annotation.kind === kindFilter);
  });
  const rows = buildAnnotationListRows(visible, sortOrder);
  const analysisState = useInspectorAnalysis(props, props.analysisOnly, selectedIds, visible.map(item => item.id), setError);
  const { creating, setScopeRefresh, analysis, setAnalysis, task, previewAnalysis } = analysisState;

  useEffect(() => {
    if (!props.overlappingAnnotationIds?.length) return;
    setScopeFilter('all');
    setSectionFilter('all');
    setStatusFilter('all');
    setKindFilter('all');
  }, [props.overlappingAnnotationIds]);

  useEffect(() => {
    if (!props.overlappingAnnotationIds?.length) return;
    const target = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-annotation-card-id]') ?? [])]
      .find((element) => props.overlappingAnnotationIds?.includes(element.dataset.annotationCardId ?? ''));
    target?.scrollIntoView?.({ block: 'nearest' });
  }, [props.overlappingAnnotationIds, scopeFilter, sectionFilter, statusFilter, kindFilter, sortOrder]);

  async function run(id: string, action: () => Promise<void>, isCurrent = () => true) {
    if (pendingActions.current.has(id)) return;
    setActionPending(id, true);
    setError('');
    try {
      await action();
    } catch (actionError) {
      if (isCurrent()) setError(actionError instanceof Error ? actionError.message : '标注操作失败，请重试');
    } finally {
      setActionPending(id, false);
    }
  }

  const details = useAnnotationDetails(props, run);
  const contextAnnotation = currentAnnotations.find(item => item.id === contextMenu?.id);
  function annotationActions(annotation: Annotation) {
    const pending = pendingIds.has(annotation.id);
    const stale = annotation.anchorStatus ? annotation.anchorStatus !== 'resolved' : annotation.status === 'stale';
    return <Menu ariaLabel="重点操作" onAction={() => setContextMenu(null)}>
      <MenuItem id="detail" isDisabled={pending || !props.onPreviewAnnotation || !props.onGetAnnotationKnowledgeLinks} onAction={() => void details.openDetail(annotation)}>预览与编辑</MenuItem>
      <MenuItem id="knowledge" isDisabled={pending || stale || !annotation.quoteText.trim() || !props.canWrite || !props.onCreateKnowledgeCandidate} onAction={() => void run(annotation.id, () => props.onCreateKnowledgeCandidate!(annotation))}>创建知识候选</MenuItem>
      <MenuItem id="reanchor" isDisabled={pending || !props.canWrite} onAction={() => void run(annotation.id, () => props.onReanchorAnnotation(annotation))}>重新选择来源</MenuItem>
      {['section', 'list'].includes(annotation.scopeType ?? '') ? <MenuItem id="exclude" isDisabled={pending || !props.canWrite || !props.onCreateAnnotationExclusion} onAction={() => void run(annotation.id, () => props.onCreateAnnotationExclusion!(annotation))}>排除当前块</MenuItem> : null}
      <MenuItem id="archive" isDanger isDisabled={pending || !props.canWrite} onAction={() => void run(annotation.id, async () => {
        const deleted = await props.onDeleteAnnotation(annotation.id, annotation.revision);
        setSelectedIds(ids => ids.filter(id => id !== annotation.id));
        setUndo({ id: annotation.id, revision: deleted?.revision ?? (annotation.revision ?? 1) + 1, inline: annotation.schemaVersion === 3 });
        window.setTimeout(() => setUndo(current => current?.id === annotation.id ? null : current), 10000);
      })}>取消重点</MenuItem>
    </Menu>;
  }

  return (
    <section className={props.analysisOnly ? styles.aiTab : `${styles.simplePanel} ${styles.annotationPanel}`} aria-label="正文标注">
      {props.analysisOnly ? <InspectorAnalysisIntro props={props} state={analysisState} /> : <>
      <header className={styles.annotationHeader}>
        <div className={styles.annotationTitle}><StarIcon size={16} /><strong>重点标记</strong><span>{currentAnnotations.length}</span></div>
        <div className={styles.annotationHeaderActions}>
        <PopoverTrigger isOpen={sortOpen} onOpenChange={setSortOpen}>
          <IconButton size={24} aria-label="排序重点" title="排序重点" className={sortOrder !== 'document' ? styles.annotationFilterActive : undefined}><SortArrowsIcon size={15} /></IconButton>
          <Popover placement="bottom end" offset={8} className={styles.annotationSortPopover}>
            <PopoverDialog aria-label="排序重点" className={styles.annotationSortOptions}>
              <strong>排序重点</strong>
              <PressableButton type="button" aria-pressed={sortOrder === 'document'} onPress={() => { setSortOrder('document'); setSortOpen(false); }}>正文顺序</PressableButton>
              <PressableButton type="button" aria-pressed={sortOrder === 'importance'} onPress={() => { setSortOrder('importance'); setSortOpen(false); }}>重要级：高到低</PressableButton>
            </PopoverDialog>
          </Popover>
        </PopoverTrigger>
        <PopoverTrigger isOpen={filtersOpen} onOpenChange={setFiltersOpen}>
          <IconButton size={24} aria-label="筛选重点" title="筛选重点" className={sectionFilter !== 'all' || statusFilter !== 'all' || kindFilter !== 'all' ? styles.annotationFilterActive : undefined}><FilterIcon size={15} /></IconButton>
          <Popover placement="bottom end" offset={8} className={styles.annotationFilterPopover}>
            <PopoverDialog aria-label="筛选重点" className={styles.annotationFilters}>
              <header><strong>筛选重点</strong><IconButton size={24} aria-label="关闭筛选" onPress={() => setFiltersOpen(false)}><CloseIcon size={14} /></IconButton></header>
              <Select label="章节" options={[{ id: 'all', label: '全部章节' }, ...sections.map((section) => ({ id: section, label: section }))]} selectedKey={sectionFilter} onSelectionChange={(key) => setSectionFilter(String(key))} />
              <Select label="类型" options={[{ id: 'all', label: '全部类型' }, ...KIND_OPTIONS]} selectedKey={kindFilter} onSelectionChange={(key) => setKindFilter(String(key))} />
              <fieldset><legend>原文状态</legend><div className={styles.annotationStatusOptions}>{STATUS_FILTERS.map((option) => <PressableButton key={option.id} type="button" aria-pressed={statusFilter === option.id} onPress={() => setStatusFilter(option.id)}>{option.label}</PressableButton>)}</div></fieldset>
              <footer><PressableButton type="button" onPress={() => { setSectionFilter('all'); setStatusFilter('all'); setKindFilter('all'); }}>重置筛选</PressableButton><Button variant="primary" onPress={() => setFiltersOpen(false)}>完成</Button></footer>
            </PopoverDialog>
          </Popover>
        </PopoverTrigger>
        </div>
      </header>
      <SegmentedControl variant="underline" className={styles.annotationScopeFilters} aria-label="重点范围">
        {[['all', '全部'], ['selection', '选区'], ['blocks', '块'], ['section', '章节'], ['list', '列表项']].map(([id, label]) => <SegmentedButton key={id} aria-pressed={scopeFilter === id} onPress={() => setScopeFilter(id)} count={currentAnnotations.filter((item) => id === 'all' || (item.scopeType ?? 'selection') === id).length}>{label}</SegmentedButton>)}
      </SegmentedControl>
      {sectionFilter !== 'all' || statusFilter !== 'all' || kindFilter !== 'all' ? <div className={styles.annotationFilterSummary}>已筛选 {[sectionFilter, statusFilter, kindFilter].filter((value) => value !== 'all').length} 项 <PressableButton type="button" onPress={() => { setSectionFilter('all'); setStatusFilter('all'); setKindFilter('all'); }}>清除</PressableButton></div> : null}
      {props.overlappingAnnotationIds?.length ? <div className={styles.annotationOverlapSummary} role="status">此处有 {props.overlappingAnnotationIds.length} 条重点，已在下方标出。<PressableButton type="button" onPress={props.onClearOverlappingAnnotations}>清除定位</PressableButton></div> : null}
      {undo && props.onRestoreAnnotation ? <p role="status" className={styles.annotationFilterSummary}>{undo.inline ? '已取消重点。' : '重点已移入回收站。'} <PressableButton type="button" onPress={() => void run(undo.id, async () => { await props.onRestoreAnnotation?.(undo.id, undo.revision); setUndo(null); })}>撤销</PressableButton></p> : null}
      <div className={styles.annotationList} ref={listRef}>
        {props.annotationsLoading ? <p className={styles.emptyPanel} role="status">正在加载正文标注…</p> : visible.length === 0 ? <p className={styles.emptyPanel}>{currentAnnotations.length ? '没有符合筛选条件的重点。' : '暂无重点，选中正文或打开块菜单即可标记。'}</p> : null}
        {rows.map(({ annotation, depth, parentId, containedCount, overlapCount, historicalRelation }, index) => {
          const stale = annotation.anchorStatus ? annotation.anchorStatus !== 'resolved' : annotation.status === 'stale';
          const pending = pendingIds.has(annotation.id);
          return <article key={annotation.id} className={depth ? styles.annotationNested : undefined} style={depth ? { '--annotation-depth': Math.min(depth, 3) } as CSSProperties : undefined} data-annotation-card-id={annotation.id} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); setContextMenu({ id: annotation.id, x: event.clientX || rect.left + 12, y: event.clientY || rect.top + 12 }); }} data-importance={annotation.importance ?? undefined} data-overlap-focused={props.overlappingAnnotationIds?.includes(annotation.id) || undefined} data-focused={props.focusedAnnotationId === annotation.id || undefined} data-stale={stale || undefined} data-selected={selectedIds.includes(annotation.id) || undefined}>
            <Checkbox size="compact" aria-label={`选择重点 ${index + 1}`} isSelected={selectedIds.includes(annotation.id)} onChange={(selected) => setSelectedIds((current) => selected ? [...current, annotation.id] : current.filter((id) => id !== annotation.id))} />
            <PressableButton type="button" className={styles.annotationTarget} aria-label={`定位重点 ${index + 1}：${annotation.quoteText}`} isDisabled={pending} onPress={() => props.onSelectAnnotation(annotation.id)}>
              <span className={styles.annotationQuote}>{annotation.quoteText ? <MathText text={annotation.quoteText} inlineOnly /> : '空内容块，后续输入继续纳入'}</span>
              <span className={styles.annotationItemHeading}><span>{scopeLabel(annotation.scopeType)}</span><span>· {KIND_OPTIONS.find((option) => option.id === annotation.kind)?.label ?? annotation.kind}</span>{annotation.importance ? <span className={styles.annotationImportance}>{IMPORTANCE_OPTIONS.find((option) => option.id === annotation.importance)?.label}</span> : null}{stale ? <strong>{annotation.anchorStatus === 'missing' ? '原文已删除' : '范围待确认'}</strong> : annotation.anchorReason === 'convertedToSelection' ? <strong>已保留原范围，转为选区</strong> : null}</span>
              {annotation.headingPath.length > 0 ? <small title={annotation.headingPath.join(' / ')}>{annotation.headingPath.join(' / ')}</small> : null}
              {parentId || containedCount || overlapCount ? <span className={styles.annotationRelation}>{historicalRelation ? '原标记范围：' : null}{parentId ? '位于另一条重点内' : null}{containedCount ? `${parentId ? ' · ' : ''}包含 ${containedCount} 条重点` : null}{overlapCount ? `${parentId || containedCount ? ' · ' : ''}与 ${overlapCount} 条重点重叠` : null}</span> : null}
            </PressableButton>
            <MenuTrigger><IconButton size={24} aria-label={`重点 ${index + 1} 更多操作`}><MoreHorizontalIcon size={15} /></IconButton>
              <MenuPopover placement="bottom end">{annotationActions(annotation)}</MenuPopover>
            </MenuTrigger>
          </article>;
        })}
      </div>
      <PointMenu point={contextAnnotation && contextMenu ? contextMenu : null} onOpenChange={open => { if (!open) setContextMenu(null); }}>
        {contextAnnotation ? annotationActions(contextAnnotation) : null}
      </PointMenu>
      {selectedIds.length > 0 ? <div className={styles.annotationAnalysisActions}>
        <span>已选择 {selectedIds.length} 项</span>
        <Button variant="primary" isPending={creating} isDisabled={!props.canWrite || !props.onPreviewAnalysisScope} onPress={() => void previewAnalysis('marked')}>提炼知识</Button>
      </div> : null}
      </>}
      {props.analysisOnly ? <InspectorSavedScopes props={props} state={analysisState} pendingIds={pendingIds} run={run} /> : null}
      {error ? <p className={styles.versionError} role="alert">{error}</p> : null}
      {!props.analysisOnly && props.knowledgeWriteDisabledReason ? <p className={styles.emptyPanel}>{props.knowledgeWriteDisabledReason}</p> : null}
      <AnnotationDetailDialog props={props} details={details} pendingIds={pendingIds} run={run} />
      {analysis ? <AnalysisScopeDialog key={analysis.scopeKey} analysis={analysis} onSave={props.onCreateAnalysisScope}
        startDisabledReason={task.pending ? '已有任务请求尚未完成，请先查询任务结果，再开始新的范围。' : undefined}
        onSaved={() => setScopeRefresh(value => value + 1)} onClose={() => setAnalysis(null)}
        onStart={input => { setAnalysis(null); void task.start(input); }} /> : null}
      <KnowledgeExtractionTaskPanel task={task} onOpenCandidate={props.onOpenKnowledgeItem} />
    </section>
  );
}
