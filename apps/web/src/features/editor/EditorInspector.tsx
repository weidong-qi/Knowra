import { useEffect, useMemo, useRef, useState } from 'react';
import { IconButton } from '../../components/ui/button';
import { Tabs, type TabsItem } from '../../components/ui/collection';
import { CloseIcon } from '../../components/icons/knowra';
import { extractInspectorOutline, getDocumentStats, resolveInspectorRelations, resolveNoteTags } from './editorInspectorModel';
import { ResponsivePanel } from '../../components/ui/overlay/ResponsivePanel';
import { VersionHistoryPanel } from './VersionHistoryPanel';
import { OrganizeNoteDialog } from './OrganizeNoteDialog';
import { TagPickerDialog } from '../tags';
import { InfoPanel, OutlinePanel, LinksPanel } from './inspector/InspectorReadPanels';
import { AnnotationPanel } from './inspector/AnnotationPanel';
import { countTagUsage } from '../tags/tagUsage';
import type { EditorInspectorProps } from './inspector/types';
export type { EditorInspectorProps } from './inspector/types';
import styles from './EditorInspector.module.css';

const inspectorTabs: TabsItem[] = [
  { id: 'info', label: '信息' },
  { id: 'outline', label: '大纲' },
  { id: 'links', label: '链接' },
  { id: 'annotations', label: '标注' },
  { id: 'versions', label: '记录' },
  { id: 'ai', label: 'AI' }
];

export function EditorInspector(props: EditorInspectorProps) {
  const [selectedTab, setSelectedTab] = useState('info');
  const [compact, setCompact] = useState(() => window.matchMedia?.('(max-width: 1100px), (any-pointer: coarse)').matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.('(max-width: 1100px), (any-pointer: coarse)');
    if (!query) return;
    const update = () => setCompact(query.matches);
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const modal = compact && !props.nativeTitlebar;
  const [tagEditorOpen, setTagEditorOpen] = useState(false);
  const tagTriggerRef = useRef<HTMLButtonElement>(null);
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const usageCounts = useMemo(() => countTagUsage(props.tags, props.notes), [props.tags, props.notes]);
  const tags = useMemo(() => resolveNoteTags(props.note, props.tags), [props.note, props.tags]);
  const relations = useMemo(() => {
    const local = resolveInspectorRelations(props.note, props.notes);
    const outgoing = props.linkedNotesLoading ? local.outgoing : props.linkedNotes;
    const relatedIds = new Set([...outgoing, ...local.backlinks].map((item) => item.id));
    return {
      ...local,
      outgoing,
      related: props.notes.filter((item) => !item.deleted && item.id !== props.note.id && relatedIds.has(item.id))
    };
  }, [props.linkedNotes, props.linkedNotesLoading, props.note, props.notes]);
  const outline = useMemo(
    () => props.open ? extractInspectorOutline(props.markdown) : [],
    [props.markdown, props.open]
  );
  const stats = useMemo(
    () => props.open ? getDocumentStats(props.markdown) : { characterCount: 0, readingMinutes: 0 },
    [props.markdown, props.open]
  );

  useEffect(() => {
    if (props.overlappingAnnotationIds?.length) setSelectedTab('annotations');
  }, [props.overlappingAnnotationIds]);

  const inspector = (
    <aside
      className={styles.inspector}
      data-open={props.open || undefined}
      data-native-titlebar={props.nativeTitlebar || undefined}
      aria-label="文档检查器"
      aria-hidden={!props.open}
    >
      <header className={styles.header}>
        <h2>文档检查器</h2>
        <IconButton aria-label="关闭文档检查器" onPress={props.onClose}>
          <CloseIcon size={18} />
        </IconButton>
      </header>
      <Tabs
        className={styles.tabs}
        aria-label="检查器视图"
        items={inspectorTabs}
        selectedKey={selectedTab}
        onSelectionChange={(key) => setSelectedTab(String(key))}
      >
        {(item) => (
          <div className={styles.panel} data-panel={String(item.id)}>
            {item.id === 'info' ? (
              <InfoPanel
                {...props}
                assignedTags={tags}
                relations={relations}
                stats={stats}
                tagTriggerRef={tagTriggerRef}
                onEditTags={() => setTagEditorOpen(true)}
                onOrganize={() => setOrganizeOpen(true)}
              />
            ) : null}
            {item.id === 'outline' ? (
              <OutlinePanel outline={outline} onNavigate={props.onNavigateHeading} />
            ) : null}
            {item.id === 'links' ? (
              <LinksPanel relations={relations} loading={props.linkedNotesLoading} onOpenNote={props.onOpenNote}
                noteLinks={props.noteLinkRelations} linksLoading={props.noteLinkRelationsLoading} error={props.noteLinkRelationsError}
                onOpenOccurrence={props.onOpenLinkedOccurrence} onOpenLinkedNote={props.onOpenLinkedNote} />
            ) : null}
            {item.id === 'annotations' ? (
              <AnnotationPanel key={props.note.id} {...props} canWrite={props.canWrite && props.extendedWritesEnabled !== false} />
            ) : null}
            {item.id === 'versions' ? (
              <VersionHistoryPanel
                key={props.note.id}
                note={props.note}
                markdown={props.markdown}
                canWrite={props.canWrite}
                onListVersionPage={props.onListVersionPage}
                onPreviewVersionPrune={props.onPreviewVersionPrune}
                onRestoreVersion={props.onRestoreVersion}
                onSaveVersionAs={props.onSaveVersionAs}
                onListVersions={props.onListVersions}
                onGetVersion={props.onGetVersion}
              />
            ) : null}
            {item.id === 'ai' ? <AnnotationPanel key={`ai-${props.note.id}`} {...props} canWrite={props.canWrite && props.extendedWritesEnabled !== false} analysisOnly /> : null}
          </div>
        )}
      </Tabs>
      {/* 标签草稿和异步操作归属当前笔记，切换笔记必须创建独立会话。 */}
      <TagPickerDialog
        key={props.note.id}
        isOpen={tagEditorOpen}
        triggerRef={tagTriggerRef}
        tags={props.tags}
        groups={props.tagGroups ?? []}
        canWrite={props.canWrite}
        selectedTagIds={props.note.tagIds}
        usageCounts={usageCounts}
        onOpenChange={setTagEditorOpen}
        onSave={props.onSetTags}
        onCreateTag={props.onCreateTag ?? (() => Promise.reject(new Error('当前模式不支持新建标签')))}
        onUpdateTag={props.onUpdateTag}
        onDeleteTag={props.onDeleteTag}
        onMergeTags={props.onMergeTags}
        onOpenFullManager={props.onOpenTagManager}
      />
      <OrganizeNoteDialog
        note={props.note}
        foldersById={props.foldersById}
        isOpen={organizeOpen}
        onOpenChange={setOrganizeOpen}
        onSave={props.onOrganizeNote}
      />
    </aside>
  );
  return <ResponsivePanel title="文档检查器" modal={modal} className={styles.inspectorDialog}
    isOpen={props.open} onClose={props.onClose}>
    {inspector}
  </ResponsivePanel>;
}
