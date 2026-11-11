import { sameKnowraText } from '@study-accelerator/shared/knowra-marks';
import { createHash } from 'node:crypto';
import { createAppError } from '../../../errors/app-error.ts';

export interface ProvenanceAnnotationRevision {
  annotationId: string;
  revision: number;
}
export interface KnowledgeArtifactProvenanceSource {
  evidenceId: string;
  sourceId: string;
  noteId: string;
  originNoteVersionId: string;
  contentHash: string;
  start: number;
  end: number;
  quoteText: string;
  quoteHash: string;
  annotationRevisions: ProvenanceAnnotationRevision[];
}
interface ProvenanceCommon {
  id: string;
  schemaVersion: 1;
  artifactKind: 'knowledgeItem';
  artifactId: string;
  provenanceHash: string;
}
export interface LegacyKnowledgeArtifactProvenance extends ProvenanceCommon {
  state: 'legacy-unavailable';
  reason: 'origin-record-unavailable';
  sources?: never;
}
interface RecordedCommon extends ProvenanceCommon {
  state: 'recorded';
  modelId: string;
  promptVersion: string;
  resultSchemaVersion: string;
  inputHash: string;
  outputHash: string;
  committedAt: string;
  sources: KnowledgeArtifactProvenanceSource[];
}
interface OriginCommon {
  requestId: string;
  spaceId: string;
  receiptHash: string;
}
export type RecordedKnowledgeArtifactProvenance = RecordedCommon &
  (
    | { executionMode: 'mock'; provider: 'mock'; origin: OriginCommon & { jobId: string; scopeId: string } }
    | {
        executionMode: 'agent';
        provider: string;
        origin: OriginCommon & { conversationId: string; turnId: string; toolCallId: string };
      }
    | {
        executionMode: 'mcp';
        provider: 'external-client';
        origin: OriginCommon & { pairingId: string; callId: string };
      }
  );
export type KnowledgeArtifactProvenance = LegacyKnowledgeArtifactProvenance | RecordedKnowledgeArtifactProvenance;
export interface ProvenanceEvidence {
  id?: unknown;
  knowledgeItemId?: unknown;
  noteId?: unknown;
  sourceType?: unknown;
  noteVersionId?: string | null;
  quoteText?: unknown;
  status?: unknown;
  applicabilityStatus?: string | null;
}
export interface ProvenanceNoteVersion {
  id?: string;
  noteId?: unknown;
  contentHash?: unknown;
  content?: unknown;
}
export interface ProvenanceNote {
  id?: unknown;
  deleted?: unknown;
  deletedAt?: unknown;
  rawMarkdown?: unknown;
  contentHash?: unknown;
}
export interface ProvenanceKnowledgeItem {
  id?: unknown;
  deletedAt?: unknown;
  reviewStatus?: unknown;
}
export interface ResolveProvenanceSourceInput {
  record?: unknown;
  source?: KnowledgeArtifactProvenanceSource;
  evidence?: ProvenanceEvidence | null;
  noteVersion?: ProvenanceNoteVersion | null;
  note?: ProvenanceNote | null;
  knowledgeItem?: ProvenanceKnowledgeItem | null;
}
export interface ResolvedProvenanceSource {
  originalVersionId: string;
  resolvedVersionId: string;
  aliasUsed: boolean;
  sourceState: 'available' | 'unavailable' | 'stale';
}
const safeInteger = (value: unknown): value is number => Number.isSafeInteger(value);
const executionMode = (value: unknown): value is keyof typeof ORIGIN_KEYS =>
  ['mock', 'agent', 'mcp'].includes(typeof value === 'string' ? value : '');

