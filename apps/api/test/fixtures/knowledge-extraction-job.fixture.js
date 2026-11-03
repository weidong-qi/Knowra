import { calculateContentHash } from '@study-accelerator/content-anchor';
import { aiRecords } from '../ai-record-fixtures.js';
import { createAiGateway } from '../../src/modules/ai/gateway.js';
import { createMockAiAdapter } from '../../src/modules/ai/infrastructure/providers/mock-adapter.ts';
import { manifestHash, scopeHash, hashRecord } from '../../src/modules/ai/record-contract.js';
import { prepareKnowledgeExtractionGateway } from '../../src/modules/ai/knowledge-extraction-gateway.js';

/** 三驱动共用合成资料；通过已有范围/版本服务和真实 Mock Gateway 构造待接纳的任务。 */
export async function createKnowledgeExtractionJobFixture(app, ai = app.dataStore?.aiRepository, ownerId = 'demo') {
  const knowledge = app.modules.knowledge;
  const space = await app.http.knowledge.createDefaultKnowledgeSpace();
  const markdown =
    '## 合成资料\n\n数据增强通过变换样本增加训练变化。😀\n\n此段已被排除，不能提炼。\n\nMixup 对输入及其标签进行线性插值。';
  const excluded = '此段已被排除，不能提炼。';
  const note = await app.http.knowledge.createNote({
    id: 'extraction-note',
    title: '合成增强资料',
    spaceId: space.id,
    rawMarkdown: markdown
  });
  const start = markdown.indexOf(excluded);
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
    idempotencyKey: 'extraction-scope'
  });
  const noteVersions = await knowledge.noteVersionService.listVersions({ noteId: note.id });
  const prepared = prepareKnowledgeExtractionGateway({ scope, noteVersions, idempotencyKey: 'extraction-request' });
  const request = prepared.extractionRequest;
  const outbound = { ...prepared.gatewayRequest, modelId: 'deepseek-flash' };
  const records = aiRecords(await ai.identity(), 'extraction', ownerId, outbound);
  records.scope.spaceId = records.manifest.spaceId = records.grant.spaceId = records.job.spaceId = space.id;
  records.scope.scopeKind = records.manifest.scopeKind = 'multiNote';
  records.scope.allowedSources = request.sources.map(source => ({
    sourceId: source.sourceId,
    noteId: source.noteId,
    noteVersionId: source.noteVersionId,
    contentHash: source.contentHash,
    start: source.start,
    end: source.end,
    quoteHash: calculateContentHash(source.markdown),
    characters: source.end - source.start,
    estimatedTokens: source.markdown.length
  }));
  records.scope.scopeHash = scopeHash(records.scope);
  Object.assign(records.manifest, {
    sources: structuredClone(records.scope.allowedSources),
    scopeHash: records.scope.scopeHash,
    estimatedInputTokens: records.scope.allowedSources.reduce((sum, source) => sum + source.estimatedTokens, 0)
  });
  Object.assign(records.grant, {
    entrypoint: 'analysisScope',
    scopeHash: records.scope.scopeHash,
    allowedTools: [],
    actionKinds: ['create'],
    maxTargets: 20
  });
  Object.assign(records.job, {
    jobKind: 'knowledgeExtraction',
    idempotencyKey: 'extraction-request',
    requestId: request.requestId,
    inputHash: request.inputHash,
    manifestHash: manifestHash(records.manifest),
    promptVersion: prepared.promptVersion,
    resultSchemaVersion: 'knowledge-extraction-v1'
  });
  records.attempt.status = 'sent';
  for (const [kind, name] of [
    ['scopeSnapshot', 'scope'],
    ['contextManifest', 'manifest'],
    ['aiGrant', 'grant'],
    ['aiJob', 'job'],
    ['aiJobAttempt', 'attempt']
  ]) {
    await ai.insert(kind, records[name]);
  }
  records.job = await ai.replace(
    'aiJob',
    { ...records.job, status: 'running', phase: 'generating', updatedAt: '2026-09-26T00:00:01.000Z' },
    hashRecord(records.job)
  );
  const quote = '数据增强通过变换样本增加训练变化。';
  const source = request.sources.find(entry => entry.markdown.includes(quote));
  const offset = source.markdown.indexOf(quote);
  const output = {
    contractVersion: 1,
    requestId: request.requestId,
    candidates: [
      {
        title: '数据增强',
        canonicalStatement: quote,
        knowledgeType: 'concept',
        citations: [{ sourceId: source.sourceId, start: offset, end: offset + quote.length, quote }]
      }
    ]
  };
  const respond = async (value = output) =>
    createAiGateway({
      adapter: createMockAiAdapter({
        steps: [
          {
            response: {
              id: 'mock-extraction-response',
              model: 'synthetic-model',
              choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }],
              usage: { prompt_tokens: 30, completion_tokens: 20 }
            }
          }
        ]
      })
    }).complete(prepared.gatewayRequest);
  const input = {
    jobId: records.job.jobId,
    attemptId: records.attempt.attemptId,
    scopeId: scope.id,
    result: await respond()
  };
  return { knowledge, ai, note, space, scope, prepared, request, records, output, respond, input, excluded };
}
