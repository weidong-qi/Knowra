import { calculateContentHash } from '@study-accelerator/content-anchor';
import { createAppError } from '../../errors/app-error.js';
import { hashRecord } from './record-contract.ts';
import { runAsync, runSync } from './action-plan.ts';
import { verifyExtractionSourcePrivacy } from './knowledge-extraction-task-context.ts';
import { assertAiReadableNote } from './note-privacy.ts';
import {
  createKnowledgeArtifactProvenanceFromProposal,
  createKnowledgeArtifactProvenanceFromMcpProposal
} from './agent-knowledge-provenance.ts';

const refuse = (code, message, status = 409) => {
  throw createAppError(code, message, status);
};
const normalized = value => value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * 受信宿主的 Agent 知识候选保存入口：全部候选、证据与来源摘要在一次核心操作事务内提交，
 * 任一失败整体回滚；相同回合与工具调用重试时复用已提交的回执，不重复创建。
 * 只创建 candidate，不执行确认；调用方须先用 buildKnowledgeProposalPlan 校验提议。
 * mode 'mcp'：外部 AI 客户端经本机 MCP 提议。没有对话回合，改由调用方传入的 guard() 在事务内复核配对与开关，
 * 授权复核与范围检查与 agent 路径完全相同；幂等键是配对 ID 加调用 ID。
 */
