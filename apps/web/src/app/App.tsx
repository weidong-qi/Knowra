import { ScopedAppearanceProvider } from '../components/ui/overlay';
import { NotesIndexAppearanceControls, notesIndexAppearanceProps } from '../features/notes/NotesIndexAppearance';
import { useNotesIndexAppearance } from '../features/notes/notesIndexAppearanceModel';
import { RecoveryDraftNotice } from '../features/editor/RecoveryDraftNotice';
import { BudgetAlertBanner } from '../features/assistant/BudgetAlertBanner';
import { useMaterialsRoute } from './useMaterialsRoute';
import { LocalSyncControl } from '../features/sync/LocalSyncControl';
import { buildIndexPath, indexRoute } from '../features/notes/notesIndexNavigation';
// V4-05 App
//
// 应用入口：根据当前 pathname 渲染 HomeView / PlaceholderView / ComponentShowcase。
// 1. AppShell 提供 layout + ModuleRail + StatusBar + MobileTabs；
// 2. SearchCommand 由 ⌘/Ctrl K 唤起；
// 3. 全局快捷键 ⌘/Ctrl + / 回主页，⌘/Ctrl + Shift + ↑/↓ 切换工作域；
// 4. HomeView 在 / 路由加载数据；/showcase 路由始终直接展示组件展台（不发 API 请求）。

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from './router';
import { useAppCommandSearch } from './useAppCommandSearch';
import { useAppStore, useAppStoreApi } from '../store/AppStoreProvider';
import { AppShell } from '../shell/AppShell';
import { deriveStatusPath } from '../shell/statusPath';
import { SearchCommand } from '../shell/SearchCommand';
import { useGlobalShortcuts } from '../shell/useGlobalShortcuts';
import { NotesContextSidebar } from '../features/notes';
import { EntryDragDropProvider } from '../features/notes/EntryDragDrop';
import { CreateEntryDialog } from '../features/notes';
import { getEditorNoteId } from '../features/editor/editorRoute';
import { EditorTabs } from '../features/editor/EditorTabs';
import {
  applyEditorViewAction,
  describeEditorViewAction,
  getEffectiveEditorViewState,
  initialEditorViewState,
  type EditorViewAction
} from '../features/editor/editorViewState';
import { PRIMARY_DOMAINS, UTILITY_ITEMS } from '../shell/ModuleRail';
import { WORK_DOMAINS, type WorkDomain } from '../store/types';
import { AppRoutes, DOMAIN_INFO } from './AppRoutes';
import { applyAppPreferences, readAppPreferences } from '../features/settings/preferences';
import styles from './App.module.css';