export const KNOWLEDGE_ARTIFACT_PROVENANCE_LIMITS = Object.freeze({
  recordBytes: 1024 * 1024,
  sources: 8,
  quoteCharacters: 8000,
  identifierCharacters: 200
});
const DOMAIN = 'knowra:knowledge-artifact-provenance:v1\n';
const COMMON = ['id', 'schemaVersion', 'state', 'artifactKind', 'artifactId', 'provenanceHash'];
const RECORDED = [
  'executionMode',
  'provider',
  'modelId',
  'promptVersion',
  'resultSchemaVersion',
  'origin',
  'inputHash',
  'outputHash',
  'committedAt',
  'sources'
];
const SOURCE = [
  'evidenceId',
  'sourceId',
  'noteId',
  'originNoteVersionId',
  'contentHash',
  'start',
  'end',
  'quoteText',
  'quoteHash',
  'annotationRevisions'
];
const ORIGIN_KEYS = Object.freeze({
  mock: ['jobId', 'requestId', 'scopeId', 'spaceId', 'receiptHash'],
  agent: ['conversationId', 'turnId', 'toolCallId', 'requestId', 'spaceId', 'receiptHash'],
  // 外部 AI 客户端（本机 MCP）：配对 ID 与调用 ID（客户端给的幂等键或由提议内容派生），不含对话内容与客户端自述信息。
  mcp: ['pairingId', 'callId', 'requestId', 'spaceId', 'receiptHash']
});
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const identifier = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= KNOWLEDGE_ARTIFACT_PROVENANCE_LIMITS.identifierCharacters &&
  value.trim() === value &&
  !/\p{Cc}/u.test(value) &&
  value.isWellFormed();
function invalid(): never {
  return fail('INVALID', '知识产物来源记录不符合 v1 契约。');
}
function fail(suffix: string, message: string): never {
  throw createAppError(`KNOWLEDGE_ARTIFACT_PROVENANCE_${suffix}`, message, 422);
}

function assertKeys(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some(key => {
      const property = Object.getOwnPropertyDescriptor(value, key);
      return !property || !property.enumerable || !Object.hasOwn(property, 'value');
    })
  )
    invalid();
}

// Narrow the containing record so callback reads retain the original property access order.
function assertOriginKeys(
  record: Record<string, unknown>,
  keys: readonly string[]
): asserts record is Record<string, unknown> & { origin: Record<string, unknown> } {
  assertKeys(record.origin, keys);
}

function assertArray(value: unknown): asserts value is unknown[] {
  if (!Array.isArray(value) || Reflect.ownKeys(value).length !== value.length + 1) invalid();
  for (let index = 0; index < value.length; index += 1) {
    const property = Object.getOwnPropertyDescriptor(value, String(index));
    if (!property || !property.enumerable || !Object.hasOwn(property, 'value')) invalid();
  }
}

