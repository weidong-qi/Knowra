import { createAppError } from '../../../errors/app-error.js';
import { validateKnowledgeArtifactProvenance } from '../domain/knowledge-artifact-provenance-contract.ts';

import type { KnowledgeArtifactProvenance } from '../domain/knowledge-artifact-provenance-contract.ts';

export interface ProvenanceWriteOptions {
  upgradeLegacy?: boolean;
}
export interface ProvenanceListOptions {
  artifactId?: string;
}
/** 本地仓库的全部操作同步完成；异步持久化适配器不属于此接口。 */
export interface KnowledgeArtifactProvenanceRepository {
  create(record: unknown): KnowledgeArtifactProvenance;
  upgradeLegacy(record: unknown): KnowledgeArtifactProvenance;
  findById(id: string): KnowledgeArtifactProvenance | null;
  findByArtifactId(artifactId: string): KnowledgeArtifactProvenance | null;
  list(options?: ProvenanceListOptions): KnowledgeArtifactProvenance[];
  deleteByKnowledgeItemId(artifactId: string): KnowledgeArtifactProvenance[];
}
export interface KnowledgeArtifactProvenanceRepositoryOptions {
  /** 调用方提供有效记录；构造时沿用原行为，不额外校验或复制数组。 */
  records?: KnowledgeArtifactProvenance[];
  /** 同步持久化钩子。调用方不得传入异步回调；删除失败由外层事务回滚。 */
  onChange?: (records: KnowledgeArtifactProvenance[]) => void;
}

export function assertProvenanceWrite(
  existing: unknown,
  record: unknown,
  { upgradeLegacy = false }: ProvenanceWriteOptions = {}
): void {
  validateKnowledgeArtifactProvenance(record);
  if (!existing) return;
  validateKnowledgeArtifactProvenance(existing);
  // 校验返回副本，但冲突判断必须继续读取调用方传入的原对象。
  if (
    (existing as KnowledgeArtifactProvenance).provenanceHash === (record as KnowledgeArtifactProvenance).provenanceHash
  )
    return;
  if (
    upgradeLegacy &&
    (existing as KnowledgeArtifactProvenance).state === 'legacy-unavailable' &&
    (record as KnowledgeArtifactProvenance).state === 'recorded' &&
    (existing as KnowledgeArtifactProvenance).id === (record as KnowledgeArtifactProvenance).id &&
    (existing as KnowledgeArtifactProvenance).artifactId === (record as KnowledgeArtifactProvenance).artifactId
  )
    return;
  throw createAppError('KNOWLEDGE_ARTIFACT_PROVENANCE_CONFLICT', '已保存的来源事实不能覆盖或降级。', 409);
}

/** 无通用更新入口；upgradeLegacy 仅供合法历史 receipt 的受限回填。 */
export function createInMemoryKnowledgeArtifactProvenanceRepository({
  records = [],
  onChange
}: KnowledgeArtifactProvenanceRepositoryOptions = {}): KnowledgeArtifactProvenanceRepository {
  const write = (input: unknown, upgradeLegacy = false): KnowledgeArtifactProvenance => {
    const record = validateKnowledgeArtifactProvenance(input);
    const index = records.findIndex(item => item.id === record.id || item.artifactId === record.artifactId);
    const existing = records[index];
    assertProvenanceWrite(existing, record, { upgradeLegacy });
    if (existing?.provenanceHash === record.provenanceHash) return structuredClone(existing);
    if (index < 0) records.push(structuredClone(record));
    else records[index] = structuredClone(record);
    try {
      onChange?.(records);
    } catch (error) {
      if (index < 0) {
        const inserted = records.findIndex(item => item.id === record.id);
        if (inserted >= 0) records.splice(inserted, 1);
      } else records[index] = existing;
      throw error;
    }
    return structuredClone(record);
  };
  return {
    create: record => write(record),
    upgradeLegacy: record => write(record, true),
    findById: id => structuredClone(records.find(record => record.id === id) ?? null),
    findByArtifactId: artifactId => structuredClone(records.find(record => record.artifactId === artifactId) ?? null),
    list: ({ artifactId } = {}) =>
      structuredClone(records.filter(record => !artifactId || record.artifactId === artifactId)),
    deleteByKnowledgeItemId(artifactId) {
      const removed = records.filter(record => record.artifactId === artifactId);
      for (const record of removed) records.splice(records.indexOf(record), 1);
      if (removed.length) onChange?.(records);
      return structuredClone(removed);
    }
  };
}
