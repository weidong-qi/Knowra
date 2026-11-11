import { createKnowledgeModule } from '../../src/modules/knowledge/index.js';
import { prepareKnowledgeExtraction } from '../../src/modules/knowledge/application/knowledge-extraction-contract.js';

/** 全内存、无外部 AI 调用的可重复提炼验收资料。 */
export function createKnowledgeExtractionFixture() {
  const knowledge = createKnowledgeModule();
  const markdown =
    '## 资料\n\n数据增强通过变换样本增加训练变化。😀\n\n此段已被排除，不能作为提炼来源。\n\nMixup 对输入及其标签进行线性插值。';
  const note = knowledge.noteService.createNote({
    id: 'extraction-note',
    spaceId: 'extraction-space',
    title: '增强',
    rawMarkdown: markdown
  });
  const excluded = '此段已被排除，不能作为提炼来源。';
  const start = markdown.indexOf(excluded);
  const input = {
    spaceId: note.spaceId,
    mode: 'all',
    noteIds: [note.id],
    onceExclusions: [{ noteId: note.id, start, end: start + excluded.length }]
  };
  const preview = knowledge.annotationScopeService.previewAnalysisScope(input);
  const scope = knowledge.annotationScopeService.createAnalysisScope({
    ...input,
    previewHash: preview.previewHash,
    idempotencyKey: 'extraction-scope'
  });
  const noteVersions = knowledge.noteVersionService.listVersions({ noteId: note.id });
  const request = prepareKnowledgeExtraction({ scope, noteVersions, idempotencyKey: 'extraction-request' });
  const quote = '数据增强通过变换样本增加训练变化。';
  const source = request.sources.find(entry => entry.markdown.includes(quote));
  const quoteStart = source.markdown.indexOf(quote);
  const result = {
    contractVersion: 1,
    requestId: request.requestId,
    candidates: [
      {
        title: '数据增强',
        canonicalStatement: '数据增强通过变换样本增加训练变化。',
        knowledgeType: 'concept',
        citations: [{ sourceId: source.sourceId, start: quoteStart, end: quoteStart + quote.length, quote }]
      }
    ]
  };
  return { knowledge, note, scope, noteVersions, preview, request, result, excluded };
}
