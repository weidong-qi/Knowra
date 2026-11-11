import { calculateContentHash } from '@study-accelerator/content-anchor';
import { createAppError } from '../../errors/app-error.ts';
import { hashRecord } from './record-contract.ts';
import { createMcpReadSnapshotGuard } from './mcp-read-snapshot.ts';
import { isEvidenceUsable } from '../knowledge/domain/evidence-applicability.ts';
import {
  validateKnowledgeArtifactProvenance,
  resolveKnowledgeArtifactProvenanceSource
} from '../knowledge/domain/knowledge-artifact-provenance-contract.ts';

const STATUSES = new Set(['candidate', 'confirmed', 'needsRevision', 'archived']);
const TYPES = new Set(['concept', 'fact', 'principle', 'process', 'algorithm', 'formula', 'comparison', 'application']);
const MODES = new Set(['manual', 'annotation', 'selection', 'ai']);
const MAX_CANDIDATES = 20;
const MAX_EVIDENCE = 160;
const id = value =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 200 &&
  value.trim() === value &&
  !/\p{Cc}/u.test(value) &&
  value.isWellFormed();
const unavailable = () =>
  Object.assign(createAppError('MCP_ENTITY_UNAVAILABLE', '对象不存在或不在当前授权范围。', 404), { status: 404 });
const copy = value => structuredClone(value);
const hash = value => calculateContentHash(JSON.stringify(value));

/**
 * 受信 MCP 投影。正文读取仅供已单独开启“全部知识正文”授权的配对，调用方必须在外发出口
 * 复核该实时开关；笔记授权不能替代知识正文授权。检查全部已知来源，但来源摘要不保证完整
 * 生成依赖。无来源/旧来源记录按当前 owner 与 dataset 总授权处理，不虚构笔记或空间归属。
 * 提议回执始终只输出核心账本确认的 ID 与审核状态，不受知识正文授权影响。
 */
