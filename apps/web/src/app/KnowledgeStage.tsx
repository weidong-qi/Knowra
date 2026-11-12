import { useCallback } from 'react';
import { SegmentedControl, SegmentedButton } from '../components/ui';
import { ConceptWorkspace } from '../features/knowledge/concepts/ConceptWorkspace';
import conceptStyles from '../features/knowledge/concepts/Concepts.module.css';
import { useAppStore } from '../store/AppStoreProvider';
import { KnowledgeWorkspaceView } from '../features/knowledge/KnowledgeWorkspaceView';
import { ConceptGraphView } from '../features/knowledge/graph/ConceptGraphView';
import { Button, LoadingState } from '../components/ui';
import { workspaceCapabilities } from '../store/workspaceCapabilities';
import { useNavigate } from './router';

function KnowledgeStageContent({ pathname, onOpenNote }: { pathname: string; onOpenNote(id: string): void }) {
  const state = useAppStore(value => value);
  const navigate = useNavigate();
  const { listKnowledgeItems } = state;
  const listConceptItems = useCallback(() => listKnowledgeItems({ includeArchived: true }), [listKnowledgeItems]);
  // 概念图原型只读取本地示例数据，不依赖资料库连接。
  if (pathname.split('?')[0] === '/knowledge/graph') return <ConceptGraphView />;
  if (state.dataMode === 'loading') return <LoadingState label="正在加载知识库…" />;
  if (state.dataMode !== 'api')
    return (
      <section>
        <h1>知识库</h1>
        <p role="alert">{state.workspaceError || '暂时无法读取知识库，请连接资料库后重试。'}</p>
        <Button onPress={() => void state.retryWorkspace()}>重试加载</Button>
      </section>
    );
  const canWrite = state.canWriteWorkspace() && workspaceCapabilities(state.persistenceMode).writeKnowledge;
  if (pathname.split('?')[0] === '/knowledge/concepts')
    return (
      <ConceptWorkspace
        selectedId={new URLSearchParams(pathname.split('?')[1] ?? '').get('concept')}
        canWrite={canWrite}
        refreshKey={state.knowledgeGeneration}
        onSelect={id => navigate(id ? `/knowledge/concepts?concept=${encodeURIComponent(id)}` : '/knowledge/concepts')}
        onOpenItem={id => navigate(`/knowledge?item=${encodeURIComponent(id)}`)}
        onListItems={listConceptItems}
      />
    );
  return (
    <KnowledgeWorkspaceView
      selectedItemId={new URLSearchParams(pathname.split('?')[1] ?? '').get('item')}
      canWrite={canWrite}
      refreshKey={state.knowledgeGeneration}
      readOnlyReason={canWrite ? undefined : '当前资料库为只读模式，请重试加载后再修改知识。'}
      onSelectItem={id => navigate(`/knowledge?item=${encodeURIComponent(id)}`)}
      onCloseItem={() => navigate('/knowledge')}
      onOpenNote={onOpenNote}
      onList={state.listKnowledgeItems}
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
  const navigate = useNavigate();
  const current = props.pathname.split('?')[0];
  return (
    <div className={conceptStyles.stage}>
      <div className={conceptStyles.tabs}>
        <SegmentedControl aria-label="知识视图">
          {[
            ['/knowledge', '知识点'],
            ['/knowledge/concepts', '概念'],
            ['/knowledge/graph', '概念图']
          ].map(([path, label]) => (
            <SegmentedButton key={path} aria-pressed={current === path} onPress={() => navigate(path!)}>
              {label}
            </SegmentedButton>
          ))}
        </SegmentedControl>
      </div>
      <div className={conceptStyles.content}>
        <KnowledgeStageContent {...props} />
      </div>
    </div>
  );
}
