import { buildAnnotationInputFromSelection } from '../../lib/annotations/selection.js';
import { insertAnnotation, replaceAnnotation } from '../../lib/annotations/state.js';
import { guardWorkspaceWrite } from '../../lib/workspace-write-guard.js';

export function createAnnotationController({
  state,
  editorRuntime,
  knowledgeApi,
  getCurrentNote,
  persistDraft,
  renderSidebar,
  flashStatus
}) {
  const syncAnnotationMarkers = () => void editorRuntime.currentEditorHost?.setAnnotations(state.annotations);

  async function createAnnotationFromCurrentSelection(note) {
    if (!guardWorkspaceWrite({ dataMode: state.dataMode, flashStatus })) {
      return false;
    }
    const host = editorRuntime.currentEditorHost;
    if (!host) {
      flashStatus('编辑器尚未就绪');
      return false;
    }
    const selection = await host.getSelectionSnapshot();
    if (!selection) {
      flashStatus('请先选中正文片段');
      return false;
    }

    try {
      const saveResult = await persistDraft();
      if (!saveResult?.ok) {
        return false;
      }
      const currentNote = note ?? getCurrentNote();
      const input = await buildAnnotationInputFromSelection({ note: currentNote, selection, markdown: state.draftMarkdown || currentNote.rawMarkdown });
      const annotation = await knowledgeApi.createAnnotation(input);
      state.annotations = insertAnnotation(state.annotations, annotation);
      state.focusedAnnotationId = annotation.id;
      state.asideTab = 'concepts';
      state.expandedAnnotationIds = {
        ...state.expandedAnnotationIds,
        [annotation.id]: true
      };
      syncAnnotationMarkers();
      renderSidebar(getCurrentNote());
      flashStatus('已标记为重要内容');
      return true;
    } catch (error) {
      flashStatus(error.message || '标记失败');
      return false;
    }
  }

  async function deleteAnnotation(id) {
    if (!guardWorkspaceWrite({ dataMode: state.dataMode, flashStatus })) {
      return false;
    }
    try {
      const annotation = await knowledgeApi.deleteAnnotation(id);
      state.annotations = replaceAnnotation(state.annotations, annotation);
      syncAnnotationMarkers();
      renderSidebar(getCurrentNote());
      return true;
    } catch (error) {
      flashStatus(error.message || '删除标注失败');
      return false;
    }
  }

  async function createKnowledgeItemFromAnnotation(id) {
    if (!guardWorkspaceWrite({ dataMode: state.dataMode, flashStatus })) return false;
    const annotation = state.annotations.find((item) => item.id === id);
    if (!annotation || annotation.status === 'stale' || annotation.status === 'archived') {
      flashStatus('该标注的原文位置已变化，请先重新定位后再生成知识候选');
      return false;
    }
    try {
      const result = await knowledgeApi.createKnowledgeItem({
        title: annotation.quoteText.slice(0, 80),
        canonicalStatement: annotation.quoteText,
        sourceMode: 'annotation',
        evidence: [{
          sourceType: 'annotation',
          annotationId: annotation.id,
          noteId: annotation.noteId,
          quoteText: annotation.quoteText,
          headingPath: annotation.headingPath
        }]
      });
      const item = result?.item
        ? { ...result.item, evidenceStatus: 'valid', evidenceSummary: result.evidence ?? [] }
        : result;
      if (item?.id) {
        state.knowledgeItems = [item, ...state.knowledgeItems.filter((candidate) => candidate.id !== item.id)];
      }
      renderSidebar(getCurrentNote());
      flashStatus('已生成知识单元候选');
      return item;
    } catch (error) {
      flashStatus(error.message || '生成知识候选失败');
      return false;
    }
  }

  async function confirmKnowledgeItem(id) {
    if (!guardWorkspaceWrite({ dataMode: state.dataMode, flashStatus })) return false;
    try {
      const item = await knowledgeApi.confirmKnowledgeItem(id);
      state.knowledgeItems = replaceKnowledgeItem(state.knowledgeItems, item);
      renderSidebar(getCurrentNote());
      flashStatus('知识单元已确认');
      return item;
    } catch (error) {
      flashStatus(error.message || '确认知识单元失败');
      return false;
    }
  }

  async function updateKnowledgeItem(id, input) {
    if (!guardWorkspaceWrite({ dataMode: state.dataMode, flashStatus })) return false;
    try {
      const item = await knowledgeApi.updateKnowledgeItem(id, input);
      state.knowledgeItems = replaceKnowledgeItem(state.knowledgeItems, item);
      renderSidebar(getCurrentNote());
      flashStatus('知识单元已保存');
      return item;
    } catch (error) {
      flashStatus(error.message || '保存知识单元失败');
      return false;
    }
  }

  async function archiveKnowledgeItem(id) {
    if (!guardWorkspaceWrite({ dataMode: state.dataMode, flashStatus })) return false;
    try {
      const item = await knowledgeApi.archiveKnowledgeItem(id);
      state.knowledgeItems = replaceKnowledgeItem(state.knowledgeItems, item);
      renderSidebar(getCurrentNote());
      flashStatus('知识单元已归档');
      return item;
    } catch (error) {
      flashStatus(error.message || '归档知识单元失败');
      return false;
    }
  }

  async function restoreKnowledgeItem(id) {
    if (!guardWorkspaceWrite({ dataMode: state.dataMode, flashStatus })) return false;
    try {
      const item = await knowledgeApi.restoreKnowledgeItem(id);
      state.knowledgeItems = replaceKnowledgeItem(state.knowledgeItems, item);
      renderSidebar(getCurrentNote());
      flashStatus('知识单元已恢复为候选');
      return item;
    } catch (error) {
      flashStatus(error.message || '恢复知识单元失败');
      return false;
    }
  }

  async function selectAnnotation(id) {
    state.focusedAnnotationId = id;
    const selected = await editorRuntime.currentEditorHost?.selectAnnotation(id);
    if (!selected) {
      flashStatus('原文位置已变化');
    }
    renderSidebar(getCurrentNote());
  }

  function focusAnnotationFromMarker({ annotationId }) {
    state.focusedAnnotationId = annotationId;
    state.asideTab = 'concepts';
    renderSidebar(getCurrentNote());
  }

  return {
    createAnnotationFromCurrentSelection,
    deleteAnnotation,
    createKnowledgeItemFromAnnotation,
    updateKnowledgeItem,
    confirmKnowledgeItem,
    archiveKnowledgeItem,
    restoreKnowledgeItem,
    selectAnnotation,
    focusAnnotationFromMarker,
    syncAnnotationMarkers
  };
}

function replaceKnowledgeItem(items, nextItem) {
  return items.map((item) => item.id === nextItem?.id
    ? { ...item, ...nextItem, evidenceSummary: nextItem.evidenceSummary ?? item.evidenceSummary }
    : item);
}
