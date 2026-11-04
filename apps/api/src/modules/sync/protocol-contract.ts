import { syncError } from './journal.ts';
import { TRAINING_SYNC_CAPABILITY } from './entity-contract.ts';

export interface SyncContract {
  entitySchemaVersion: number;
  capabilities: string[];
}
export interface SyncSnapshotBinding extends SyncContract {
  snapshotId: string;
  ownerId: string;
  datasetEpoch: string;
  cursor: string;
  count: number;
}
interface SyncContractInput {
  entitySchemaVersion?: unknown;
  capabilities?: unknown;
}

export const SYNC_ENTITY_SCHEMA_VERSION = 9;
export const KNOWLEDGE_PROVENANCE_SYNC_CAPABILITY = 'knowledge-provenance-v1';
export const KNOWLEDGE_LIFECYCLE_SYNC_CAPABILITY = 'knowledge-lifecycle-v1';
// agent 执行模式的来源摘要：旧端无法校验这类记录，必须在握手阶段拒绝，而不是读到记录才失败。
export const KNOWLEDGE_AGENT_PROVENANCE_SYNC_CAPABILITY = 'knowledge-provenance-agent-v1';
// mcp 执行模式（外部 AI 客户端经本机 MCP 提议的候选）的来源摘要：同理，旧端无法校验，必须在握手阶段拒绝。
export const KNOWLEDGE_MCP_PROVENANCE_SYNC_CAPABILITY = 'knowledge-provenance-mcp-v1';
// 重点内联化：schemaVersion 3 的重点由正文标记派生，旧端会拒绝这类记录，必须在握手阶段要求两端都升级。
export const INLINE_ANNOTATIONS_SYNC_CAPABILITY = 'inline-annotations-v1';
export const REQUIRED_SYNC_CAPABILITIES = Object.freeze([
  'pdf-materials-v1',
  'note-ai-visibility-v1',
  'asset-lifecycle-v1',
  'atomic-entities-v2',
  'knowledge-items-v1',
  KNOWLEDGE_PROVENANCE_SYNC_CAPABILITY,
  KNOWLEDGE_AGENT_PROVENANCE_SYNC_CAPABILITY,
  KNOWLEDGE_MCP_PROVENANCE_SYNC_CAPABILITY,
  KNOWLEDGE_LIFECYCLE_SYNC_CAPABILITY,
  TRAINING_SYNC_CAPABILITY,
  INLINE_ANNOTATIONS_SYNC_CAPABILITY
]);
export const SYNC_CAPABILITIES = Object.freeze([...REQUIRED_SYNC_CAPABILITIES, 'attachment-transfer-v1'].sort());
export const syncContract = (): SyncContract => ({
  entitySchemaVersion: SYNC_ENTITY_SCHEMA_VERSION,
  capabilities: [...SYNC_CAPABILITIES]
});

export function assertSyncContract(value: unknown, { query = false } = {}): SyncContract {
  const input = value as SyncContractInput | null | undefined;
  const schema = query ? Number(input?.entitySchemaVersion) : input?.entitySchemaVersion;
  const capabilities =
    query && typeof input?.capabilities === 'string' ? input.capabilities.split(',') : input?.capabilities;
  if (
    schema !== SYNC_ENTITY_SCHEMA_VERSION ||
    !Array.isArray(capabilities) ||
    capabilities.length > SYNC_CAPABILITIES.length ||
    new Set(capabilities).size !== capabilities.length ||
    capabilities.some(value => typeof value !== 'string' || !SYNC_CAPABILITIES.includes(value)) ||
    REQUIRED_SYNC_CAPABILITIES.some(value => !capabilities.includes(value))
  ) {
    throw syncError(
      'SYNC_CLIENT_UPGRADE_REQUIRED',
      'PDF 资料与知识同步格式已升级，请更新应用与云端；本地数据和待同步修改已保留。',
      422
    );
  }
  return { entitySchemaVersion: schema, capabilities: [...(capabilities as string[])].sort() };
}

export function syncContractQuery() {
  const contract = syncContract();
  return `entitySchemaVersion=${contract.entitySchemaVersion}&capabilities=${encodeURIComponent(contract.capabilities.join(','))}`;
}

export function assertSnapshotBinding(
  value: unknown,
  contract: SyncContract,
  ownerId: string,
  epoch: string
): SyncSnapshotBinding {
  const snapshot = value as SyncSnapshotBinding | null | undefined;
  if (
    !snapshot ||
    snapshot.ownerId !== ownerId ||
    snapshot.datasetEpoch !== epoch ||
    snapshot.entitySchemaVersion !== contract.entitySchemaVersion ||
    JSON.stringify(snapshot.capabilities) !== JSON.stringify(contract.capabilities) ||
    typeof snapshot.snapshotId !== 'string' ||
    typeof snapshot.cursor !== 'string' ||
    !Number.isSafeInteger(snapshot.count) ||
    snapshot.count < 0
  ) {
    throw syncError('SYNC_SNAPSHOT_CONTRACT_MISMATCH', '初始化快照不属于当前同步格式或资料库，请重新建立基线。', 409);
  }
  return snapshot;
}

export function snapshotBinding<Snapshot extends SyncSnapshotBinding>(
  snapshot: Snapshot
): Pick<Snapshot, keyof SyncSnapshotBinding> {
  return Object.fromEntries(
    ['snapshotId', 'ownerId', 'datasetEpoch', 'entitySchemaVersion', 'capabilities', 'cursor', 'count'].map(key => [
      key,
      structuredClone(snapshot[key as keyof SyncSnapshotBinding])
    ])
  ) as Pick<Snapshot, keyof SyncSnapshotBinding>;
}
