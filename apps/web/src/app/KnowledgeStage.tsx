import { LibraryIndexHeader } from '../components/workspace/LibraryIndex';
import { WorkspacePanel, WorkspacePanelBody } from '../components/workspace/WorkspacePanel';
import { KnowledgeIcon } from '../components/icons/knowra';
import { PathTrail } from '../shell/PathTrail';
import indexStyles from '../features/knowledge/KnowledgeIndex.module.css';
import { useCallback } from 'react';
import { useKnowledgeLibraryCache } from '../features/knowledge/library/KnowledgeLibraryProvider';
import { knowledgeLibraryPath, parseKnowledgeLibraryRoute } from '../features/knowledge/library/knowledgeLibraryRoute';
import { ConceptWorkspace } from '../features/knowledge/concepts/ConceptWorkspace';
import conceptStyles from '../features/knowledge/concepts/Concepts.module.css';
import { useAppStore } from '../store/AppStoreProvider';
import { KnowledgeWorkspaceView } from '../features/knowledge/KnowledgeWorkspaceView';
import { RealConceptGraphView } from '../features/knowledge/graph/RealConceptGraphView';
import { ConceptGraphView } from '../features/knowledge/graph/ConceptGraphView';
import { Button, LoadingState } from '../components/ui';
import { workspaceCapabilities } from '../store/workspaceCapabilities';
import { useNavigate } from './router';

function KnowledgeStageContent({ pathname, onOpenNote }: { pathname: string; onOpenNote(id: string): void }) {
  const state = useAppStore(value => value);
  const navigate = useNavigate();
  const cache = useKnowledgeLibraryCache();
  const route = parseKnowledgeLibraryRoute(pathname);
  const changeRoute = (patch: Partial<typeof route>, replace = false) =>
    navigate(knowledgeLibraryPath({ ...route, ...patch }), { replace });
  const { listKnowledgeItems } = state;
  const listConceptItems = useCallback(
    () => (cache ? cache.list() : listKnowledgeItems({ includeDeleted: true })),
    [cache, listKnowledgeItems]
  );
  // 旧渲染仅保留在显式实验入口，不能作为真实概念图。
  if (pathname.split('?')[0] === '/knowledge/graph/experiment')
    return (
      <ConceptGraphView
        query={route.query}
        onQueryChange={query =>
          navigate(`/knowledge/graph/experiment${query ? `?q=${encodeURIComponent(query)}` : ''}`, { replace: true })
        }
      />
    );
  if (state.dataMode !== 'api')
    return (
      <WorkspacePanel as="main" className={indexStyles.panel} aria-label="知识库连接状态">
        <LibraryIndexHeader
          title="知识库"
          icon={<KnowledgeIcon size={17} />}
          breadcrumb={<PathTrail path={[{ id: 'knowledge', label: '知识库', current: true }]} variant="top" />}
        >
          <Button
            variant="ghost"
            size="compact"
            isDisabled={state.dataMode === 'loading'}
            onPress={() => void state.retryWorkspace()}
          >
            重试加载
          </Button>
        </LibraryIndexHeader>
        <WorkspacePanelBody>
          <div className={indexStyles.empty}>
            {state.dataMode === 'loading' ? (
              <LoadingState label="正在加载知识库…" />
            ) : (
              <>
                <KnowledgeIcon size={28} />
                <strong>暂时无法读取知识库</strong>
                <p role="alert">{state.workspaceError || '请连接资料库后重试。'}</p>
              </>
            )}
          </div>
        </WorkspacePanelBody>
      </WorkspacePanel>
    );
  if (pathname.split('?')[0] === '/knowledge/graph')
    return (
      <RealConceptGraphView
        query={route.query}
        onQueryChange={query => {
          const params = new URLSearchParams(pathname.split('?')[1]);
          if (query) params.set('q', query);
          else params.delete('q');
          navigate(`/knowledge/graph?${params}`, { replace: true });
        }}
        selectedId={new URLSearchParams(pathname.split('?')[1]).get('concept')}
        onSelect={id => {
          const params = new URLSearchParams(pathname.split('?')[1]);
          params.set('concept', id);
          navigate(`/knowledge/graph?${params}`);
        }}
        onOpenConcept={id => navigate(`/knowledge/concepts?concept=${encodeURIComponent(id)}`)}
        onOpenItem={id => navigate(`/knowledge?item=${encodeURIComponent(id)}`)}
        onOpenExperiment={() => navigate('/knowledge/graph/experiment')}
        onListItems={listConceptItems}
        refreshKey={state.knowledgeGeneration}
      />
    );
  const canWrite = state.canWriteWorkspace() && workspaceCapabilities(state.persistenceMode).writeKnowledge;
  if (pathname.split('?')[0] === '/knowledge/concepts')
    return (
      <ConceptWorkspace
        selectedId={route.id}
        scope={route.scope}
        query={route.query}
        onScopeChange={scope => changeRoute({ scope, id: null })}
        onQueryChange={query => changeRoute({ query }, true)}
        onResetFilters={() => changeRoute({ scope: 'all', query: '', id: null })}
        onCreatedConcept={id => changeRoute({ scope: 'all', query: '', id })}
        canWrite={canWrite}
        refreshKey={state.knowledgeGeneration}
        onSelect={id => changeRoute({ id })}
        onOpenItem={id => navigate(`/knowledge?item=${encodeURIComponent(id)}`)}
        onListItems={listConceptItems}
      />
    );
  return (
    <KnowledgeWorkspaceView
      selectedItemId={route.id}
      scope={route.scope}
      query={route.query}
      onScopeChange={scope => changeRoute({ scope, id: null })}
      onQueryChange={query => changeRoute({ query }, true)}
      onResetFilters={() => changeRoute({ scope: 'all', query: '', id: null })}
      onCreatedItem={id => changeRoute({ scope: 'candidate', query: '', id })}
      canWrite={canWrite}
      refreshKey={state.knowledgeGeneration}
      readOnlyReason={canWrite ? undefined : '当前资料库为只读模式，请重试加载后再修改知识。'}
      onSelectItem={id => changeRoute({ id })}
      onCloseItem={() => changeRoute({ id: null })}
      onOpenNote={onOpenNote}
      onList={listConceptItems}
      onGet={state.getKnowledgeItem}
      onListEvidence={state.listKnowledgeEvidence}
      notes={state.serverData.notes}
      onListAnnotations={state.listAnnotations}
      onCreateEvidence={state.createKnowledgeEvidence}
      onRetireEvidence={state.retireKnowledgeEvidence}
      onReadoptEvidence={state.readoptKnowledgeEvidence}
      onCreate={state.createKnowledgeCandidate}
      onUpdate={state.updateKnowledgeItem}
      onConfirm={state.confirmKnowledgeItem}
      onArchive={state.archiveKnowledgeItem}
      onRestore={state.restoreKnowledgeItem}
      onTrash={state.trashKnowledgeItem}
      onRestoreDeleted={state.restoreDeletedKnowledgeItem}
      onInspectPurge={state.inspectKnowledgePurge}
      onPermanentDelete={
        workspaceCapabilities(state.persistenceMode).purgeKnowledge ? state.permanentlyDeleteKnowledgeItem : undefined
      }
      authoritativePurge={state.persistenceMode === 'desktop-local'}
      onPurgeStatus={state.persistenceMode === 'desktop-local' ? state.getAuthoritativePurgeStatus : undefined}
    />
  );
}

export function KnowledgeStage(props: Parameters<typeof KnowledgeStageContent>[0]) {
  return (
    <div className={conceptStyles.stage}>
      <KnowledgeStageContent {...props} />
    </div>
  );
}