export function App() {
  useMaterialsRoute();
  const location = useLocation();
  const navigate = useNavigate();
  const storeActiveDomain = useAppStore((state) => state.navigation.activeWorkDomain);
  const setActiveWorkDomain = useAppStore((state) => state.setActiveWorkDomain);
  const loadWorkspace = useAppStore((state) => state.loadWorkspace);
  const retryWorkspace = useAppStore((state) => state.retryWorkspace);
  const canWriteWorkspace = useAppStore((state) => state.canWriteWorkspace);
  const dataMode = useAppStore((state) => state.dataMode);
  const saveState = useAppStore((state) => state.saveState);
  const saveError = useAppStore((state) => state.saveError);
  const persistenceMode = useAppStore((state) => state.persistenceMode);
  const editorSaveError = useAppStore((state) => state.editorSaveError);
  const editorHasLocalChanges = useAppStore((state) => state.editorHasLocalChanges);
  const workspaceError = useAppStore((state) => state.workspaceError);
  const notes = useAppStore((state) => state.serverData.notes);
  const openNoteTabIds = useAppStore((state) => state.navigation.openNoteTabs);
  const storeApi = useAppStoreApi();
  const indexScope = useAppStore(state => state.notesIndex.scope);
  const indexFolderId = useAppStore(state => state.navigation.selectedFolderId);
  const indexFolders = useAppStore(state => state.serverData.foldersById);

  const [searchOpen, setSearchOpen] = useState(false);
  const [createNoteOpen, setCreateNoteOpen] = useState(false);
  const [liveAnnouncement, setLiveAnnouncement] = useState('');
  const [preferences, setPreferences] = useState(readAppPreferences);
  const [editorView, setEditorView] = useState(() => ({
    ...initialEditorViewState,
    showLeftSidebar: readNotesSidebarPreference()
  }));
  const previousPathRef = useRef(location.pathname);

  useEffect(() => {
    writeNotesSidebarPreference(editorView.showLeftSidebar);
  }, [editorView.showLeftSidebar]);

  useEffect(() => {
    applyAppPreferences(preferences);
  }, [preferences]);

  const shouldLoadWorkspace = location.pathname === '/' || location.pathname.startsWith('/assistant') || location.pathname.startsWith('/materials') || location.pathname.startsWith('/knowledge') || location.pathname.startsWith('/training');
  // 仅在 / 路由（非 /showcase）触发 workspace 加载。
  useEffect(() => {
    if (!shouldLoadWorkspace) return;
    void loadWorkspace();
  }, [loadWorkspace, shouldLoadWorkspace]);

  // URL 是工作域真源：支持可分享链接、前进后退和未上线模块的真实门禁页。
  useEffect(() => {
    if (location.pathname.startsWith('/showcase') || location.pathname === '/settings' || location.pathname.startsWith('/assistant')) return;
    const segment = location.pathname.split('?')[0].replace(/^\//, '').split('/')[0];
    const routeDomain: WorkDomain = !segment || segment === 'materials'
      ? 'materials'
      : WORK_DOMAINS.includes(segment as WorkDomain)
        ? segment as WorkDomain
        : 'materials';
    if (routeDomain !== storeActiveDomain) setActiveWorkDomain(routeDomain);
  }, [storeActiveDomain, location.pathname, setActiveWorkDomain]);

  useEffect(() => {
    if (previousPathRef.current === location.pathname) return;
    previousPathRef.current = location.pathname;
    const stage = document.getElementById('feature-stage');
    stage?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    stage?.focus({ preventScroll: true });
  }, [location.pathname]);

  function handleReturnHome() {
    setActiveWorkDomain('materials');
    navigate('/');
    setLiveAnnouncement('已返回主页');
  }

  // 全局快捷键
  useGlobalShortcuts({
    onOpenSearch: () => setSearchOpen(true),
    onOpenCreate: canWriteWorkspace() ? () => setCreateNoteOpen(true) : undefined,
    onReturnHome: () => {
      setActiveWorkDomain('materials');
      navigate('/');
      setLiveAnnouncement('已返回主页');
    },
    onCycleDomain: (direction) => {
      const availableDomains = [...PRIMARY_DOMAINS, ...UTILITY_ITEMS]
        .filter((item) => item.available)
        .map((item) => item.id);
      const current = storeApi.getState().navigation.activeWorkDomain;
      const currentIndex = Math.max(0, availableDomains.indexOf(current));
      const nextIndex = (currentIndex + direction + availableDomains.length) % availableDomains.length;
      const nextDomain = availableDomains[nextIndex];
      if (!nextDomain || nextDomain === current) {
        setLiveAnnouncement('当前只有资料工作域可用');
        return;
      }
      setActiveWorkDomain(nextDomain);
      navigate(`/${nextDomain}`);
      setLiveAnnouncement(`已切换到 ${DOMAIN_INFO[nextDomain].title}`);
    }
  });

  // SearchCommand 数据源：每个命中项决定自己的目标路径。
  // - 动作（action:home）→ 主页（/）；
  // - 笔记 → 编辑页；标签 → 笔记索引页，由应用搜索适配同步索引筛选与选中项。
  const { hits: searchHits, commandSearch } = useAppCommandSearch({
    pathname: location.pathname,
    onSelect: (announcement, path) => {
      navigate(path);
      setLiveAnnouncement(announcement);
    }
  });

  function handleSelectDomain(domain: WorkDomain) {
    const available = [...PRIMARY_DOMAINS, ...UTILITY_ITEMS].find((item) => item.id === domain)?.available ?? false;
    if (!available) {
      setLiveAnnouncement(`${DOMAIN_INFO[domain].title} 尚未上线`);
      return;
    }
    setActiveWorkDomain(domain);
    // 每个工作域都有独立路由：资料 → /materials，知识 → /knowledge ……
    // 主页（/）只由左上角 Logo 与全局快捷键 ⌘/ 进入，
    // 不再由"资料"按钮带回，避免主页入口语义重叠。
    navigate(`/${domain}`);
    setLiveAnnouncement(`已切换到 ${DOMAIN_INFO[domain].title}`);
  }

  const routeDomain = useMemo<WorkDomain>(() => {
    const path = location.pathname.split('?')[0].replace(/^\//, '').split('/')[0];
    if (!path || path === 'materials') return 'materials';
    if (WORK_DOMAINS.includes(path as WorkDomain)) return path as WorkDomain;
    if (path === 'showcase') return storeActiveDomain;
    return storeActiveDomain;
  }, [location.pathname, storeActiveDomain]);

  const canWrite = canWriteWorkspace();
  const routePathname = location.pathname.split('?')[0];
  const isShowcaseActive = routePathname.startsWith('/showcase');
  const isSettingsActive = routePathname === '/settings';
  const isAssistantActive = routePathname === '/assistant';
  const isHome = routePathname === '/';
  const isNotesIndex = routePathname === '/materials';
  const isTagManager = routePathname === '/materials/tags';
  const isKnowledgeWorkspace = routeDomain === 'knowledge';
  const editorNoteId = getEditorNoteId(location.pathname);
  const isNoteEditor = editorNoteId !== null;
  const effectiveEditorView = useMemo(() => getEffectiveEditorViewState(editorView), [editorView]);
  const editorNote = editorNoteId ? notes.find((note) => note.id === editorNoteId) ?? null : null;
  const openNoteTabs = openNoteTabIds
    .map((id) => notes.find((note) => note.id === id && !note.deleted))
    .filter((note): note is NonNullable<typeof note> => Boolean(note));
  // 主页（/）不属于任何工作域的子页面：左轨不应高亮任何模块入口；
  // 笔记索引页（/materials）才是"资料"工作域的着陆页。
  const activeDomain: WorkDomain | null =
    isShowcaseActive || isSettingsActive || isAssistantActive || isHome ? null : routeDomain;

  // StatusBar 位置路径只描述当前路由 surface，不读取后台 selection。
  const statusPath = isAssistantActive ? [{ id: 'assistant', label: 'AI 助手', current: true }] : isNotesIndex ? buildIndexPath(indexScope, indexFolderId, indexFolders, navigate) : deriveStatusPath({
    pathname: location.pathname,
    routeDomain,
    onNavigateHome: () => navigate('/'),
    onNavigateMaterials: () => navigate('/materials'),
    noteTitle: editorNote?.title
  });

  function openNote(noteId: string) {
    storeApi.getState().selectNote(noteId);
    navigate(`/materials/notes/${encodeURIComponent(noteId)}`);
    const title = storeApi.getState().serverData.notes.find((note) => note.id === noteId)?.title || '无标题笔记';
    setLiveAnnouncement(`已打开笔记：${title}`);
  }

  function openNotesIndex() {
    const state = storeApi.getState();
    navigate(indexRoute(state.notesIndex.scope, state.navigation.selectedFolderId, state.notesIndex.selectedTagId));
    setLiveAnnouncement('已打开笔记索引');
  }

  function handleEditorViewAction(action: EditorViewAction) {
    if (!isNoteEditor) {
      setLiveAnnouncement('视图功能仅在笔记编辑页面可用');
      return;
    }
    setLiveAnnouncement(describeEditorViewAction(effectiveEditorView, action));
    setEditorView((current) => applyEditorViewAction(current, action));
  }

  const indexAppearance = useNotesIndexAppearance();
  const showNotesContextSidebar = (isNotesIndex && editorView.showLeftSidebar) || (isNoteEditor && effectiveEditorView.showLeftSidebar);

  return (
    <EntryDragDropProvider><ScopedAppearanceProvider value={notesIndexAppearanceProps(indexAppearance)}>
      <AppShell
      appearance={notesIndexAppearanceProps(indexAppearance)}
      toolbarAccessories={<NotesIndexAppearanceControls />}
      navigationKey={location.pathname}
      activeDomain={activeDomain}
      contextSidebarOpen={showNotesContextSidebar}
      contextSidebar={isNotesIndex || isNoteEditor ? (
        <NotesContextSidebar onOpenNote={openNote} onOpenIndex={openNotesIndex} onOpenSearch={() => setSearchOpen(true)} />
      ) : undefined}
      stageMode={isNoteEditor || isNotesIndex || isTagManager || isSettingsActive || isAssistantActive || isKnowledgeWorkspace || routeDomain === 'training' || routeDomain === 'task-workspaces' ? 'workspace' : 'default'}
      desktopTitlebarEditor={isNoteEditor && Boolean(editorNote)}
      desktopTitlebarTabs={openNoteTabs.length > 0 ? <EditorTabs
        notes={openNoteTabs}
        activeNoteId=""
        canWrite={canWrite}
        windowTitlebar
        onOpenNote={openNote}
        onCloseNote={(noteId) => { storeApi.getState().closeNoteTab(noteId); }}
        onCloseOtherNotes={(noteId) => { storeApi.getState().closeOtherNoteTabs(noteId); }}
        onReorderNotes={(sourceNoteId, targetNoteId) => { storeApi.getState().reorderNoteTabs(sourceNoteId, targetNoteId); }}
        onCopyTabPath={(note) => {
          const folder = note.folderId ? indexFolders[note.folderId] : null;
          const path = [folder?.name, note.title || '无标题笔记'].filter(Boolean).join(' / ');
          void navigator.clipboard.writeText(path)
            .then(() => setLiveAnnouncement(`已复制路径：${path}`))
            .catch(() => setLiveAnnouncement('复制路径失败，请检查剪贴板权限'));
        }}
        onCreateNote={() => setCreateNoteOpen(true)}
      /> : undefined}
      focusMode={isNoteEditor && effectiveEditorView.mode === 'focus'}
      onSelectDomain={handleSelectDomain}
      onReturnHome={handleReturnHome}
      onOpenSearch={() => setSearchOpen(true)}
      onOpenSettings={() => { navigate('/settings'); setLiveAnnouncement('已打开设置'); }}
      onOpenAssistant={() => { navigate(isNoteEditor && editorNoteId ? `/assistant?noteId=${encodeURIComponent(editorNoteId)}` : '/assistant'); setLiveAnnouncement('已打开 AI 助手'); }}
      isSettingsActive={isSettingsActive}
      isAssistantActive={isAssistantActive}
      statusbar={{
        path: statusPath,
        saveState: isSettingsActive || isAssistantActive || isShowcaseActive ? 'idle' : editorSaveError ? 'error' : editorHasLocalChanges && saveState !== 'error' ? 'saving' : saveState,
        saveError: editorSaveError ?? saveError,
        persistenceMode,
        savedAt: editorNote?.updatedAt,
        dataMode,
        showDataMode: !isSettingsActive && !isAssistantActive && !isShowcaseActive,
        dataModeNote: persistenceMode === 'desktop-local' ? <LocalSyncControl compact /> : workspaceError && dataMode !== 'api' ? <span>请稍后重试</span> : undefined,
        panels: !isNoteEditor && !isNotesIndex ? [] : [
          {
            id: 'sidebar' as const,
            label: '侧栏',
            active: (isNotesIndex && editorView.showLeftSidebar) || (isNoteEditor && effectiveEditorView.showLeftSidebar),
            onToggle: () => {
              if (isNotesIndex) {
                setLiveAnnouncement(editorView.showLeftSidebar ? '已隐藏左侧目录区' : '已显示左侧目录区');
                setEditorView((current) => applyEditorViewAction(current, 'toggle-left-sidebar'));
                return;
              }
              if (!isNoteEditor) {
                setLiveAnnouncement('侧栏仅在笔记索引和编辑页面可切换');
                return;
              }
              handleEditorViewAction('toggle-left-sidebar');
            }
          },
          {
            id: 'inspector' as const,
            label: '检查器',
            active: isNoteEditor && effectiveEditorView.showRightSidebar,
            onToggle: () => {
              if (!isNoteEditor) {
                setLiveAnnouncement('检查器仅在笔记编辑页面可用');
                return;
              }
              handleEditorViewAction('toggle-right-sidebar');
            }
          },
          {
            id: 'focus' as const,
            label: '专注模式',
            active: isNoteEditor && effectiveEditorView.mode === 'focus',
            onToggle: () => {
              if (!isNoteEditor) {
                setLiveAnnouncement('专注模式仅在笔记编辑页面可用');
                return;
              }
              handleEditorViewAction('toggle-focus');
            }
          }
        ].filter(panel => isNoteEditor || panel.id === 'sidebar')
      }}
      mobileTabs
      liveAnnouncement={liveAnnouncement}
    >
      <div className={`${styles.route} ${isNoteEditor || isNotesIndex || isTagManager || isSettingsActive || isAssistantActive || isKnowledgeWorkspace || routeDomain === 'training' || routeDomain === 'task-workspaces' ? styles.routeWorkspace : ''}`}>
        <RecoveryDraftNotice onOpenNote={openNote} />
        <BudgetAlertBanner />
        <AppRoutes
          pathname={location.pathname}
          routeDomain={routeDomain}
          onRetry={retryWorkspace}
          canWrite={canWrite}
          onOpenMaterials={() => navigate('/materials')}
          statusPath={statusPath}
          editorNoteId={editorNoteId}
          editorView={effectiveEditorView}
          onEditorViewAction={handleEditorViewAction}
          onOpenNote={openNote}
          onOpenSearch={() => setSearchOpen(true)}
          onOpenCreate={canWrite ? () => setCreateNoteOpen(true) : undefined}
          onOpenSchedule={() => setLiveAnnouncement('日程将在后续版本接入')}
          preferences={preferences}
          onPreferencesChange={setPreferences}
          sidebarOpen={editorView.showLeftSidebar}
          onSidebarOpenChange={(open) => setEditorView((current) => ({ ...current, showLeftSidebar: open }))}
          onSelectNote={(noteId) => openNote(noteId)}
        />
      </div>
      <SearchCommand
        isOpen={searchOpen}
        onOpenChange={setSearchOpen}
        hits={searchHits}
        commandSearch={commandSearch}
      />
      <CreateEntryDialog
        mode={createNoteOpen ? 'note' : null}
        parentFolderId={isNotesIndex || isNoteEditor ? storeApi.getState().navigation.selectedFolderId : null}
        onOpenChange={setCreateNoteOpen}
        onCreateNote={async (folderId, title) => {
          const createdId = await storeApi.getState().createNote(folderId, title);
          openNote(createdId);
          return createdId;
        }}
        onCreateFolder={storeApi.getState().createFolder}
      />
      </AppShell>
    </ScopedAppearanceProvider></EntryDragDropProvider>
  );
}

export function AppRoot() {
  return <App />;
}

const NOTES_SIDEBAR_PREFERENCE_KEY = 'knowra:notes-sidebar-open';

function readNotesSidebarPreference(): boolean {
  try { return localStorage.getItem(NOTES_SIDEBAR_PREFERENCE_KEY) !== 'false'; }
  catch { return true; }
}

function writeNotesSidebarPreference(open: boolean): void {
  try { localStorage.setItem(NOTES_SIDEBAR_PREFERENCE_KEY, String(open)); }
  catch { /* 本地存储不可用时仍可在当前页面切换。 */ }
}
