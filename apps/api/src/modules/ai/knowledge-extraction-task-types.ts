import type { ProviderRequest } from './infrastructure/providers/deepseek-adapter.ts';
import type { GatewayResult } from './boundary-types.ts';

export interface ExtractionTaskBoundary {
  ownerId: string;
  datasetId: string;
  datasetEpoch: string;
  spaceId: string;
}

export interface ExtractionTaskDescriptor extends ExtractionTaskBoundary {
  schemaVersion: 1;
  jobId: string;
  scopeId: string;
  scopeInputHash: string;
  inputHash: string;
  executionMode: 'mock';
  profileVersion: string;
  maxTokens: number;
  creationHash: string;
  createdAt: string;
  recordHash: string;
}

export interface ExtractionTaskState {
  version: 1;
  tasks: ExtractionTaskDescriptor[];
}

/** 原始数据库索引在和已校验文档比对前，不假定字段已经是有效标识。 */
export interface RawExtractionIndexKey {
  ownerId: unknown;
  datasetId: unknown;
  jobId: unknown;
}

export interface ExtractionMockGateway {
  capabilities(): { provider: string };
  complete(request: ProviderRequest): PromiseLike<GatewayResult>;
}
