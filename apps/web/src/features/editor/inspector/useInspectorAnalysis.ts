import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { AnalysisScopeInput, AnalysisScopeSnapshot } from '@study-accelerator/web-core';
import type { AnalysisIntent } from '../AnalysisScopeDialog';
import { useKnowledgeExtractionTasks } from '../useKnowledgeExtractionTasks';
import { useExtractionEnvironment } from '../ExtractionEnvironment';
import type { EditorInspectorProps } from './types';

export function useInspectorAnalysis(props: Pick<EditorInspectorProps, 'note' | 'canWrite' | 'onListAnalysisScopes' | 'onPreviewAnalysisScope' | 'onExtractWithAssistant'>, analysisOnly: boolean | undefined, selectedIds: string[], visibleIds: string[], setError: Dispatch<SetStateAction<string>>) {
  const [creating, setCreating] = useState(false);
  const [savedScopes, setSavedScopes] = useState<AnalysisScopeSnapshot[]>([]);
  const [scopeRefresh, setScopeRefresh] = useState(0);
  const [analysis, setAnalysis] = useState<AnalysisIntent | null>(null);
  const environment = useExtractionEnvironment();
  const task = useKnowledgeExtractionTasks(props.note.spaceId ?? '', props.note.id, props.canWrite);
  const analysisScope = useMemo(() => ({}), [props.note.id, props.note.spaceId, environment.scopeKey]);
  const currentAnalysisScope = useRef(analysisScope); currentAnalysisScope.current = analysisScope;
  useEffect(() => { setAnalysis(null); setError(''); setCreating(false); }, [analysisScope]);
  useEffect(() => {
    setSavedScopes([]);
    if (!analysisOnly || !props.onListAnalysisScopes || !props.note.spaceId) return;
    let active = true;
    void props.onListAnalysisScopes(props.note.spaceId).then(rows => { if (active) setSavedScopes(rows); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : '已保存范围加载失败'); });
    return () => { active = false; };
  }, [analysisOnly, props.note.spaceId, props.onListAnalysisScopes, scopeRefresh, environment.scopeKey]);

  async function previewAnalysis(mode: 'marked' | 'all') {
    if (!props.onPreviewAnalysisScope) return;
    const annotationIds = selectedIds.length > 0
      ? selectedIds
      : visibleIds;
    const input: AnalysisScopeInput = { spaceId: props.note.spaceId ?? '', mode, noteIds: [props.note.id], ...(mode === 'marked' ? { annotationIds } : {}) };
    setCreating(true);
    setError('');
    try {
      const preview = await props.onPreviewAnalysisScope(input);
      if (currentAnalysisScope.current === analysisScope) setAnalysis({ input, preview, scopeKey: crypto.randomUUID(), taskKey: crypto.randomUUID() });
    } catch (analysisError) {
      if (currentAnalysisScope.current === analysisScope) setError(analysisError instanceof Error ? analysisError.message : '分析范围预览失败');
    } finally {
      if (currentAnalysisScope.current === analysisScope) setCreating(false);
    }
  }

  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState('');
  // 进入助手前由编辑器保存并核验草稿：失败或保存期间内容变化时留在这里显示原因，允许重试；进行中不重复触发。
  async function startExtraction() {
    if (extracting || !props.onExtractWithAssistant) return;
    setExtracting(true); setExtractError('');
    try { await props.onExtractWithAssistant(); }
    catch (failure) { setExtractError(failure instanceof Error ? failure.message : '无法打开 AI 助手，请重试。'); }
    finally { setExtracting(false); }
  }

  return { creating, savedScopes, setScopeRefresh, analysis, setAnalysis, environment, task, previewAnalysis, extracting, extractError, startExtraction };
}
