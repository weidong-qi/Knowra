import type { ReadRepositories } from './access-service-types.ts';
export interface AiReadContextDependencies extends ReadRepositories {
  repository?: Pick<
    ReturnType<typeof import('./record-repository.js').createAiRecordRepository>,
    'identity' | 'get' | 'insert'
  >;
}
export interface ReadScope {
  kind: string;
  noteId?: string;
  noteIds?: string[];
  folderId?: string;
  noteVersionId?: string;
  start?: number;
  end?: number;
}
export interface PrepareReadInput {
  spaceId?: string;
  scope?: ReadScope;
  question?: string;
  modelId?: string;
  credentialRef?: string;
  maxTokens?: number;
  maxInputTokens?: number;
  excludedSourceIds?: string[];
}
type ReadContextService = ReturnType<typeof import('./read-context-service.js').createAiReadContextService>;
export interface AuthorizeReadInput {
  prepared?: Awaited<ReturnType<ReadContextService['prepareRead']>>;
  actorId?: string;
  approvedScopeHash?: string;
  approvedPayloadHash?: string;
}
export interface Citation {
  sourceId: string;
  start: number;
  end: number;
  quote: string;
}
export interface ValidateCitationsInput {
  jobId?: string;
  citations?: Record<string, unknown>[];
}
export interface ValidateAnswerInput {
  jobId?: string;
  result?: { truncated?: boolean; finishReason?: string; json?: Record<string, unknown> | null };
}
