import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import type { PathSegment } from '../shell/path';
import { useNavigate } from './router';
import { useAppStore } from '../store/AppStoreProvider';
import { LoadingState } from '../components/ui/status';
import { Button } from '../components/ui/button/Button';
import { NoteEditorView } from '../features/editor';
import {
  CreateEntryDialog,
  DeleteTreeEntryDialog,
  NotesIndexView,
  type CreateMode
} from '../features/notes';
import { MarkdownImportDialog } from '../features/editor/MarkdownImportDialog';
import type { EditorViewAction, EffectiveEditorViewState } from '../features/editor/editorViewState';
import { HomeView } from '../views/HomeView';
import { PlaceholderView } from '../views/PlaceholderView';
import type { WorkDomain } from '../store/types';
import { TagManagerView } from '../features/tags';
import { SpaceManagerView } from '../features/spaces/SpaceManagerView';
import type { Annotation } from '@study-accelerator/web-core';
import { KnowledgeStage } from './KnowledgeStage';
import { TrainingWorkspaceView } from '../features/training/TrainingWorkspaceView';
import { CreateKnowledgeCandidateDialog } from '../features/knowledge/CreateKnowledgeCandidateDialog';
import { workspaceCapabilities } from '../store/workspaceCapabilities';
import { SettingsView } from '../features/settings/SettingsView';
import type { AppPreferences } from '../features/settings/preferences';

const TaskWorkspacesView = lazy(async () => ({ default: (await import('../features/task-workspaces/TaskWorkspacesView')).TaskWorkspacesView }));

const AssistantView = lazy(async () => {
  const module = await import('../features/assistant/AssistantView');
  return { default: module.AssistantView };
});

const ComponentShowcase = lazy(async () => {
  const module = await import('../components/ui/showcase');
  return { default: module.ComponentShowcase };
});

const IconLibraryView = lazy(async () => {
  const module = await import('../components/ui/showcase');
  return { default: module.IconLibraryView };
});

export interface DomainDescriptor {
  title: string;
  description: string;
}

export const DOMAIN_INFO: Record<WorkDomain, DomainDescriptor> = {
  'task-workspaces': { title: '任务工作区', description: '协作文档、任务执行与人工验收。' },
  materials: { title: '资料工作区', description: '按目录组织 Markdown 笔记，用标签串联主题。' },
  knowledge: { title: '知识库', description: '整理知识候选、人工确认并追溯原文来源。' },
  training: { title: '试题库', description: '学习目标、考试配置、考点与题目的管理。' },
  learning: { title: '执行', description: '待办、打卡与习惯追踪（V4-08 接入）。' },
  profile: { title: '我的', description: '工作区与个人设置。' }
};

export interface AppRoutesProps {
  pathname: string;
  routeDomain: WorkDomain;
  statusPath: PathSegment[];
  editorNoteId: string | null;
  editorView: EffectiveEditorViewState;
  canWrite: boolean;
  onRetry(): Promise<void>;
  onEditorViewAction(action: EditorViewAction): void;
  onOpenNote(noteId: string): void;
  onSelectNote(noteId: string, title: string): void;
  onOpenMaterials(): void;
  onOpenSearch(): void;
  onOpenCreate?(): void;
  onOpenSchedule(): void;
  preferences: AppPreferences;
  onPreferencesChange(preferences: AppPreferences): void;
  sidebarOpen: boolean;
  onSidebarOpenChange(open: boolean): void;
}

