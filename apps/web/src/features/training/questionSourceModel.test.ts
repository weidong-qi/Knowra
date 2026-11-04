import { describe, expect, it, vi } from 'vitest';
import { loadQuestionSource } from './questionSourceModel';
import type { QuestionSource } from './questionDetailModel';

const source: QuestionSource = { id: 's1', sourceType: 'noteVersion', sourceId: 'v1', quote: '旧摘录', status: 'stale', locator: { noteId: 'n1' } };
function dependencies() {
  return { question: { id: 'q1', updatedAt: '', learningObjectiveIds: ['o1'] }, objectives: [{ id: 'o1', updatedAt: '', knowledgeItemId: 'k1', objective: '当前目标', reviewStatus: 'candidate' }],
    onGetKnowledge: vi.fn(), onListEvidence: vi.fn().mockResolvedValue([{ id: 'e1', knowledgeItemId: 'k1', noteId: 'n1', noteVersionId: 'v1', quoteText: '证据原摘录', status: 'invalid', headingPath: ['旧章节'] }]),
    onGetVersion: vi.fn().mockResolvedValue({ id: 'v1', noteId: 'n1', content: '完整历史正文' }) };
}

describe('题目来源读取', () => {
  it('笔记版本只读取准确 ID 的历史正文，不扫描证据或当前笔记', async () => {
    const input = dependencies(); const result = await loadQuestionSource(source, input);
    expect(input.onGetVersion).toHaveBeenCalledWith('n1', 'v1'); expect(input.onListEvidence).not.toHaveBeenCalled();
    expect(result).toMatchObject({ contentLabel: '引用版本正文', content: '完整历史正文', noteId: 'n1' });
  });
  it('缺少 locator 时仅从关联知识证据解析版本，不扫描全库', async () => {
    const input = dependencies(); await loadQuestionSource({ ...source, locator: null }, input);
    expect(input.onListEvidence).toHaveBeenCalledExactlyOnceWith('k1');
    expect(input.onGetVersion).toHaveBeenCalledWith('n1', 'v1');
  });
  it('缺少可解析定位时保留摘录并报错，不能猜测笔记', async () => {
    const input = dependencies(); input.onListEvidence.mockResolvedValue([]);
    await expect(loadQuestionSource({ ...source, locator: null }, input)).rejects.toThrow('缺少笔记定位');
    expect(input.onGetVersion).not.toHaveBeenCalled();
  });
  it('拒绝返回其他来源版本的响应', async () => {
    const input = dependencies(); input.onGetVersion.mockResolvedValue({ id: 'v-other', noteId: 'n1', content: '错误正文' });
    await expect(loadQuestionSource(source, input)).rejects.toThrow('笔记版本与来源不匹配');
  });
  it('目标对照读当前内容并保留候选提示，不把摘录作为当前目标', async () => {
    const input = dependencies();
    const result = await loadQuestionSource({ ...source, sourceType: 'learningObjective', sourceId: 'o1' }, input);
    expect(result).toMatchObject({ content: '当前目标', contentLabel: '当前目标内容', notice: expect.stringContaining('当前未确认') });
  });
  it('知识证据可继续核对失效来源，不把失效证据当成可用', async () => {
    const result = await loadQuestionSource({ ...source, sourceType: 'knowledgeEvidence', sourceId: 'e1' }, dependencies());
    expect(result).toMatchObject({ content: '证据原摘录', notice: expect.stringContaining('需要重新核对') });
  });

  it.each([['noteVersion', 'v1', '完整历史正文'], ['knowledgeEvidence', 'e-source', '来源知识摘录']])('直接知识来源中的 %s 可精确解析，目标知识可以不同', async (sourceType, sourceId, expected) => {
    const input = dependencies();
    const question = { ...input.question, sources: [{ id: 's-knowledge', sourceType: 'knowledgeItem', sourceId: 'k-source', quote: '直接知识来源', status: 'active' }] };
    input.onListEvidence.mockImplementation(async id => id === 'k-source' ? [{ id: 'e-source', knowledgeItemId: 'k-source', noteId: 'n1', noteVersionId: 'v1', quoteText: '来源知识摘录', status: 'valid', headingPath: ['来源章节'] }] : []);
    const result = await loadQuestionSource({ ...source, sourceType, sourceId, locator: null }, { ...input, question });
    expect(result.content).toBe(expected);
    expect(input.onListEvidence.mock.calls.map(call => call[0]).sort()).toEqual(['k-source', 'k1']);
  });
});
