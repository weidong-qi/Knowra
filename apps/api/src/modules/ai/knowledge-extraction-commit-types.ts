import type {
  ExtractionCandidatePlan,
  ExtractionOutput,
  ExtractionRequest
} from '../knowledge/application/knowledge-extraction-types.ts';

/** 既有校验器接纳对象或 JSON 字符串结果，回执保留输入的原形和键序。 */
export interface KnowledgeExtractionCommitReceipt {
  schemaVersion: 1;
  executionMode: 'mock';
  ownerId: string;
  datasetId: string;
  datasetEpoch: string;
  spaceId: string;
  jobId: string;
  attemptId: string;
  scopeId: string;
  requestId: string;
  inputHash: string;
  outputHash: string;
  modelId: string;
  promptVersion: string;
  resultSchemaVersion: string;
  committedAt: string;
  request: ExtractionRequest;
  result: ExtractionOutput | string;
  candidates: ExtractionCandidatePlan[];
  receiptHash: string;
}