export function AppRoutes(props: AppRoutesProps) {
  const routePath = props.pathname.split('?')[0];
  if (routePath === '/showcase/icons') {
    return <Suspense fallback={<LoadingState label="正在加载图标库…" />}><IconLibraryView /></Suspense>;
  }
  if (routePath === '/showcase') {
    return <Suspense fallback={<LoadingState label="正在加载组件展台…" />}><ComponentShowcase /></Suspense>;
  }
  if (routePath === '/settings') return <SettingsView
    preferences={props.preferences}
    onPreferencesChange={props.onPreferencesChange}
    sidebarOpen={props.sidebarOpen}
    onSidebarOpenChange={props.onSidebarOpenChange}
  />;
  if (routePath === '/assistant') return <ErrorBoundary key={routePath} fallbackRender={() => (
    <section aria-labelledby="assistant-error-title" style={{ padding: '2rem' }}>
      <h1 id="assistant-error-title">AI 助手暂时不可用</h1>
      <p role="alert">助手界面加载或运行失败，笔记仍可继续使用。</p>
      <Button onPress={() => window.location.reload()}>重试助手</Button>
      <Button variant="ghost" onPress={props.onOpenMaterials}>返回笔记</Button>
    </section>
  )}>
    <Suspense fallback={<LoadingState label="正在加载 AI 助手…" />}>
      <AssistantView pathname={props.pathname} onOpenNote={props.onOpenNote} />
    </Suspense>
  </ErrorBoundary>;
  if (props.routeDomain === 'task-workspaces') return <ErrorBoundary fallbackRender={({ resetErrorBoundary }) => <section aria-label="任务工作区加载失败"><p role="alert">任务工作区暂时不可用，私人笔记不受影响。</p><Button onPress={resetErrorBoundary}>重试任务工作区</Button></section>}><Suspense fallback={<LoadingState label="正在加载任务工作区…" />}><TaskWorkspacesView /></Suspense></ErrorBoundary>;
  if (props.routeDomain === 'knowledge') return <KnowledgeStage pathname={props.pathname} onOpenNote={props.onOpenNote} />;
  if (props.routeDomain === 'training') return <TrainingWorkspaceView />;
  if (props.routeDomain !== 'materials') return <PlaceholderStage domain={props.routeDomain} />;
  if (routePath === '/materials/tags') return <TagManagerView />;
  if (routePath === '/materials/spaces') return <SpaceManagerView />;
  if (routePath === '/materials') {
    return <NotesIndexView path={props.statusPath} onOpenNote={props.onOpenNote} />;
  }
  if (props.editorNoteId) {
    return (
      <NoteEditorStage
        noteId={props.editorNoteId}
        editorView={props.editorView}
        canWrite={props.canWrite}
        onEditorViewAction={props.onEditorViewAction}
        onOpenNote={props.onOpenNote}
      />
    );
  }
  return (
    <HomeStage
      onRetry={props.onRetry}
      canWrite={props.canWrite}
      onSelectNote={props.onSelectNote}
      onOpenMaterials={props.onOpenMaterials}
      onOpenSearch={props.onOpenSearch}
      onOpenCreate={props.onOpenCreate}
      onOpenSchedule={props.onOpenSchedule}
    />
  );
}

