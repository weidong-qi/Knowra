import { Button } from '../../../components/ui';
import { SparkIcon, TargetIcon } from '../../../components/icons/knowra';
import { ExtractionDemoNotice } from '../ExtractionEnvironment';
import type { EditorInspectorProps } from './types';
import type { useInspectorAnalysis } from './useInspectorAnalysis';
import { InspectorSection } from './InspectorSection';
import styles from '../EditorInspector.module.css';

type AnalysisState = ReturnType<typeof useInspectorAnalysis>;

export function InspectorAnalysisIntro({ props, state }: { props: Pick<EditorInspectorProps, 'onExtractWithAssistant' | 'canWrite' | 'knowledgeWriteDisabledReason' | 'onPreviewAnalysisScope'>; state: AnalysisState }) {
  const { extracting, extractError, startExtraction, environment, creating, previewAnalysis, task } = state;
  const canStart = environment.capability.canStart;
  return <>
    {props.onExtractWithAssistant ? <InspectorSection icon={<SparkIcon size={18} />} title="让 AI 助手提炼知识点">
      <div className={styles.aiBlock}>
        <p>助手会读取本篇笔记和你标记的重点，提议知识候选。需要先授权读取本篇；候选只是提议，须在知识库逐条审核后才会入库。</p>
        <div className={styles.aiActions}>
          <Button variant="primary" size="compact" isPending={extracting} isDisabled={!props.canWrite || Boolean(props.knowledgeWriteDisabledReason)} onPress={() => void startExtraction()}>让 AI 提炼知识点</Button>
        </div>
        {props.knowledgeWriteDisabledReason ? <p className={styles.aiHint}>{props.knowledgeWriteDisabledReason}</p> : !props.canWrite ? <p className={styles.aiHint}>当前笔记不可写，无法提炼知识点。</p> : null}
        {extractError ? <p className={styles.versionError} role="alert">{extractError}</p> : null}
      </div>
    </InspectorSection> : null}
    <InspectorSection icon={<TargetIcon size={18} />} title="整篇分析">
      <div className={styles.aiBlock}>
        <p>预览当前笔记的分析范围。</p>
        <ExtractionDemoNotice />
        <div className={styles.aiCapability} data-ready={canStart || undefined}>
          <i aria-hidden="true" />
          <span>{canStart ? '知识提炼可用' : '知识提炼暂不可用；仍可保存分析范围和手动整理知识。'}</span>
          {environment.api ? <Button variant="ghost" size="mini" isDisabled={environment.checking} onPress={environment.recheck}>重新检查提炼能力</Button> : null}
        </div>
        <div className={styles.aiActions}>
          <Button variant="primary" size="compact" isPending={creating} isDisabled={!props.canWrite || !props.onPreviewAnalysisScope} onPress={() => void previewAnalysis('all')}>分析整篇</Button>
          <Button variant="ghost" size="compact" onPress={() => task.setOpen(true)}>查看提炼任务</Button>
        </div>
      </div>
    </InspectorSection>
  </>;
}

export function InspectorSavedScopes({ props, state, pendingIds, run }: {
  props: Pick<EditorInspectorProps, 'canWrite' | 'onListAnalysisScopes' | 'onTrashAnalysisScope' | 'onRestoreAnalysisScope'>;
  state: AnalysisState;
  pendingIds: ReadonlySet<string>;
  run(id: string, action: () => Promise<void>): Promise<void>;
}) {
  const { savedScopes, environment, task, setScopeRefresh } = state;
  if (!props.onListAnalysisScopes) return null;
  const activeCount = savedScopes.filter(item => !item.deletedAt).length;
  if (savedScopes.length === 0) return <InspectorSection icon={<SparkIcon size={18} />} title="已保存分析范围" emptyHint="暂无" />;
  return <InspectorSection icon={<SparkIcon size={18} />} title="已保存分析范围" count={activeCount}>
    <div className={styles.scopeList}>{savedScopes.map(scope => <div key={scope.id} className={styles.scopeRow} data-trashed={scope.deletedAt ? true : undefined}>
      <div className={styles.scopeText}>
        <strong>{scope.noteVersions?.map(version => version.title || version.noteId).join('、') || '分析范围'}</strong>
        <span>{scope.summary?.segmentCount ?? 0} 个片段 · {scope.deletedAt ? '回收站' : '已保存'}</span>
      </div>
      <div className={styles.scopeActions}>
        {!scope.deletedAt && environment.capability.canStart ? <Button size="mini" isDisabled={!props.canWrite || task.pending} onPress={() => task.prepare(scope.id)}>提炼此范围</Button> : null}
        <Button variant="ghost" size="mini" isDisabled={!props.canWrite || pendingIds.has(scope.id) || !(scope.deletedAt ? props.onRestoreAnalysisScope : props.onTrashAnalysisScope)} onPress={() => void run(scope.id, async () => {
          const action = scope.deletedAt ? props.onRestoreAnalysisScope : props.onTrashAnalysisScope;
          await action?.(scope.id, { spaceId: scope.spaceId, expectedUpdatedAt: scope.updatedAt ?? scope.createdAt });
          setScopeRefresh(value => value + 1);
        })}>{scope.deletedAt ? '恢复范围' : '移入回收站'}</Button>
      </div>
    </div>)}</div>
  </InspectorSection>;
}