// Enforce the complete UTF-8 budget before traversing any contract fields.
function assertRecordBytes(value: unknown): void {
  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch {
    invalid();
  }
  if (typeof encoded !== 'string') invalid();
  if (Buffer.byteLength(encoded, 'utf8') > KNOWLEDGE_ARTIFACT_PROVENANCE_LIMITS.recordBytes) {
    fail('TOO_LARGE', '知识产物来源记录超过 1 MiB 限制。');
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    assertArray(value);
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    assertKeys(value, keys);
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
    return JSON.stringify(value);
  invalid();
}

export function knowledgeArtifactProvenanceId(artifactId: unknown) {
  if (!identifier(artifactId)) invalid();
  return `provenance-${sha256(JSON.stringify(['knowledgeItem', artifactId]))}`;
}

/** Pure core hash: no AI schemas, runtime configuration or mutable asset state. */
export function hashKnowledgeArtifactProvenance(recordWithoutHash: unknown) {
  assertRecordBytes(recordWithoutHash);
  return sha256(DOMAIN + canonicalJson(recordWithoutHash));
}

function validateSource(source: unknown): asserts source is KnowledgeArtifactProvenanceSource {
  assertKeys(source, SOURCE);
  if (
    ['evidenceId', 'sourceId', 'noteId', 'originNoteVersionId'].some(key => !identifier(source[key])) ||
    !digest(source.contentHash) ||
    !digest(source.quoteHash) ||
    !safeInteger(source.start) ||
    !safeInteger(source.end) ||
    source.start < 0 ||
    source.end <= source.start ||
    typeof source.quoteText !== 'string' ||
    !source.quoteText.isWellFormed() ||
    source.quoteText.length > KNOWLEDGE_ARTIFACT_PROVENANCE_LIMITS.quoteCharacters ||
    source.quoteText.length !== source.end - source.start ||
    source.quoteHash !== sha256(source.quoteText)
  )
    invalid();
  assertArray(source.annotationRevisions);
  const annotations = new Set<string>();
  for (const entry of source.annotationRevisions) {
    assertKeys(entry, ['annotationId', 'revision']);
    if (
      !identifier(entry.annotationId) ||
      !safeInteger(entry.revision) ||
      entry.revision < 1 ||
      annotations.has(entry.annotationId)
    )
      invalid();
    annotations.add(entry.annotationId);
  }
}

/** Validate untrusted persisted/synchronized data; return an independent copy. */
function assertValidRecord(record: unknown): asserts record is KnowledgeArtifactProvenance {
  assertRecordBytes(record);
  // This property-read view does not assert validity; assertKeys below rejects non-records.
  // Keep optional reads (including getter order) before the original key whitelist.
  const stateView = record as { state?: unknown } | null | undefined;
  const stateKeys =
    stateView?.state === 'recorded' ? RECORDED : stateView?.state === 'legacy-unavailable' ? ['reason'] : [];
  assertKeys(record, [...COMMON, ...stateKeys]);
  if (
    record.schemaVersion !== 1 ||
    record.artifactKind !== 'knowledgeItem' ||
    !identifier(record.artifactId) ||
    record.id !== knowledgeArtifactProvenanceId(record.artifactId) ||
    !digest(record.provenanceHash)
  )
    invalid();
  if (record.state === 'recorded') {
    // mock：受信宿主的模拟验收；agent：笔记助手经受控工具提议并由核心事务保存的候选；mcp：外部 AI 客户端经本机 MCP 提议的候选。
    // 三种模式的 provider 互斥，origin 字段各自固定，既有 mock/agent 记录与其哈希保持不变。
    const providerOk =
      record.executionMode === 'mock'
        ? record.provider === 'mock'
        : record.executionMode === 'mcp'
          ? record.provider === 'external-client'
          : identifier(record.provider) && record.provider !== 'mock' && record.provider !== 'external-client';
    if (
      !executionMode(record.executionMode) ||
      !providerOk ||
      ['modelId', 'promptVersion', 'resultSchemaVersion'].some(key => !identifier(record[key])) ||
      !digest(record.inputHash) ||
      !digest(record.outputHash) ||
      typeof record.committedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(record.committedAt) ||
      !Number.isFinite(Date.parse(record.committedAt))
    )
      invalid();
    const originKeys = ORIGIN_KEYS[record.executionMode];
    assertOriginKeys(record, originKeys);
    if (
      originKeys.some(key => key !== 'receiptHash' && !identifier(record.origin[key])) ||
      !digest(record.origin.receiptHash)
    )
      invalid();
    assertArray(record.sources);
    if (record.sources.length < 1 || record.sources.length > KNOWLEDGE_ARTIFACT_PROVENANCE_LIMITS.sources) invalid();
    const sources = new Set<string>(),
      evidence = new Set<string>();
    for (const source of record.sources) {
      validateSource(source);
      // One request source may legitimately supply distinct citations in an old receipt.
      const identity = JSON.stringify([source.sourceId, source.start, source.end]);
      if (sources.has(identity) || evidence.has(source.evidenceId)) invalid();
      sources.add(identity);
      evidence.add(source.evidenceId);
    }
  } else if (record.state !== 'legacy-unavailable' || record.reason !== 'origin-record-unavailable') invalid();
  const { provenanceHash, ...content } = record;
  if (provenanceHash !== hashKnowledgeArtifactProvenance(content)) {
    fail('HASH_MISMATCH', '知识产物来源记录的完整性校验失败。');
  }
}

/** Validate untrusted persisted/synchronized data; return an independent copy. */
export function validateKnowledgeArtifactProvenance(record: unknown): KnowledgeArtifactProvenance {
  assertValidRecord(record);
  return structuredClone(record);
}

export function createLegacyKnowledgeArtifactProvenance(artifactId: string): LegacyKnowledgeArtifactProvenance {
  const content: Omit<LegacyKnowledgeArtifactProvenance, 'provenanceHash'> = {
    id: knowledgeArtifactProvenanceId(artifactId),
    schemaVersion: 1,
    state: 'legacy-unavailable',
    artifactKind: 'knowledgeItem',
    artifactId,
    reason: 'origin-record-unavailable'
  };
  return { ...content, provenanceHash: hashKnowledgeArtifactProvenance(content) };
}

function splitsSurrogate(value: string, index: number): boolean {
  const previous = value.charCodeAt(index - 1),
    current = value.charCodeAt(index);
  return previous >= 0xd800 && previous <= 0xdbff && current >= 0xdc00 && current <= 0xdfff;
}

/**
 * Resolve only through the existing Evidence. Callers supply records read within
 * the current authorized host boundary; origin.spaceId is historical identity.
 * Missing/inconsistent links fail closed; soft deletion changes only sourceState.
 */
export function resolveKnowledgeArtifactProvenanceSource({
  record,
  source,
  evidence,
  noteVersion,
  note,
  knowledgeItem
}: ResolveProvenanceSourceInput = {}): ResolvedProvenanceSource {
  const validated = validateKnowledgeArtifactProvenance(record);
  function mismatch(): never {
    return fail('SOURCE_MISMATCH', '知识产物来源与当前证据或笔记版本不一致。');
  }
  if (validated.state !== 'recorded') mismatch();
  const member = validated.sources.find(entry => entry.evidenceId === source?.evidenceId);
  if (!member) mismatch();
  assertRecordBytes(source);
  validateSource(source);
  if (
    canonicalJson(member) !== canonicalJson(source) ||
    knowledgeItem?.id !== validated.artifactId ||
    note?.id !== member.noteId ||
    evidence?.id !== member.evidenceId ||
    evidence.knowledgeItemId !== validated.artifactId ||
    evidence.noteId !== member.noteId ||
    evidence.sourceType !== 'noteVersion' ||
    !identifier(evidence.noteVersionId) ||
    evidence.noteVersionId !== noteVersion?.id ||
    noteVersion.noteId !== member.noteId ||
    noteVersion.contentHash !== member.contentHash ||
    typeof noteVersion.content !== 'string' ||
    sha256(noteVersion.content) !== member.contentHash ||
    member.end > noteVersion.content.length ||
    splitsSurrogate(noteVersion.content, member.start) ||
    splitsSurrogate(noteVersion.content, member.end) ||
    noteVersion.content.slice(member.start, member.end) !== member.quoteText ||
    evidence.quoteText !== member.quoteText.trim()
  )
    mismatch();
  const unavailable =
    note.deleted ||
    note.deletedAt ||
    knowledgeItem.deletedAt ||
    knowledgeItem.reviewStatus === 'archived' ||
    evidence.status === 'invalid' ||
    evidence.status === 'insufficient' ||
    ['withdrawn', 'needsReview'].includes(evidence.applicabilityStatus ?? '');
  const stale =
    evidence.status === 'stale' ||
    (typeof note.rawMarkdown === 'string' &&
      sha256(note.rawMarkdown) !== member.contentHash &&
      !sameKnowraText(note.rawMarkdown, noteVersion.content)) ||
    (typeof note.rawMarkdown !== 'string' && digest(note.contentHash) && note.contentHash !== member.contentHash);
  return {
    originalVersionId: member.originNoteVersionId,
    resolvedVersionId: noteVersion.id,
    aliasUsed: member.originNoteVersionId !== noteVersion.id,
    sourceState: unavailable ? 'unavailable' : stale ? 'stale' : 'available'
  };
}