function NoteEditorStage({ noteId, editorView, canWrite, onEditorViewAction, onOpenNote }: {
  noteId: string;
  editorView: EffectiveEditorViewState;
  canWrite: boolean;
  onEditorViewAction(action: EditorViewAction): void;
  onOpenNote(noteId: string): void;
}) {
  const serverData = useAppStore((state) => state.serverData);
  const navigation = useAppStore((state) => state.navigation);
  const selectNote = useAppStore((state) => state.selectNote);
  const closeNoteTab = useAppStore((state) => state.closeNoteTab);
  const closeOtherNoteTabs = useAppStore((state) => state.closeOtherNoteTabs);
  const reorderNoteTabs = useAppStore((state) => state.reorderNoteTabs);
  const createNote = useAppStore((state) => state.createNote);
  const duplicateNote = useAppStore((state) => state.duplicateNote);
  const importMarkdownNotes = useAppStore((state) => state.importMarkdownNotes);
  const createFolder = useAppStore((state) => state.createFolder);
  const renameNote = useAppStore((state) => state.renameNote);
  const loadNoteContent = useAppStore((state) => state.loadNoteContent);
  const saveNoteContent = useAppStore((state) => state.saveNoteContent);
  const setEditorHasLocalChanges = useAppStore((state) => state.setEditorHasLocalChanges);
  const persistenceMode = useAppStore((state) => state.persistenceMode);
  const deleteNote = useAppStore((state) => state.deleteNote);
  const setNoteFavorite = useAppStore((state) => state.setNoteFavorite);
  const setNoteTags = useAppStore((state) => state.setNoteTags);
  const createTag = useAppStore((state) => state.createTag);
  const updateTag = useAppStore((state) => state.updateTag);
  const deleteTag = useAppStore((state) => state.deleteTag);
  const mergeTags = useAppStore((state) => state.mergeTags);
  const listNoteVersions = useAppStore((state) => state.listNoteVersions);
  const listNoteVersionPage = useAppStore((state) => state.listNoteVersionPage);
  const previewNoteVersionPrune = useAppStore((state) => state.previewNoteVersionPrune);
  const saveNoteVersionAs = useAppStore((state) => state.saveNoteVersionAs);
  const getNoteVersion = useAppStore((state) => state.getNoteVersion);
  const organizeNote = useAppStore((state) => state.organizeNote);
  const listNoteAttachments = useAppStore((state) => state.listNoteAttachments);
  const uploadNoteAttachment = useAppStore((state) => state.uploadNoteAttachment);
  const renameNoteAttachment = useAppStore((state) => state.renameNoteAttachment);
  const deleteNoteAttachment = useAppStore((state) => state.deleteNoteAttachment);
  const inspectAttachmentDeletion = useAppStore(state => state.inspectAttachmentDeletion);
  const verifyNoteAttachment = useAppStore(state => state.verifyNoteAttachment);
  const restoreNoteAttachment = useAppStore(state => state.restoreNoteAttachment);
  const listAttachmentCleanup = useAppStore(state => state.listAttachmentCleanup);
  const retryAttachmentCleanup = useAppStore(state => state.retryAttachmentCleanup);
  const getLinkedNotes = useAppStore((state) => state.getLinkedNotes);
  const getNoteLinkRelations = useAppStore((state) => state.getNoteLinkRelations);
  const searchLinkNotes = useAppStore((state) => state.searchCommandNotes);
  const listAnnotations = useAppStore((state) => state.listAnnotations);
  const createAnnotation = useAppStore((state) => state.createAnnotation);
  const deleteAnnotation = useAppStore((state) => state.deleteAnnotation);
  const restoreAnnotation = useAppStore((state) => state.restoreAnnotation);
  const updateAnnotationAnchor = useAppStore((state) => state.updateAnnotationAnchor);
  const updateAnnotation = useAppStore((state) => state.updateAnnotation);
  const confirmAnnotationRange = useAppStore((state) => state.confirmAnnotationRange);
  const previewAnnotation = useAppStore((state) => state.previewAnnotation);
  const getAnnotationKnowledgeLinks = useAppStore((state) => state.getAnnotationKnowledgeLinks);
  const previewAnalysisScope = useAppStore((state) => state.previewAnalysisScope);
  const createAnalysisScope = useAppStore((state) => state.createAnalysisScope);
  const listAnalysisScopes = useAppStore((state) => state.listAnalysisScopes);
  const trashAnalysisScope = useAppStore((state) => state.trashAnalysisScope);
  const restoreAnalysisScope = useAppStore((state) => state.restoreAnalysisScope);
  const createAnnotationExclusion = useAppStore((state) => state.createAnnotationExclusion);
  const deleteAnnotationExclusion = useAppStore((state) => state.deleteAnnotationExclusion);
  const setStatusMessage = useAppStore((state) => state.setStatusMessage);
  const createKnowledgeCandidate = useAppStore(state => state.createKnowledgeCandidate);
  const [knowledgeSource, setKnowledgeSource] = useState<Annotation | null>(null);
  const canWriteKnowledge = canWrite && workspaceCapabilities(persistenceMode).writeKnowledge;
  const knowledgeContext = useRef<{ noteId: string; canWrite: boolean } | null>(null);
  knowledgeContext.current = { noteId, canWrite: canWriteKnowledge };
  useEffect(() => () => { knowledgeContext.current = null; }, []);
  const navigate = useNavigate();
  const [createMode, setCreateMode] = useState<CreateMode>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [favoritePending, setFavoritePending] = useState(false);
  const note = serverData.notes.find((item) => item.id === noteId && !item.deleted) ?? null;
  const folder = note?.folderId ? serverData.foldersById[note.folderId] ?? null : null;
  const openNotes = navigation.openNoteTabs
    .map((id) => serverData.notes.find((item) => item.id === id && !item.deleted))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  useEffect(() => {
    if (note && navigation.selectedNoteId !== note.id) selectNote(note.id);
  }, [navigation.selectedNoteId, note, selectNote]);

  useEffect(() => {
    if (note && !note.contentLoaded) void loadNoteContent(note.id).catch(() => undefined);
  }, [loadNoteContent, note]);

  return (
    <>
      <NoteEditorView
        onDraftStateChange={setEditorHasLocalChanges}
        extendedWritesEnabled={true}
        note={note}
        folder={folder}
        foldersById={serverData.foldersById}
        notes={serverData.notes}
        tags={serverData.tags}
        tagGroups={serverData.tagGroups}
        openNotes={openNotes}
        inspectorOpen={editorView.showRightSidebar}
        view={editorView}
        canWrite={canWrite}
        favoritePending={favoritePending}
        onToggleInspector={() => onEditorViewAction('toggle-right-sidebar')}
        onViewAction={onEditorViewAction}
        onOpenNote={onOpenNote}
        onReturnToList={() => navigate('/materials')}
        onCloseNote={(closingNoteId) => {
          const nextNoteId = closeNoteTab(closingNoteId);
          if (closingNoteId !== note?.id) return;
          if (nextNoteId) onOpenNote(nextNoteId);
          else navigate('/materials');
        }}
        onCloseOtherNotes={(remainingNoteId) => {
          closeOtherNoteTabs(remainingNoteId);
          onOpenNote(remainingNoteId);
        }}
        onReorderNotes={reorderNoteTabs}
        onCopyTabPath={(tabNote) => {
          const tabFolder = tabNote.folderId ? serverData.foldersById[tabNote.folderId] : null;
          const path = [tabFolder?.name, tabNote.title || '无标题笔记'].filter(Boolean).join(' / ');
          void navigator.clipboard.writeText(path)
            .then(() => setStatusMessage(`已复制路径：${path}`))
            .catch(() => setStatusMessage('复制路径失败，请检查剪贴板权限'));
        }}
        onCreateNote={() => setCreateMode('note')}
        onCreateFolder={() => setCreateMode('folder')}
        onImportMarkdown={() => setImportOpen(true)}
        onRenameNote={(title) => note ? renameNote(note.id, title) : Promise.resolve()}
        onSaveMarkdown={(targetNoteId, markdown, expectedUpdatedAt, baseMarkdown, annotationMapping) => (
          saveNoteContent(targetNoteId, markdown, expectedUpdatedAt, baseMarkdown, annotationMapping)
        )}
        onSaveAs={async () => {
          if (!note) return;
          const createdId = await duplicateNote(note.id);
          onOpenNote(createdId);
        }}
        onDeleteNote={() => setDeleteOpen(true)}
        onSetTags={(tagIds) => note ? setNoteTags(note.id, tagIds) : Promise.resolve()}
        onCreateTag={createTag}
        onUpdateTag={updateTag}
        onDeleteTag={deleteTag}
        onMergeTags={mergeTags}
        onOpenTagManager={() => navigate('/materials/tags')}
        onOpenTag={(tagId) => navigate(`/materials?tags=${encodeURIComponent(tagId)}&match=all`)}
        onListVersions={listNoteVersions}
        onListVersionPage={listNoteVersionPage}
        onPreviewVersionPrune={previewNoteVersionPrune}
        onSaveVersionAs={async version => { if (note) onOpenNote(await saveNoteVersionAs(note.id, version.id)); }}
        onGetVersion={getNoteVersion}
        onOrganizeNote={(input) => note ? organizeNote(note.id, input) : Promise.resolve()}
        onListAttachments={listNoteAttachments}
        onUploadAttachment={uploadNoteAttachment}
        onRenameAttachment={renameNoteAttachment}
        onDeleteAttachment={deleteNoteAttachment}
        attachmentActions={{ inspectAttachmentDeletion, verifyNoteAttachment, restoreNoteAttachment, listAttachmentCleanup, retryAttachmentCleanup }}
        onGetLinkedNotes={getLinkedNotes}
        onGetNoteLinkRelations={getNoteLinkRelations}
        onSearchLinkNotes={searchLinkNotes}
        onListAnnotations={listAnnotations}
        onCreateAnnotation={createAnnotation}
        onDeleteAnnotation={deleteAnnotation}
        onRestoreAnnotation={restoreAnnotation}
        onUpdateAnnotationAnchor={updateAnnotationAnchor}
        onUpdateAnnotation={updateAnnotation}
        onConfirmAnnotationRange={confirmAnnotationRange}
        onPreviewAnnotation={previewAnnotation}
        onGetAnnotationKnowledgeLinks={getAnnotationKnowledgeLinks}
        onCreateKnowledgeCandidate={canWriteKnowledge ? async annotation => {
          const current = await previewAnnotation(annotation.id);
          if (knowledgeContext.current?.noteId !== annotation.noteId || !knowledgeContext.current?.canWrite) throw new Error('已切换笔记或写入状态，请重新打开标注。');
          if (current.resolution.status !== 'resolved') throw new Error('标注来源已变化，请重新定位后创建知识候选。');
          setKnowledgeSource(current.annotation);
        } : undefined}
        onOpenKnowledgeItem={id => navigate(`/knowledge?item=${encodeURIComponent(id)}`)}
        onExtractWithAssistant={noteId => navigate(`/assistant?new=1&noteId=${encodeURIComponent(noteId)}&intent=extract`)}
        onPreviewAnalysisScope={previewAnalysisScope}
        onCreateAnalysisScope={createAnalysisScope}
        onListAnalysisScopes={listAnalysisScopes}
        onTrashAnalysisScope={trashAnalysisScope}
        onRestoreAnalysisScope={restoreAnalysisScope}
        onCreateAnnotationExclusion={createAnnotationExclusion}
        onDeleteAnnotationExclusion={deleteAnnotationExclusion}
        onFileStatus={setStatusMessage}
        onToggleFavorite={() => {
          if (!note || favoritePending) return;
          setFavoritePending(true);
          void setNoteFavorite(note.id, !note.favorite)
            .catch(() => undefined)
            .finally(() => setFavoritePending(false));
        }}
      />
      {knowledgeSource ? <CreateKnowledgeCandidateDialog
        source={knowledgeSource}
        canWrite={canWriteKnowledge}
        onClose={() => setKnowledgeSource(null)}
        onCreate={createKnowledgeCandidate}
        onCreated={item => { setKnowledgeSource(null); navigate(`/knowledge?item=${encodeURIComponent(item.id)}`); }}
      /> : null}
      <CreateEntryDialog
        mode={createMode}
        parentFolderId={folder?.id ?? null}
        onOpenChange={(open) => { if (!open) setCreateMode(null); }}
        onCreateNote={async (folderId, title) => {
          const createdId = await createNote(folderId, title);
          onOpenNote(createdId);
          return createdId;
        }}
        onCreateFolder={createFolder}
      />
      <MarkdownImportDialog
        isOpen={importOpen}
        folderName={folder?.name ?? '未整理'}
        onOpenChange={setImportOpen}
        onImport={async (sources) => {
          const result = await importMarkdownNotes(folder?.id ?? null, sources);
          onOpenNote(result.firstNoteId);
        }}
      />
      {note && deleteOpen ? (
        <DeleteTreeEntryDialog
          target={{ kind: 'note', id: note.id, name: note.title || '无标题笔记' }}
          onClose={() => setDeleteOpen(false)}
          onDelete={async () => {
            await deleteNote(note.id);
            navigate('/materials');
          }}
        />
      ) : null}
    </>
  );
}

