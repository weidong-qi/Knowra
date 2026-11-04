import type { KnowledgeEvidence, KnowledgeItem, NoteVersion, TrainingAssetRecord } from '@study-accelerator/web-core';
import { questionSources, textValue, type QuestionSource } from './questionDetailModel';

export interface QuestionSourceContent { title: string; content: string; contentLabel: string; noteId?: string; knowledgeItemId?: string; notice?: string }
interface SourceDependencies {
  question: TrainingAssetRecord;
  objectives: TrainingAssetRecord[];
  onGetKnowledge(id: string): Promise<KnowledgeItem>;
  onListEvidence(id: string): Promise<KnowledgeEvidence[]>;
  onGetVersion(noteId: string, versionId: string): Promise<NoteVersion>;
}

export async function loadQuestionSource(source: QuestionSource, dependencies: SourceDependencies): Promise<QuestionSourceContent> {
  const { objectives, question, onGetKnowledge, onListEvidence, onGetVersion } = dependencies;
  if (!source.sourceId) throw new Error('来源缺少关联标识，保存摘录仍可查看。');
  if (source.sourceType === 'knowledgeItem') {
    const item = await onGetKnowledge(source.sourceId);
    if (item.id !== source.sourceId || item.deletedAt) throw new Error('关联知识不可用，保存摘录仍可查看。');
    return { title: item.title, content: item.canonicalStatement, contentLabel: '当前知识陈述', knowledgeItemId: item.id,
      notice: item.reviewStatus !== 'confirmed' ? '关联知识当前未确认，请核对其状态。' : undefined };
  }
  if (source.sourceType === 'learningObjective') {
    const objective = objectives.find(item => item.id === source.sourceId);
    if (!objective || objective.deletedAt) throw new Error('关联目标不可用，保存摘录仍可查看。');
    return { title: '学习目标', content: objective.objective || '', contentLabel: '当前目标内容', knowledgeItemId: objective.knowledgeItemId,
      notice: objective.reviewStatus !== 'confirmed' ? '关联目标当前未确认，请核对其状态。' : undefined };
  }
  const declaredSources = questionSources(question);
  const objectiveIds = [...(question.learningObjectiveIds ?? []), ...declaredSources.filter(item => item.sourceType === 'learningObjective').map(item => item.sourceId)];
  const knowledgeIds = [...new Set([textValue(source.locator?.knowledgeItemId),
    ...declaredSources.filter(item => item.sourceType === 'knowledgeItem').map(item => item.sourceId),
    ...objectiveIds.map(id => objectives.find(item => item.id === id)?.knowledgeItemId ?? '')].filter((id): id is string => Boolean(id)))];
  async function relatedEvidence() {
    // Read only directly related knowledge; never scan the user's library to guess a source.
    return (await Promise.all(knowledgeIds.map(id => onListEvidence(id)))).flat();
  }
  if (source.sourceType === 'knowledgeEvidence') {
    const evidence = (await relatedEvidence()).find(item => item.id === source.sourceId);
    if (!evidence) throw new Error('在关联知识中未找到该证据，保存摘录仍可查看。');
    return { title: evidence.headingPath?.join(' / ') || '知识证据', content: evidence.quoteText, contentLabel: '证据保存的摘录',
      noteId: evidence.noteId || undefined, knowledgeItemId: evidence.knowledgeItemId,
      notice: evidence.status !== 'valid' || (evidence.applicabilityStatus ?? 'active') !== 'active' ? '该证据需要重新核对，摘录继续保留。' : undefined };
  }
  if (source.sourceType === 'noteVersion') {
    let noteId = textValue(source.locator?.noteId);
    if (!noteId) noteId = (await relatedEvidence()).find(item => item.noteVersionId === source.sourceId)?.noteId || '';
    if (!noteId) throw new Error('该来源仅保留版本标识，缺少笔记定位。保存摘录仍可查看。');
    const version = await onGetVersion(noteId, source.sourceId);
    if (version.id !== source.sourceId || version.noteId !== noteId || typeof version.content !== 'string') throw new Error('笔记版本与来源不匹配，请重新核对。');
    return { title: '引用的笔记版本', content: version.content, contentLabel: '引用版本正文', noteId,
      notice: '这里显示编题时引用的历史版本；打开笔记会查看当前正文。' };
  }
  throw new Error('该来源暂不支持读取对照，保存说明仍可查看。');
}
