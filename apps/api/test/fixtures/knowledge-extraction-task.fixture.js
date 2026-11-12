import { createAiGateway } from '../../src/modules/ai/gateway.ts';
import { createMockAiAdapter } from '../../src/modules/ai/infrastructure/providers/mock-adapter.ts';

/** 只创建领域资料和已保存范围；任务、授权、租约全部由真实 start/run 产生。 */
export async function createExtractionTaskSources(app, suffix = '') {
  const space = await app.http.knowledge.createDefaultKnowledgeSpace();
  const markdown =
    '## 合成提炼\n\n数据增强通过变换样本增加训练变化。😀\n\n本段排除不得发送。\n\nMixup 对输入及标签进行线性插值。';
  const note = await app.http.knowledge.createNote({
    title: `提炼任务合成资料${suffix}`,
    spaceId: space.id,
    rawMarkdown: markdown
  });
  const excluded = '本段排除不得发送。',
    start = markdown.indexOf(excluded);
  const scopeInput = {
    spaceId: space.id,
    mode: 'all',
    noteIds: [note.id],
    onceExclusions: [{ noteId: note.id, start, end: start + excluded.length }]
  };
  const preview = await app.http.knowledge.previewAnalysisScope(scopeInput);
  const scope = await app.http.knowledge.createAnalysisScope({
    ...scopeInput,
    previewHash: preview.previewHash,
    idempotencyKey: `task-scope${suffix}`
  });
  return { space, note, scope, excluded, input: { scopeId: scope.id, idempotencyKey: `task-request${suffix}` } };
}

export function extractionTaskGateway(onCall = (_request, response) => response) {
  const calls = [];
  const adapter = {
    ...createMockAiAdapter(),
    async complete(request) {
      calls.push(structuredClone({ messages: request.messages, maxTokens: request.maxTokens, tools: request.tools }));
      const body = JSON.parse(request.messages[1].content);
      const quote = '数据增强通过变换样本增加训练变化。';
      const source = body.sources.find(source => source.markdown.includes(quote));
      const start = source.markdown.indexOf(quote);
      const content = {
        contractVersion: 1,
        requestId: body.requestId,
        candidates: [
          {
            title: '数据增强',
            canonicalStatement: quote,
            knowledgeType: 'concept',
            citations: [{ sourceId: source.sourceId, start, end: start + quote.length, quote }]
          }
        ]
      };
      return onCall(
        request,
        {
          id: `mock-extraction-${calls.length}`,
          model: 'mock-knowledge-extraction-v1',
          choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }],
          usage: { prompt_tokens: 40, completion_tokens: 20 }
        },
        calls.length
      );
    }
  };
  return {
    calls,
    gateway: createAiGateway({
      adapter,
      resolveCredential() {
        throw new Error('Mock 提炼不得读取凭据');
      },
      authorizePaidCall() {
        throw new Error('Mock 提炼不得申请付费调用');
      }
    })
  };
}

export const quietTaskLogger = { warn() {} };
export function deferredTaskResponse() {
  let resolve, entered;
  const response = new Promise(done => {
    resolve = done;
  });
  const called = new Promise(done => {
    entered = done;
  });
  return {
    called,
    release: () => resolve(),
    onCall: async (_request, value) => {
      entered();
      await response;
      return value;
    }
  };
}