function HomeStage({ onRetry, canWrite, onSelectNote, onOpenMaterials, onOpenSearch, onOpenCreate, onOpenSchedule }: {
  onRetry(): Promise<void>;
  canWrite: boolean;
  onSelectNote(noteId: string, title: string): void;
  onOpenMaterials(): void;
  onOpenSearch(): void;
  onOpenCreate?(): void;
  onOpenSchedule(): void;
}) {
  const loadState = useAppStore((state) => state.workspaceLoadState);
  const error = useAppStore((state) => state.workspaceError);
  const dataMode = useAppStore((state) => state.dataMode);
  const serverData = useAppStore((state) => state.serverData);
  const navigate = useNavigate();
  return (
    <HomeView
      loadState={loadState}
      error={error}
      dataMode={dataMode}
      notes={serverData.notes}
      folders={Object.values(serverData.foldersById)}
      tags={serverData.tags}
      isWritable={canWrite}
      onRetry={() => void onRetry()}
      onOpenMaterials={onOpenMaterials}
      onOpenKnowledge={() => navigate('/knowledge')}
      onOpenSearch={onOpenSearch}
      onOpenCreate={onOpenCreate}
      onOpenSchedule={onOpenSchedule}
      onSelectNote={onSelectNote}
    />
  );
}

function PlaceholderStage({ domain }: { domain: WorkDomain }) {
  const setActiveWorkDomain = useAppStore((state) => state.setActiveWorkDomain);
  const navigate = useNavigate();
  return (
    <PlaceholderView
      moduleId={domain}
      title={DOMAIN_INFO[domain].title}
      description={DOMAIN_INFO[domain].description}
      onReturnHome={() => {
        setActiveWorkDomain('materials');
        navigate('/');
      }}
    />
  );
}