export function createAgentKnowledgeCommitService({
  core,
  knowledge,
  ownerId,
  conversationStore,
  accessStore,
  asyncDomain = false,
  now = () => new Date()
}) {
  if (!core || !knowledge || !ownerId || !conversationStore || !accessStore) {
    throw new TypeError('Agent 知识保存需要核心操作账本、知识模块、对话与授权存储和 owner。');
  }
  const repos = knowledge.repositories,
    run = asyncDomain ? runAsync : runSync;

  const stamp = () => now().getTime();
  // 保存时在事务内重新复核回合与授权：取消、租约失效、授权撤销/收窄后迟到的提议不得入库。
  // 与动作服务一致，通过 peek 读取私有存储，本地同步事务内不会与取消/撤销交错。
  function* verifyOrigin({ plan, origin, identity, grantId, generation, mode, guard }) {
    const stale = () => refuse('AI_CANCELLED', '任务已取消或租约失效，未保存任何候选。');
    const revoked = () => refuse('AI_ACCESS_REVOKED', '本次运行授权已撤销或已变化，未保存任何候选。', 403);
    const conversationId = mode === 'mcp' ? `mcp-${origin.pairingId}` : origin.conversationId;
    if (mode === 'mcp') guard();
    else {
      const turn = yield conversationStore.peekTurn(origin.turnId);
      if (
        !turn ||
        turn.ownerId !== ownerId ||
        turn.datasetId !== identity.datasetId ||
        turn.datasetEpoch !== identity.datasetEpoch ||
        turn.spaceId !== plan.spaceId ||
        turn.conversationId !== origin.conversationId ||
        turn.status !== 'running' ||
        turn.leaseGeneration !== generation ||
        Date.parse(turn.leaseExpiresAt) <= stamp()
      )
        stale();
    }
    const grant = grantId ? yield accessStore.peek('aiRunGrant', grantId) : null;
    if (
      !grant ||
      grant.ownerId !== ownerId ||
      grant.conversationId !== conversationId ||
      Date.parse(grant.expiresAt) <= stamp() ||
      !grant.allowedTools?.includes('notes_read') ||
      grant.datasetId !== identity.datasetId ||
      grant.datasetEpoch !== identity.datasetEpoch ||
      grant.spaceId !== plan.spaceId
    )
      revoked();
    const policy = yield accessStore.peek('aiAccessPolicy', grant.policyId);
    if (
      !policy ||
      policy.ownerId !== ownerId ||
      policy.actorId !== grant.actorId ||
      policy.revokedAt ||
      policy.read !== true ||
      policy.revision !== grant.policyRevision ||
      Date.parse(policy.expiresAt) <= stamp() ||
      policy.datasetId !== identity.datasetId ||
      policy.datasetEpoch !== identity.datasetEpoch ||
      policy.spaceId !== plan.spaceId
    )
      revoked();
    const noteIds = [
      ...new Set(plan.candidates.flatMap(candidate => candidate.provenance.map(source => source.noteId)))
    ];
    for (const noteId of noteIds) {
      const note = yield repos.noteRepository.findById(noteId);
      if (
        !note ||
        note.spaceId !== plan.spaceId ||
        policy.excludedNoteIds.includes(note.id) ||
        (policy.scope.kind === 'fixed' && !policy.scope.noteIds.includes(note.id))
      )
        revoked();
      assertAiReadableNote(note);
      if (policy.scope.kind === 'folder') {
        let folderId = note.folderId,
          allowed = false;
        const seen = new Set();
        while (folderId && !seen.has(folderId)) {
          seen.add(folderId);
          const folder = yield repos.folderRepository.findById(folderId);
          if (!folder || folder.deletedAt || folder.spaceId !== plan.spaceId) break;
          if (folderId === policy.scope.folderId) {
            allowed = true;
            break;
          }
          folderId = folder.parentId;
        }
        if (!allowed) revoked();
      }
    }
  }
  function* verifySources(plan) {
    const sources = plan.candidates.flatMap(candidate => candidate.provenance);
    yield* verifyExtractionSourcePrivacy(repos, sources, plan.spaceId);
    const versions = new Map(),
      notes = new Map();
    for (const source of sources) {
      // 提议计划生成之后、保存之前笔记可能被改写：事务内对照当前正文，来源版本已不是当前正文就整批拒绝，不保存一开始就是 stale 的候选。
      if (!notes.has(source.noteId)) notes.set(source.noteId, yield repos.noteRepository.findById(source.noteId));
      const current = notes.get(source.noteId);
      if (!current || calculateContentHash(current.rawMarkdown) !== source.contentHash) {
        refuse('AI_PROPOSAL_SOURCE_STALE', '来源笔记已变化，未保存任何候选。请重新读取后再提交。');
      }
      if (!versions.has(source.noteVersionId))
        versions.set(source.noteVersionId, yield repos.noteVersionRepository.findById(source.noteVersionId));
      const version = versions.get(source.noteVersionId);
      if (
        !version ||
        version.noteId !== source.noteId ||
        version.contentHash !== source.contentHash ||
        version.content.slice(source.start, source.end) !== source.quoteText
      ) {
        refuse('AI_PROPOSAL_SOURCE_STALE', '来源笔记版本不可用或原文已变化，未保存任何候选。');
      }
    }
  }
  // 只比对仍然有效（未删除、未归档）的知识陈述；提示只含候选序号，不向模型泄露已有内容。
  function* rejectDuplicates(plan) {
    const known = new Set(
      (yield repos.knowledgeItemRepository.list({})).map(item => normalized(item.canonicalStatement))
    );
    const repeated = [];
    plan.candidates.forEach((candidate, index) => {
      const key = normalized(candidate.candidateInput.canonicalStatement);
      if (known.has(key)) repeated.push(index + 1);
      else known.add(key);
    });
    if (repeated.length) {
      throw Object.assign(
        createAppError('AI_PROPOSAL_DUPLICATE', '候选与已有知识或本次其他候选重复，未保存任何候选。', 409),
        { hint: `第 ${repeated.join('、')} 个候选的陈述与已有知识或本次其他候选重复，请删除后再提交其余候选。` }
      );
    }
  }
  function* apply({ plan, origin, identity, grantId, generation, provider, modelId, committedAt, mode, guard }) {
    yield* verifyOrigin({ plan, origin, identity, grantId, generation, mode, guard });
    const space = yield repos.knowledgeSpaceRepository.findById(plan.spaceId);
    if (!space || space.userId !== ownerId) refuse('AI_SCOPE_FORBIDDEN', '无权在该知识空间保存知识候选。', 403);
    yield* verifySources(plan);
    yield* rejectDuplicates(plan);
    const saved = [];
    for (const candidate of plan.candidates) {
      yield knowledge.knowledgeItemService.createCandidate(candidate.candidateInput);
      const provenance =
        mode === 'mcp'
          ? createKnowledgeArtifactProvenanceFromMcpProposal({ plan, candidate, origin, committedAt })
          : createKnowledgeArtifactProvenanceFromProposal({ plan, candidate, origin, provider, modelId, committedAt });
      yield repos.knowledgeArtifactProvenanceRepository.create(provenance);
      saved.push({ candidateId: candidate.candidateInput.id, provenanceId: provenance.id });
    }
    return { candidates: saved, saveState: 'localCommitted' };
  }

  const operationId = (origin, mode) =>
    `knowledge-propose-${hashRecord(mode === 'mcp' ? ['mcp', origin.pairingId, origin.callId] : [origin.turnId, origin.toolCallId])}`;
  return {
    async commit({ plan, origin, identity, grantId, generation, provider, modelId, mode = 'agent', guard = null }) {
      if (mode === 'mcp' && typeof guard !== 'function') throw new TypeError('MCP 保存必须提供事务内复核 guard。');
      const candidateIds = plan.candidates.map(candidate => candidate.candidateInput.id);
      const request = {
        ownerId,
        datasetId: identity.datasetId,
        datasetEpoch: identity.datasetEpoch,
        actorId: ownerId,
        spaceId: plan.spaceId,
        requestId: plan.requestId,
        operationId: operationId(origin, mode),
        kind: 'knowledge_propose',
        planHash: hashRecord({
          requestId: plan.requestId,
          inputHash: plan.inputHash,
          outputHash: plan.outputHash,
          candidateIds
        })
      };
      const committedAt = now().toISOString();
      return core.commit(request, () =>
        run(apply({ plan, origin, identity, grantId, generation, provider, modelId, committedAt, mode, guard }))
      );
    },
    /** 同一回合与工具调用已提交时返回回执摘要：用于响应丢失或重试后的对账，不重新校验提议。 */
    async findCommitted({ origin, identity, mode = 'agent' }) {
      const receipt = await core.get({
        ownerId,
        datasetId: identity.datasetId,
        operationId: operationId(origin, mode)
      });
      if (!receipt || receipt.kind !== 'knowledge_propose' || receipt.ownerId !== ownerId) return null;
      const candidates = [],
        cited = new Map();
      for (const { candidateId } of receipt.result.candidates) {
        const item = await Promise.resolve(repos.knowledgeItemRepository.findById(candidateId));
        const provenance = await Promise.resolve(
          repos.knowledgeArtifactProvenanceRepository.findByArtifactId(candidateId)
        );
        candidates.push({
          candidateId,
          title: item?.title ?? '',
          knowledgeType: item?.knowledgeType ?? 'concept',
          citationCount: provenance?.sources?.length ?? 0
        });
        for (const source of provenance?.sources ?? [])
          cited.set(`${source.noteId}:${source.start}:${source.end}`, {
            noteId: source.noteId,
            start: source.start,
            end: source.end
          });
      }
      return { requestId: receipt.requestId, candidates, citedRanges: [...cited.values()] };
    }
  };
}