/** @param {import('./boundary-types.ts').McpKnowledgeReadOptions} [options] */
export function createMcpKnowledgeReadService({ knowledge, ownerId, accessStore, knowledgeCommit } = {}) {
  const repos = knowledge?.repositories;
  const {
    remember,
    inherit,
    assertCurrent: assertOutputCurrent,
    captureNavigationGuard
  } = createMcpReadSnapshotGuard({ repos, ownerId, accessStore, unavailable });

  async function checked(operation) {
    try {
      return await operation();
    } catch {
      throw unavailable();
    }
  }

  function requireReadContext(access) {
    if (
      !repos?.knowledgeItemRepository ||
      !repos.knowledgeEvidenceRepository ||
      !repos.knowledgeArtifactProvenanceRepository ||
      !repos.noteVersionRepository ||
      !repos.knowledgeSpaceRepository ||
      !id(ownerId) ||
      typeof accessStore?.identity !== 'function' ||
      typeof access?.verifyRead !== 'function' ||
      typeof access.assertSearchSources !== 'function' ||
      typeof access.assertSearchGrant !== 'function'
    )
      throw unavailable();
  }
  function requireContext(access, pairing) {
    requireReadContext(access);
    if (!id(pairing?.pairingId) || typeof knowledgeCommit?.findCommitted !== 'function') throw unavailable();
  }

  async function snapshot(candidateId) {
    const [item, evidence, provenance] = await Promise.all([
      repos.knowledgeItemRepository.findById(candidateId),
      repos.knowledgeEvidenceRepository.list({ knowledgeItemId: candidateId }),
      repos.knowledgeArtifactProvenanceRepository.findByArtifactId(candidateId)
    ]);
    if (!Array.isArray(evidence) || evidence.length > MAX_EVIDENCE) throw unavailable();
    return copy({ item, evidence: [...evidence].sort((a, b) => a.id.localeCompare(b.id)), provenance });
  }

  async function readKnowledgeCandidate({ knowledgeId, grantId, access }) {
    const state = await snapshot(knowledgeId),
      item = state.item;
    if (
      !item ||
      item.id !== knowledgeId ||
      item.deletedAt ||
      !id(item.id) ||
      !STATUSES.has(item.reviewStatus) ||
      !TYPES.has(item.knowledgeType) ||
      !MODES.has(item.sourceMode) ||
      ['title', 'canonicalStatement', 'userExplanation'].some(
        key => typeof item[key] !== 'string' || !item[key].isWellFormed()
      ) ||
      typeof item.updatedAt !== 'string' ||
      !Number.isFinite(Date.parse(item.updatedAt))
    )
      throw unavailable();
    const record = state.provenance ? validateKnowledgeArtifactProvenance(state.provenance) : null;
    if (record && record.artifactId !== knowledgeId) throw unavailable();
    const reads = new Map(),
      versions = new Map(),
      annotations = new Map();
    let spaceId = null;
    async function readNote(noteId) {
      if (!id(noteId)) throw unavailable();
      if (!reads.has(noteId)) {
        const current = copy(await access.verifyRead({ grantId, noteId, tool: 'notes_read' }));
        if (
          current.note?.id !== noteId ||
          current.note.deleted ||
          current.note.deletedAt ||
          (current.note.aiVisibility !== undefined && current.note.aiVisibility !== 'normal') ||
          current.version?.noteId !== noteId ||
          typeof current.version.content !== 'string' ||
          current.version.contentHash !== current.contentHash ||
          calculateContentHash(current.version.content) !== current.contentHash ||
          current.note.rawMarkdown !== current.version.content ||
          (spaceId !== null && current.note.spaceId !== spaceId)
        )
          throw unavailable();
        const space = await repos.knowledgeSpaceRepository.findById(current.note.spaceId);
        if (space?.userId !== ownerId) throw unavailable();
        spaceId = current.note.spaceId;
        reads.set(noteId, current);
      }
      return reads.get(noteId);
    }
    async function readVersion(versionId, expectedNoteId = null) {
      if (!id(versionId)) throw unavailable();
      if (!versions.has(versionId))
        versions.set(versionId, copy(await repos.noteVersionRepository.findById(versionId)));
      const version = versions.get(versionId);
      if (!version || (expectedNoteId && version.noteId !== expectedNoteId)) throw unavailable();
      const current = await readNote(version.noteId);
      if (version.contentHash !== current.contentHash || version.content !== current.version.content)
        throw unavailable();
      return version;
    }
    const evidenceById = new Map();
    for (const evidence of state.evidence) {
      if (
        !id(evidence.id) ||
        evidenceById.has(evidence.id) ||
        evidence.knowledgeItemId !== knowledgeId ||
        evidence.status !== 'valid' ||
        !['manual', 'noteVersion', 'annotation'].includes(evidence.sourceType)
      )
        throw unavailable();
      evidenceById.set(evidence.id, evidence);
      // 已失效/陈旧的来源已在上面拒绝；退役状态不会擦掉仍有效来源的隐私义务。
      if (evidence.noteId) await readNote(evidence.noteId);
      if (evidence.noteVersionId) await readVersion(evidence.noteVersionId, evidence.noteId);
      if (
        (evidence.sourceType === 'noteVersion' && !evidence.noteVersionId) ||
        (evidence.sourceType === 'annotation' && !evidence.annotationId)
      )
        throw unavailable();
      if (evidence.annotationId) {
        const annotation = copy(await repos.contentAnnotationRepository?.findById(evidence.annotationId));
        if (
          !annotation ||
          annotation.lifecycleStatus === 'deleted' ||
          (evidence.noteId && annotation.noteId !== evidence.noteId) ||
          (evidence.noteVersionId && annotation.noteVersionId !== evidence.noteVersionId)
        )
          throw unavailable();
        annotations.set(annotation.id, annotation);
        await readNote(annotation.noteId);
        if (annotation.noteVersionId) await readVersion(annotation.noteVersionId, annotation.noteId);
        else throw unavailable();
      }
    }
    for (const source of record?.sources ?? []) {
      const evidence = evidenceById.get(source.evidenceId);
      if (!evidence) throw unavailable();
      const current = await readNote(source.noteId);
      const version = await readVersion(evidence.noteVersionId, source.noteId);
      // 只在关系完整性检查中忽略证据退役状态；来源笔记的当前授权与正文仍须全部通过。
      const resolved = resolveKnowledgeArtifactProvenanceSource({
        record,
        source,
        evidence: { ...evidence, applicabilityStatus: 'active' },
        noteVersion: version,
        note: current.note,
        knowledgeItem: { id: knowledgeId, reviewStatus: 'candidate', deletedAt: null }
      });
      if (resolved.sourceState !== 'available' || source.contentHash !== current.contentHash) throw unavailable();
      if (source.originNoteVersionId !== evidence.noteVersionId) {
        const original = await repos.noteVersionRepository.findById(source.originNoteVersionId);
        if (original && (original.noteId !== source.noteId || original.contentHash !== source.contentHash))
          throw unavailable();
        versions.set(source.originNoteVersionId, copy(original));
      }
    }
    const sources = [...reads.values()]
      .map(({ note, version, contentHash }) => ({ noteId: note.id, noteVersionId: version.id, contentHash }))
      .sort((a, b) => a.noteId.localeCompare(b.noteId));
    return {
      state,
      reads,
      versions,
      annotations,
      projection: {
        knowledgeId: item.id,
        title: item.title,
        canonicalStatement: item.canonicalStatement,
        userExplanation: item.userExplanation,
        knowledgeType: item.knowledgeType,
        reviewStatus: item.reviewStatus,
        sourceMode: item.sourceMode,
        updatedAt: item.updatedAt,
        sources
      }
    };
  }

  async function verifyKnowledgeSnapshot({ checkedItems, grantId, access, identity }) {
    const refs = [],
      checkedNotes = new Map();
    for (const value of checkedItems) {
      for (const [noteId, before] of value.reads) {
        if (checkedNotes.has(noteId) && hashRecord(checkedNotes.get(noteId)) !== hashRecord(before))
          throw unavailable();
        checkedNotes.set(noteId, before);
      }
      refs.push(...value.projection.sources);
    }
    for (const [noteId, before] of checkedNotes) {
      const current = await access.verifyRead({ grantId, noteId, tool: 'notes_read' });
      if (hashRecord(current) !== hashRecord(before)) throw unavailable();
    }
    // 放在逐来源异步复核之后，避免该阶段新增证据或编辑正文绕过先前快照。
    for (const value of checkedItems) {
      for (const [versionId, before] of value.versions) {
        if (hashRecord(await repos.noteVersionRepository.findById(versionId)) !== hashRecord(before))
          throw unavailable();
      }
      for (const [annotationId, before] of value.annotations) {
        if (hashRecord(await repos.contentAnnotationRepository.findById(annotationId)) !== hashRecord(before))
          throw unavailable();
      }
      if (hashRecord(await snapshot(value.projection.knowledgeId)) !== hashRecord(value.state)) throw unavailable();
    }
    if (hashRecord(await accessStore.identity()) !== hashRecord(identity)) throw unavailable();
    await access.assertSearchSources({ grantId, sourceRefs: refs });
    await access.assertSearchGrant({ grantId });
  }

  function checkProvenance(input, { pairingId, callId, requestId, candidateId }) {
    const record = validateKnowledgeArtifactProvenance(input);
    if (
      record.state !== 'recorded' ||
      record.executionMode !== 'mcp' ||
      record.artifactId !== candidateId ||
      record.origin.pairingId !== pairingId ||
      record.origin.callId !== callId ||
      record.origin.requestId !== requestId
    )
      throw unavailable();
    return record;
  }

  async function authorizedReceipt({ grantId, access, pairing, callId, requestId = null, discovery = null }) {
    requireContext(access, pairing);
    if (!id(callId) || !id(grantId)) throw unavailable();
    await access.assertSearchGrant({ grantId });
    const identity = copy(await accessStore.identity());
    const origin = { pairingId: pairing.pairingId, callId };
    const receipt = await knowledgeCommit.findCommitted({ origin, identity, mode: 'mcp' });
    if (
      !receipt ||
      !id(receipt.requestId) ||
      (requestId !== null && receipt.requestId !== requestId) ||
      !Array.isArray(receipt.candidates) ||
      !receipt.candidates.length ||
      receipt.candidates.length > MAX_CANDIDATES
    )
      throw unavailable();
    // requestId 与候选顺序均由提议计划生成，不能采用客户端任意指定的 ID。
    if (receipt.requestId !== `agent-proposal-${hash([`mcp-${pairing.pairingId}`, callId])}`) throw unavailable();
    const candidateIds = receipt.candidates.map(candidate => candidate?.candidateId);
    if (
      candidateIds.some((candidateId, index) => candidateId !== `knowledge-${hash([receipt.requestId, index])}`) ||
      new Set(candidateIds).size !== candidateIds.length
    )
      throw unavailable();
    if (
      discovery &&
      (discovery.length !== candidateIds.length || discovery.some(record => !candidateIds.includes(record.artifactId)))
    )
      throw unavailable();

    const snapshots = new Map(),
      reads = new Map(),
      spaces = new Map(),
      sourceRefs = [];
    const versions = new Map(),
      annotations = new Map();
    let evidenceCount = 0,
      batch = null;
    async function readNote(noteId, spaceId) {
      if (!id(noteId)) throw unavailable();
      if (!reads.has(noteId)) reads.set(noteId, copy(await access.verifyRead({ grantId, noteId, tool: 'notes_read' })));
      const current = reads.get(noteId);
      if (
        !current.note ||
        current.note.id !== noteId ||
        current.note.spaceId !== spaceId ||
        current.note.deleted ||
        current.note.deletedAt ||
        (current.note.aiVisibility !== undefined && current.note.aiVisibility !== 'normal') ||
        current.version?.noteId !== noteId ||
        typeof current.version.content !== 'string' ||
        current.contentHash !== calculateContentHash(current.version.content) ||
        current.version.contentHash !== current.contentHash ||
        current.note.rawMarkdown !== current.version.content
      )
        throw unavailable();
      if (!spaces.has(spaceId)) spaces.set(spaceId, copy(await repos.knowledgeSpaceRepository.findById(spaceId)));
      if (spaces.get(spaceId)?.userId !== ownerId) throw unavailable();
      return current;
    }

    for (const candidateId of candidateIds) {
      const state = await snapshot(candidateId);
      const record = checkProvenance(state.provenance, { ...origin, requestId: receipt.requestId, candidateId });
      const recordBatch = {
        inputHash: record.inputHash,
        outputHash: record.outputHash,
        spaceId: record.origin.spaceId
      };
      if (
        (batch && hashRecord(recordBatch) !== hashRecord(batch)) ||
        record.origin.receiptHash !==
          hashRecord({
            requestId: receipt.requestId,
            inputHash: record.inputHash,
            outputHash: record.outputHash,
            ...origin,
            candidateIds
          })
      )
        throw unavailable();
      batch ??= recordBatch;
      if (
        discovery &&
        !discovery.some(found => found.artifactId === candidateId && found.provenanceHash === record.provenanceHash)
      )
        throw unavailable();
      snapshots.set(candidateId, state);
      evidenceCount += state.evidence.length;
      if (evidenceCount > MAX_EVIDENCE) throw unavailable();
      const byId = new Map(state.evidence.map(evidence => [evidence.id, evidence]));
      if (byId.size !== state.evidence.length) throw unavailable();
      for (const evidence of state.evidence) {
        if (
          evidence.knowledgeItemId !== candidateId ||
          !isEvidenceUsable(evidence) ||
          !['noteVersion', 'annotation'].includes(evidence.sourceType) ||
          !id(evidence.noteVersionId)
        )
          throw unavailable();
        const current = await readNote(evidence.noteId, record.origin.spaceId);
        const version = copy(await repos.noteVersionRepository.findById(evidence.noteVersionId));
        if (
          !version ||
          version.noteId !== evidence.noteId ||
          version.contentHash !== current.contentHash ||
          version.content !== current.version.content
        )
          throw unavailable();
        versions.set(evidence.noteVersionId, version);
        if (evidence.sourceType === 'annotation') {
          const annotation = await repos.contentAnnotationRepository?.findById(evidence.annotationId);
          if (
            !annotation ||
            annotation.noteId !== evidence.noteId ||
            annotation.noteVersionId !== evidence.noteVersionId ||
            annotation.lifecycleStatus !== 'active'
          )
            throw unavailable();
          annotations.set(evidence.annotationId, copy(annotation));
        }
        sourceRefs.push({
          noteId: evidence.noteId,
          noteVersionId: current.version.id,
          contentHash: current.contentHash
        });
      }
      for (const source of record.sources) {
        const evidence = byId.get(source.evidenceId);
        const current = await readNote(source.noteId, record.origin.spaceId);
        const version = evidence && copy(await repos.noteVersionRepository.findById(evidence.noteVersionId));
        // 删除/归档知识只改变状态投影，不使仍可读的笔记来源失去授权。
        const resolved = resolveKnowledgeArtifactProvenanceSource({
          record,
          source,
          evidence,
          noteVersion: version,
          note: current.note,
          knowledgeItem: { id: candidateId, reviewStatus: 'candidate', deletedAt: null }
        });
        if (resolved.sourceState !== 'available' || source.contentHash !== current.contentHash) throw unavailable();
        if (source.originNoteVersionId !== evidence.noteVersionId) {
          const original = await repos.noteVersionRepository.findById(source.originNoteVersionId);
          if (original && (original.noteId !== source.noteId || original.contentHash !== source.contentHash))
            throw unavailable();
          versions.set(source.originNoteVersionId, copy(original));
        }
      }
    }
    // 全部依赖均检查，不以返回某个可见来源来掩盖另一个已私密、已移出范围或已变更的来源。
    for (const [noteId, before] of reads) {
      const current = await access.verifyRead({ grantId, noteId, tool: 'notes_read' });
      if (hashRecord(current) !== hashRecord(before)) throw unavailable();
    }
    for (const [candidateId, before] of snapshots) {
      if (hashRecord(await snapshot(candidateId)) !== hashRecord(before)) throw unavailable();
    }
    if (hashRecord(await accessStore.identity()) !== hashRecord(identity)) throw unavailable();
    await access.assertSearchSources({ grantId, sourceRefs });
    await access.assertSearchGrant({ grantId });
    const result = {
      requestId: receipt.requestId,
      candidateIds,
      candidates: candidateIds.map(candidateId => {
        const item = snapshots.get(candidateId).item;
        return {
          candidateId,
          reviewStatus: !item || item.deletedAt || !STATUSES.has(item.reviewStatus) ? 'unavailable' : item.reviewStatus
        };
      })
    };
    return remember(result, {
      grantId,
      identity,
      checkedItems: candidateIds.map((knowledgeId, index) => ({
        knowledgeId,
        state: snapshots.get(knowledgeId),
        reads: index === 0 ? reads : new Map(),
        versions: index === 0 ? versions : new Map(),
        annotations: index === 0 ? annotations : new Map()
      }))
    });
  }

  return {
    /** 必须在外发路径最后一个 await 之后同步调用；不支持同步证明的仓库直接拒绝。 */
    assertCurrent(value) {
      try {
        assertOutputCurrent(value);
      } catch {
        throw unavailable();
      }
    },
    /** 目录统计/分页也使用相同无异步间隙的最终检查，快照永远只保留在服务内部。 */
    captureNavigationGuard(input) {
      try {
        return captureNavigationGuard(input);
      } catch {
        throw unavailable();
      }
    },
    knowledgeRead({ grantId, access, knowledgeId }) {
      return checked(async () => {
        requireReadContext(access);
        if (!id(knowledgeId)) throw unavailable();
        await access.assertSearchGrant({ grantId });
        const identity = copy(await accessStore.identity());
        const value = await readKnowledgeCandidate({ knowledgeId, grantId, access });
        await verifyKnowledgeSnapshot({ checkedItems: [value], grantId, access, identity });
        return remember(value.projection, { grantId, identity, checkedItems: [value] });
      });
    },
    knowledgeList({ grantId, access }) {
      return checked(async () => {
        requireReadContext(access);
        await access.assertSearchGrant({ grantId });
        const identity = copy(await accessStore.identity());
        const before = copy(
            await repos.knowledgeItemRepository.list({ includeArchived: true, includeDeleted: true })
          ).sort((a, b) => a.id.localeCompare(b.id)),
          checkedItems = [];
        if (new Set(before.map(item => item.id)).size !== before.length) throw unavailable();
        // 权限与全部已知来源先于任何正文查询、排序、计数或游标。调用方只会收到可读投影。
        for (const item of before) {
          try {
            checkedItems.push(await readKnowledgeCandidate({ knowledgeId: item.id, grantId, access }));
          } catch {
            /* 直接读取统一不可用；清单不暴露隐藏条数、原因或文本。 */
          }
        }
        // 固定本次可见结果快照。后出现的可见知识留待下次调用，隐藏条目不参与外发指纹。
        await verifyKnowledgeSnapshot({ checkedItems, grantId, access, identity });
        return remember(
          checkedItems.map(value => value.projection),
          { grantId, identity, checkedItems }
        );
      });
    },
    proposalReceipt({ grantId, access, pairing, input, reused = false }) {
      return checked(async () => {
        if (!input || !Array.isArray(input.candidates) || typeof reused !== 'boolean') throw unavailable();
        const callId = input.idempotencyKey ?? `auto-${hash(input.candidates).slice(0, 32)}`;
        const result = await authorizedReceipt({ grantId, access, pairing, callId });
        return inherit({ requestId: result.requestId, candidateIds: result.candidateIds, saved: true, reused }, result);
      });
    },
    proposalGet({ grantId, access, pairing, requestId }) {
      return checked(async () => {
        requireContext(access, pairing);
        if (!id(requestId)) throw unavailable();
        await access.assertSearchGrant({ grantId });
        const records = (await repos.knowledgeArtifactProvenanceRepository.list()).filter(
          record =>
            record?.state === 'recorded' &&
            record.executionMode === 'mcp' &&
            record.origin?.pairingId === pairing.pairingId &&
            record.origin.requestId === requestId
        );
        if (
          !records.length ||
          records.length > MAX_CANDIDATES ||
          records.some(record => record.origin.callId !== records[0].origin.callId)
        )
          throw unavailable();
        return authorizedReceipt({
          grantId,
          access,
          pairing,
          callId: records[0].origin.callId,
          requestId,
          discovery: records
        });
      });
    }
  };
}
