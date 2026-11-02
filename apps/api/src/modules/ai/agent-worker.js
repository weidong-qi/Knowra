import { authorizedHistory, authorizedQuestion, plainMessages } from './agent-request-context.js';
import { analyzeProposal, proposalProgress } from './proposal-progress.js';
// 保留既有调用方的进度文本入口，纯规则统一在 proposal-progress.js 维护。
export { proposalProgress } from './proposal-progress.js';
import { toolsForWriteIntent, toolsForAssistant } from './note-write-intent.js';
import { randomUUID } from 'node:crypto';
import { calculateContentHash } from '../knowledge/domain/note-version.js';
import { beijingDay } from './budget-ledger.js';
import { actualCostMicrounits, quoteWorstCase } from './worker.js';
import { hashRecord } from './record-contract.js';
import { createAuthorizedRetrieval } from './retrieval.js';
import { createAiRecoveryScope } from './recovery-scope.ts';
import { emptyAgentCheckpoint } from './agent-checkpoint.js';
import { ANNOTATIONS_TOOL, listAnnotatedRanges } from './annotation-read-tool.js';
import { FOLDERS_LIST_TOOL, NOTES_LIST_TOOL, CATALOG_TOOL_NAMES, catalogSpecsFromCalls } from './catalog-tool.ts';
import { KNOWLEDGE_PROPOSE_TOOL, proposeKnowledge } from './knowledge-propose-tool.js';
import {
  WEB_SEARCH_TOOL,
  createAssistantWebSearch,
  searchAssistantNotes,
  requestsAssistantArtifact,
  requestsKnowledgeProposal,
  renderExternalSources
} from './assistant-tools.js';

const MAX_ROUNDS = 4;
const MAX_TOOLS = 6;
// 仅明确要求提炼知识的回合使用：需要读取多处重点并分批提交候选。预算仍受 20 元日额度与 2 元单任务预留约束。
const PROPOSAL_ROUNDS = 8;
const PROPOSAL_TOOLS = 14;
// 推理模型的推理 token 计入完成量；1024 在真实验收中 5 次里有 3 次在写出回答前被截断。上限只在真正用到时才产生费用。
const MAX_OUTPUT_TOKENS = 4096;
const MAX_ATTEMPTS = 8;
const MAX_RUN_MS = 10 * 60_000;
const deterministicWriteFailure = code =>
  typeof code === 'string' &&
  (/^AI_NOTE_(TOOL_INVALID|TARGET_INVALID|TARGET_CONFLICT|REFERENCE_DENIED|BASELINE_INVALID|ANCHOR_INVALID|PATCH_INVALID|NO_CHANGE|PLAN_LIMIT|TARGET_NOT_READ)$/.test(
    code
  ) ||
    [
      'AI_REQUEST_INVALID',
      'AI_IDEMPOTENCY_CONFLICT',
      'AI_DATASET_STALE',
      'AI_SCOPE_FORBIDDEN',
      'AI_TOOL_ARGUMENTS_INVALID',
      'AI_ACTION_GRANT_REVOKED',
      'AI_ACTION_CONFLICT',
      'AI_ACTION_EXPIRED',
      'AI_ACTION_PLAN_CHANGED',
      'AI_ACTION_SOURCE_INVALID'
    ].includes(code));
const fail = (code, message) => {
  /** @type {Error & Partial<Pick<import('../../errors/app-error.ts').AppError, 'code'>>} */
  const error = new Error(message);
  error.code = code;
  throw error;
};
const safeCode = value => (typeof value === 'string' && /^AI_[A-Z0-9_]{1,64}$/.test(value) ? value : 'AI_TASK_FAILED');
const manifestCatalogDeps = manifest => ({
  noteIds: [
    ...new Set([
      ...(manifest.catalog ?? []).flatMap(item => item.noteIds ?? []),
      ...(manifest.historyCatalog?.noteIds ?? [])
    ])
  ],
  folderIds: [
    ...new Set([
      ...(manifest.catalog ?? []).flatMap(item => item.folderIds ?? []),
      ...(manifest.historyCatalog?.folderIds ?? [])
    ])
  ]
});
const refRange = ref => ({ noteId: ref.noteId, start: ref.start, end: ref.end });
const uniqueRefs = refs => [...new Map(refs.map(ref => [hashRecord(ref), ref])).values()];
const boundary = (content, position) =>
  position <= 0 ||
  position >= content.length ||
  !(
    content.charCodeAt(position - 1) >= 0xd800 &&
    content.charCodeAt(position - 1) <= 0xdbff &&
    content.charCodeAt(position) >= 0xdc00 &&
    content.charCodeAt(position) <= 0xdfff
  );

const TOOLS = Object.freeze([
  {
    name: 'notes_search',
    description: '检索当前授权笔记中的相关片段；索引无可用结果时使用关键词，可更换关键词再次搜索。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', maxLength: 300 },
        limit: { type: 'integer', minimum: 1, maximum: 5 },
        createdFrom: {
          type: 'string',
          description: '按创建时间筛选，开始 ISO 时间；时间查询同时提供 createdBefore，query 可省略。'
        },
        createdBefore: { type: 'string', description: '不包含的结束 ISO 时间；明确用户时区，不能猜测周起止。' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'notes_read',
    description:
      '读取当前授权笔记的一个片段，最多 1000 个 UTF-16 单位；只能使用搜索所得或用户明确提供的笔记 ID。读不完用 start=上段 end 续读。',
    parameters: {
      type: 'object',
      properties: {
        noteId: { type: 'string' },
        start: { type: 'integer', minimum: 0 },
        end: { type: 'integer', minimum: 1 }
      },
      required: ['noteId'],
      additionalProperties: false
    }
  }
]);

/** 有界自主助手：读取受授权约束，写工具只生成待审稿，网络仍由隔离 adapter 处理。 */
/** @param {import('./boundary-types.ts').AgentWorkerOptions} [options] */
export function createAiAgentWorker({
  store,
  access,
  modelSettings,
  budget,
  gateway,
  priceProfile: baseProfile,
  policy = null,
  allowExternal = false,
  authorizeAttempt = () => {},
  revokeAttempt = () => {},
  accountRef = 'deepseek-primary',
  now = () => new Date(),
  logger = console,
  retrievalCandidates = null,
  actions = null,
  webSearchAdapter = null,
  annotations = null,
  knowledgeProposals = false,
  knowledgeCommit = null
} = {}) {
  const priceProfile = baseProfile; // 外层只用于模型名等不随自定义单价变化的字段
  if (!store || !modelSettings || !budget || !gateway || !priceProfile) {
    throw new TypeError('AI Agent needs conversation store, model settings, budget and gateway');
  }
  const active = new Map();
  let closed = false,
    priceStaleWarned = false;
  const recovery = createAiRecoveryScope();
  const search = access ? createAuthorizedRetrieval({ access, candidateSource: retrievalCandidates }) : null;
  const provider = gateway.capabilities?.().provider;
  const webSearch = createAssistantWebSearch(webSearchAdapter);
  const proposalNames = new Set(['notes_create', 'notes_append', 'notes_propose_patch', 'notes_propose_organize']);
  const availableTools = (turn, canRead, finalOnly = false, artifactRequested = false, proposalRequested = false) =>
    finalOnly
      ? []
      : [
          ...(canRead ? TOOLS : []),
          ...(canRead && !turn.writeIntent ? [FOLDERS_LIST_TOOL, NOTES_LIST_TOOL] : []),
          ...(canRead && annotations && !turn.writeIntent ? [ANNOTATIONS_TOOL] : []),
          ...(canRead && proposalRequested ? [KNOWLEDGE_PROPOSE_TOOL] : []),
          ...(actions
            ? turn.writeIntent
              ? toolsForWriteIntent(turn.writeIntent)
              : artifactRequested
                ? toolsForAssistant({ canRead })
                : []
            : []),
          ...(webSearch.enabled ? [WEB_SEARCH_TOOL] : [])
        ];

  async function currentTurn(turnId, generation, signal) {
    const turn = await store.getTurn(turnId);
    if (
      signal?.aborted ||
      !turn ||
      turn.status !== 'running' ||
      turn.leaseGeneration !== generation ||
      Date.parse(turn.leaseExpiresAt) <= now().getTime()
    )
      fail('AI_CANCELLED', '任务已取消或租约失效。');
    return turn;
  }

  // 用量明细只含模型名、token 数和对话 ID；结果未知时 token 为空，仍记录这次请求发生过。
  const usageDetail = (turn, request, usage) => ({
    modelId: request.modelId,
    conversationId: turn.conversationId,
    ...(usage?.unknown === false
      ? {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheHitTokens: usage.cacheHitTokens ?? null
        }
      : {})
  });

  async function settleOnFailure(attemptId, reserved, sent, error, detail) {
    if (!reserved) return;
    const disposition = sent ? 'unknown' : 'released';
    try {
      await budget.settle({ accountRef, attemptId, disposition, ...(sent ? { usage: detail } : {}) });
    } catch (fault) {
      logger.warn?.('Agent budget settlement deferred', { code: safeCode(fault?.code) });
      return;
    }
    try {
      await store.advanceModelAttempt(attemptId, disposition, { errorCode: safeCode(error?.code) });
    } catch (fault) {
      logger.warn?.('Agent attempt settlement deferred', { code: safeCode(fault?.code) });
    }
  }

  async function paidCall(turn, generation, request, manifest, grantId, credentialRef, signal) {
    if (provider !== 'mock' && !allowExternal) fail('AI_EGRESS_NOT_READY', '当前运行端未启用模型外发。');
    if ((await store.listModelAttempts(turn.turnId)).length >= MAX_ATTEMPTS)
      fail('AI_ATTEMPT_LIMIT', '模型调用次数已达到上限。');
    const plan = policy ? await policy.snapshot() : null;
    const priceProfile = plan?.profile ?? baseProfile;
    const quote = quoteWorstCase({
      request,
      priceProfile,
      now: now(),
      writeToolName: turn.writeIntent?.toolName ?? null,
      assistantTools: !turn.writeIntent
    });
    if (quote.priceStale && !priceStaleWarned) {
      priceStaleWarned = true;
      logger.warn?.('AI price profile is past its review date; costs are estimates', { version: priceProfile.version });
    }
    if (manifest && manifest.payloadHash !== quote.payloadHash) fail('AI_PAYLOAD_STALE', '实际请求与发送清单不一致。');
    const attemptId = randomUUID(),
      day = beijingDay(now());
    const attempt = await store.createModelAttempt(turn.turnId, generation, {
      attemptId,
      modelId: request.modelId,
      payloadHash: quote.payloadHash,
      manifestId: manifest?.manifestId ?? null,
      grantId: grantId ?? null,
      reservedMicrounits: quote.reservedMicrounits
    });
    let reserved = false,
      sent = false,
      settled = false;
    try {
      const reservation = await budget.reserve({
        accountRef,
        jobId: turn.turnId,
        attemptId,
        priceVersion: priceProfile.version,
        reservedMicrounits: quote.reservedMicrounits,
        day,
        ...(plan ? { limits: plan.limits } : {})
      });
      reserved = true;
      if (
        reservation?.accountRef !== accountRef ||
        reservation.jobId !== turn.turnId ||
        reservation.attemptId !== attemptId ||
        reservation.priceVersion !== priceProfile.version ||
        reservation.day !== day ||
        reservation.reservedMicrounits !== quote.reservedMicrounits
      ) {
        fail('AI_BUDGET_INVALID', '预算回执与模型尝试不一致。');
      }
      await store.advanceModelAttempt(attemptId, 'reserved', { generation });
      await currentTurn(turn.turnId, generation, signal);
      if (beijingDay(now()) !== day) fail('AI_BUDGET_DAY_CHANGED', '预算日期已切换。');
      if (manifest)
        await access.assertRequest({ grantId, manifestId: manifest.manifestId, request, recipient: 'deepseek' });
      quoteWorstCase({
        request,
        priceProfile,
        now: now(),
        writeToolName: turn.writeIntent?.toolName ?? null,
        assistantTools: !turn.writeIntent
      });
      // 快照之后到真正发送之间用户可能点了暂停：在标记“已发送”前再复核一次（此时抛错会释放预留）。
      if (policy) await policy.assertRunnable();
      await store.advanceModelAttempt(attemptId, 'sent', { generation });
      sent = true;
      authorizeAttempt(attemptId);
      const result = await gateway.complete({
        ...request,
        credentialRef,
        signal,
        budgetAttemptId: attemptId,
        verifyBeforeSend: async () => {
          await currentTurn(turn.turnId, generation, signal);
          if (manifest)
            await access.assertRequest({ grantId, manifestId: manifest.manifestId, request, recipient: 'deepseek' });
        }
      });
      const usage = result.usage;
      const actual =
        usage?.unknown === false &&
        Number.isSafeInteger(usage.inputTokens) &&
        usage.inputTokens >= 0 &&
        Number.isSafeInteger(usage.outputTokens) &&
        usage.outputTokens >= 0
          ? actualCostMicrounits(usage, priceProfile)
          : null;
      if (
        actual !== null &&
        (actual > quote.reservedMicrounits || usage.inputTokens > 100_000 || usage.outputTokens > 20_000)
      )
        fail('AI_USAGE_LIMIT', '模型用量超过预留或单次上限。');
      const disposition = actual === null ? 'unknown' : 'settled';
      await budget.settle({
        accountRef,
        attemptId,
        disposition,
        actualMicrounits: actual,
        usage: usageDetail(turn, request, usage)
      });
      settled = true;
      try {
        await currentTurn(turn.turnId, generation, signal);
      } catch (error) {
        await store.advanceModelAttempt(attemptId, disposition, { actualMicrounits: actual });
        throw error;
      }
      await store.advanceModelAttempt(attemptId, disposition, {
        generation,
        actualMicrounits: actual,
        modelResult: result
      });
      return { result, attemptOrdinal: attempt.ordinal };
    } catch (error) {
      if (!settled) await settleOnFailure(attemptId, reserved, sent, error, usageDetail(turn, request, null));
      throw error;
    } finally {
      revokeAttempt(attemptId);
    }
  }

  async function historyFor(turn) {
    const messages = await store.listMessages(turn.conversationId, 0, 100_000);
    const current = messages.find(row => row.messageId === turn.userMessageId);
    if (!current) fail('AI_INPUT_INVALID', '当前提问未找到。');
    const prior = messages.filter(item => item.sequence < current.sequence);
    return prior.slice(-12);
  }

  async function readTool(grantId, args) {
    if (
      !args ||
      Object.keys(args).some(key => !['noteId', 'start', 'end'].includes(key)) ||
      typeof args.noteId !== 'string' ||
      !args.noteId ||
      args.noteId.length > 128
    ) {
      fail('AI_TOOL_ARGUMENTS_INVALID', '阅读参数无效。');
    }
    const { note, version, contentHash } = await access.verifyRead({ grantId, noteId: args.noteId });
    const content = version.content;
    const start = args.start ?? 0,
      requestedEnd = args.end ?? start + 1000;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(requestedEnd) ||
      start < 0 ||
      requestedEnd <= start ||
      start >= content.length ||
      !boundary(content, start)
    ) {
      fail('AI_TOOL_ARGUMENTS_INVALID', '阅读范围无效。');
    }
    let end = Math.min(requestedEnd, start + 1000, content.length);
    while (!boundary(content, end)) end--;
    if (end <= start) fail('AI_TOOL_ARGUMENTS_INVALID', '阅读范围无效。');
    const text = content.slice(start, end);
    const ref = {
      noteId: note.id,
      noteVersionId: version.id,
      contentHash,
      start,
      end,
      quoteHash: calculateContentHash(text)
    };
    return { resultJson: { noteId: note.id, title: note.title, text }, sourceRefs: [ref] };
  }

  const proposalsEnabled = async () => {
    try {
      return Boolean(typeof knowledgeProposals === 'function' ? await knowledgeProposals() : knowledgeProposals);
    } catch {
      return false;
    }
  };

  /** @returns {Promise<import('./boundary-types.ts').ToolOutcome>} */
  async function executeTool(
    turn,
    generation,
    grantId,
    call,
    signal,
    sourceRefs,
    userMessage,
    modelId = null,
    proposalsOn = false,
    catalogDeps = null
  ) {
    await currentTurn(turn.turnId, generation, signal);
    const writeCall = proposalNames.has(call.name) && (!turn.writeIntent || call.name === turn.writeIntent.toolName);
    if (!writeCall && call.name !== 'web_search' && (!grantId || !access))
      fail('AI_SCOPE_FORBIDDEN', '当前会话没有笔记读取授权。');
    if (typeof call.id !== 'string' || !call.id || call.id.length > 128)
      fail('AI_TOOL_INVALID', '模型工具调用 ID 无效。');
    const callId = hashRecord({ turnId: turn.turnId, providerCallId: call.id });
    const persisted = await store.appendToolCall(turn.turnId, generation, {
      callId,
      toolName: call.name,
      argumentsJson: call.arguments,
      maxCalls: proposalsOn && !turn.writeIntent && requestsKnowledgeProposal(userMessage) ? PROPOSAL_TOOLS : 6
    });
    if (persisted.status !== 'requested') {
      for (const ref of persisted.sourceRefs) await verifyRef(grantId, ref);
      if (persisted.resultJson?.actionId)
        await actions.resumeForTurn(persisted.resultJson.actionId, turn, { grantId, sourceRefs, catalogDeps });
      return toolOutcome(persisted);
    }
    let receiptPending = false;
    try {
      let outcome;
      if (writeCall) {
        if (call.name !== 'notes_create') {
          if (!grantId || !access) fail('AI_SCOPE_FORBIDDEN', '修改已有笔记需要当前读取授权。');
          const targets =
            call.name === 'notes_propose_organize'
              ? call.arguments?.changes?.map(change => change?.noteId)
              : [call.arguments?.noteId];
          if (!Array.isArray(targets) || !targets.length || targets.length > 20)
            fail('AI_TOOL_ARGUMENTS_INVALID', '修改目标无效。');
          for (const noteId of targets) await access.verifyRead({ grantId, noteId });
          if (!turn.writeIntent && targets.some(noteId => !sourceRefs.some(ref => ref.noteId === noteId))) {
            fail('AI_NOTE_TARGET_NOT_READ', '请先读取目标笔记，再提出对应原文的差异稿。');
          }
        }
        if (!actions) fail('AI_ACTION_UNAVAILABLE', '写入计划服务不可用。');
        // 目录依赖是独立元数据，不借用正文片段表达，也不影响“改写已有笔记前必须先读”的判断。
        const action = turn.writeIntent
          ? await actions.planForTurn(turn, turn.writeIntent, call, { sourceRefs, grantId, catalogDeps })
          : await actions.planForAssistantTurn(turn, call, { sourceRefs, grantId, catalogDeps });
        receiptPending = true;
        await actions.resumeForTurn(action.actionId, turn, { sourceRefs, grantId, catalogDeps });
        outcome = {
          resultJson: { actionId: action.actionId, planHash: action.plan.planHash, status: action.status },
          sourceRefs: []
        };
      } else if (call.name === 'notes_search') {
        const found = await searchAssistantNotes({ search, access, grantId, args: call.arguments });
        outcome = {
          resultJson: {
            hits: found.hits.map(hit => ({ noteId: hit.noteId, title: hit.title, ref: hit.ref, text: hit.text })),
            inspected: found.inspected,
            truncated: found.truncated,
            mode: found.mode,
            ...(found.fallbackReason ? { fallbackReason: found.fallbackReason } : {})
          },
          sourceRefs: found.hits.map(hit => hit.ref)
        };
      } else if (CATALOG_TOOL_NAMES.includes(call.name) && !turn.writeIntent) {
        // 结果不经 sources 回到模型：发送前由授权服务按同一参数重建 catalog，并写入请求清单。
        const listed = await access.listCatalog({ grantId, toolName: call.name, args: call.arguments });
        outcome = {
          resultJson: { catalog: true, kind: listed.spec.kind, total: listed.total, returned: listed.returned },
          sourceRefs: []
        };
      } else if (call.name === 'notes_read') outcome = await readTool(grantId, call.arguments);
      else if (call.name === 'annotations_list' && annotations && !turn.writeIntent) {
        outcome = await listAnnotatedRanges({ access, repository: annotations, grantId, args: call.arguments });
      } else if (
        call.name === 'knowledge_propose' &&
        proposalsOn &&
        !turn.writeIntent &&
        requestsKnowledgeProposal(userMessage)
      ) {
        outcome = await proposeKnowledge({
          access,
          grantId,
          args: call.arguments,
          sourceRefs,
          turnId: turn.turnId,
          callId,
          commit: knowledgeCommit
            ? (() => {
                const origin = { conversationId: turn.conversationId, turnId: turn.turnId, toolCallId: callId };
                const identity = { datasetId: turn.datasetId, datasetEpoch: turn.datasetEpoch };
                return {
                  find: () => knowledgeCommit.findCommitted({ origin, identity }),
                  // 模拟适配器不是真实供应商，来源摘要以 simulated 标明，契约不允许 agent 记录使用 mock。
                  save: plan =>
                    knowledgeCommit.commit({
                      plan,
                      modelId,
                      origin,
                      identity,
                      grantId,
                      generation,
                      provider: provider === 'mock' ? 'simulated' : provider
                    })
                };
              })()
            : null
        });
      } else if (call.name === 'web_search') outcome = await webSearch.search(call.arguments, userMessage, signal);
      else fail('AI_TOOL_INVALID', '模型请求了未开放的工具。');
      receiptPending = true;
      await currentTurn(turn.turnId, generation, signal);
      await store.settleToolCall(turn.turnId, generation, callId, outcome);
      return toolOutcome(outcome);
    } catch (error) {
      if (!receiptPending && (!writeCall || deterministicWriteFailure(error?.code)))
        await store
          .settleToolCall(turn.turnId, generation, callId, { errorCode: safeCode(error?.code) })
          .catch(() => undefined);
      if (
        [
          'AI_TOOL_ARGUMENTS_INVALID',
          'AI_SEARCH_INVALID',
          'AI_SCOPE_FORBIDDEN',
          'AI_WEB_QUERY_REQUIRES_CLARIFICATION',
          'AI_NOTE_TARGET_NOT_READ',
          'AI_PROPOSAL_NOT_READ',
          'AI_PROPOSAL_SOURCE_STALE',
          'AI_PROPOSAL_CITATION_INVALID',
          'AI_PROPOSAL_INVALID',
          'AI_PROPOSAL_DUPLICATE'
        ].includes(error?.code)
      ) {
        return {
          sourceRefs: [],
          truncated: false,
          fallback: false,
          inspected: 0,
          errorCode: safeCode(error?.code),
          ...(typeof error?.hint === 'string' ? { hint: error.hint.slice(0, 300) } : {})
        };
      }
      throw error;
    }
  }

  async function verifyRef(grantId, ref) {
    if (!grantId || !access) fail('AI_SCOPE_FORBIDDEN', '来源需要当前读取授权。');
    const { version, contentHash } = await access.verifyRead({ grantId, noteId: ref.noteId });
    if (
      version.id !== ref.noteVersionId ||
      contentHash !== ref.contentHash ||
      calculateContentHash(version.content.slice(ref.start, ref.end)) !== ref.quoteHash
    ) {
      fail('AI_SOURCE_STALE', '恢复或草稿来源已经变化，请重新生成。');
    }
  }

  function toolOutcome(outcome) {
    return {
      sourceRefs: outcome.sourceRefs ?? [],
      truncated: outcome.resultJson?.truncated === true,
      fallback: outcome.resultJson?.mode === 'keyword_fallback',
      inspected: outcome.resultJson?.inspected ?? 0,
      actionId: outcome.resultJson?.actionId,
      catalog: outcome.resultJson?.catalog === true,
      progress: outcome.resultJson?.status === 'saved',
      external: outcome.resultJson?.sourceType === 'external' ? outcome.resultJson : null,
      ...(outcome.errorCode ? { errorCode: outcome.errorCode } : {}),
      ...(outcome.hint ? { hint: outcome.hint } : {})
    };
  }

  async function draftForContinuation(turn, prior, grantId, content) {
    if (!actions || !/(短|长|精简|扩写|补充|继续|再|改|调整|删|加|润色|这份|这个|它)/.test(content)) return '';
    const last = prior.at(-1);
    if (last?.role !== 'assistant') return '';
    const calls = await store.listToolCalls(last.turnId);
    const actionId = calls.findLast(call => call.status === 'succeeded' && call.resultJson?.actionId)?.resultJson
      .actionId;
    if (!actionId) return '';
    const action = await actions.get(actionId);
    if (
      action.ownerId !== turn.ownerId ||
      action.spaceId !== turn.spaceId ||
      action.datasetId !== turn.datasetId ||
      action.datasetEpoch !== turn.datasetEpoch ||
      !['awaitingApproval', 'authorized'].includes(action.status) ||
      action.grant.revoked
    )
      return '';
    for (const ref of action.grant.sourceRefs ?? []) await verifyRef(grantId, ref);
    // 待审稿里的目录标题、目录名依赖：按本轮授权复核；没有读取授权就不能续改含这些资料的草稿。
    const catalogDeps = action.grant.catalogDeps ?? null;
    if (catalogDeps && (catalogDeps.noteIds.length || catalogDeps.folderIds.length)) {
      if (!grantId || !access) fail('AI_SCOPE_FORBIDDEN', '续改含目录资料的待审稿需要当前读取授权。');
      await access.assertCatalogDeps({ grantId, deps: catalogDeps });
    }
    for (const item of action.plan.items)
      if (item.before) {
        if (!grantId) return '';
        await access.verifyRead({ grantId, noteId: item.after.id });
      }
    const drafts = action.plan.items.map(item => ({
      noteId: item.after.id,
      title: item.after.title,
      rawMarkdown: item.after.rawMarkdown
    }));
    const context = JSON.stringify({ actionId, toolName: action.plan.toolName, drafts });
    if (context.length > 2400) fail('AI_DRAFT_CONTEXT_LIMIT', '待审稿超出本轮续改上下文，请在收件箱明确局部修改内容。');
    return {
      content: `\n本会话用户正在继续修改的待审稿（仅本会话上下文，不是正式笔记；修改时复用 actionId）：${context}`,
      sourceRefs: action.grant.sourceRefs ?? [],
      catalogDeps
    };
  }

  function citedResult(result, request, manifest) {
    const payload = result.json;
    // 系统提示允许“未用资料可返回空 citations”；漏写该字段等价于空，不作为结构错误（引用一旦给出仍逐条严格校验）。
    const given = payload && payload.citations === undefined ? [] : payload?.citations;
    if (
      !payload ||
      typeof payload.answer !== 'string' ||
      !payload.answer.trim() ||
      payload.answer.length > 120000 ||
      !Array.isArray(given) ||
      given.length > 32
    ) {
      fail('AI_OUTPUT_INVALID', '模型回答结构无效。');
    }
    const sources = JSON.parse(request.messages.at(-1).content).sources;
    const citations = [];
    for (const item of given) {
      if (
        !item ||
        !/^S\d{1,3}$/.test(item.sourceId) ||
        typeof item.quote !== 'string' ||
        !item.quote ||
        item.quote.length > 1000
      )
        fail('AI_CITATION_INVALID', '模型引用格式无效。');
      const source = sources[Number(item.sourceId.slice(1)) - 1];
      const offset = source?.text.indexOf(item.quote) ?? -1;
      if (!source || offset < 0) fail('AI_CITATION_INVALID', '模型引用不在已发送的来源中。');
      citations.push({
        noteId: source.noteId,
        noteVersionId: source.noteVersionId,
        contentHash: source.contentHash,
        start: source.start + offset,
        end: source.start + offset + item.quote.length,
        quoteHash: calculateContentHash(item.quote)
      });
    }
    const sourceRefs = uniqueRefs([...manifest.sources, ...manifest.historySources]);
    return {
      content: payload.answer.trim(),
      sourceRefs,
      citations,
      provenanceManifestId: manifest.manifestId,
      sourceFree: sourceRefs.length === 0
    };
  }

  async function runClaimed(turn, signal) {
    const generation = turn.leaseGeneration;
    const conversation = await store.getConversation(turn.conversationId);
    if (!conversation || conversation.ownerId !== turn.ownerId) fail('AI_CONVERSATION_NOT_FOUND', '会话不存在。');
    const user = (await store.listMessages(turn.conversationId, 0, 100_000)).find(
      row => row.messageId === turn.userMessageId
    );
    if (!user || user.content.length > 4000) fail('AI_INPUT_TOO_LARGE', '单次提问不能超过 4000 字符。');
    let artifactRequested = requestsAssistantArtifact(user.content);
    // 开关在回合开始时读取一次并固定下来：回合中途切换不影响本回合；读取失败按关闭处理。
    const proposalsOn = knowledgeCommit ? await proposalsEnabled() : false;
    const proposalRequested = proposalsOn && !turn.writeIntent && requestsKnowledgeProposal(user.content);
    const maxRounds = proposalRequested ? PROPOSAL_ROUNDS : MAX_ROUNDS,
      maxTools = proposalRequested ? PROPOSAL_TOOLS : MAX_TOOLS;
    const reference = await modelSettings.credentialReference();
    if (!reference || reference.modelId !== priceProfile.modelId)
      fail('AI_NOT_CONFIGURED', '请先配置已核价的 deepseek-flash 模型。');
    if (provider !== 'mock' && !allowExternal) fail('AI_GENERATION_UNAVAILABLE', '当前运行端未启用模型外发。');
    const prior = await historyFor(turn);
    const grant = turn.requestedPolicyId
      ? await access?.createRunGrant({ policyId: turn.requestedPolicyId, conversationId: turn.conversationId })
      : null;
    if (turn.writeIntent && !actions) fail('AI_ACTION_UNAVAILABLE', '当前写入计划服务不可用。');
    if (turn.writeIntent?.noteId) {
      if (!grant) fail('AI_SCOPE_FORBIDDEN', '已有笔记写入需要读取授权。');
      await access.verifyRead({ grantId: grant.grantId, noteId: turn.writeIntent.noteId });
    }
    if (turn.requestedPolicyId && !grant) fail('AI_ACCESS_REVOKED', '读取授权不可用。');
    const draft = await draftForContinuation(turn, prior, grant?.grantId, user.content);
    const draftContext = (draft || null)?.content ?? '';
    artifactRequested ||= Boolean(draftContext);
    const { entries: history, plainContext } = grant ? authorizedHistory(prior) : { entries: [], plainContext: '' };
    const checkpoint = turn.checkpoint ?? emptyAgentCheckpoint();
    let sourceRefs = checkpoint.initialSearchDone
      ? checkpoint.sourceRefs
      : grant
        ? uniqueRefs(
            prior
              .filter(row => row.role === 'assistant')
              .flatMap(row => (row.citations?.length ? row.citations : row.sourceRefs))
          ).slice(-8)
        : [];
    sourceRefs = uniqueRefs([...sourceRefs, ...((draft || null)?.sourceRefs ?? [])]);
    for (const ref of sourceRefs) await verifyRef(grant?.grantId, ref);
    let searchTruncated = checkpoint.searchTruncated;
    let searchFallback = checkpoint.searchFallback;
    let externalContext = checkpoint.externalContext;
    let toolFeedback = checkpoint.toolFeedback;
    let totalTools = Math.max(checkpoint.totalTools, (await store.listToolCalls(turn.turnId)).length);
    let forceAnswer = checkpoint.forceAnswer;
    let budgetCapacity = null,
      proposalNudges = 0,
      proposalNudge = ''; // 本轮运行内的临时状态：请求预算容量、已提醒次数、一次性提醒
    let noProgressRounds = checkpoint.noProgressRounds,
      citationRepairs = 0;
    let handledAttemptOrdinal = checkpoint.handledAttemptOrdinal;
    let nextRound = checkpoint.nextRound;
    let initialSearchDone = checkpoint.initialSearchDone;
    const save = async () =>
      store.saveCheckpoint(turn.turnId, generation, {
        version: 1,
        nextRound,
        totalTools,
        initialSearchDone,
        sourceRefs,
        searchTruncated,
        searchFallback,
        forceAnswer,
        noProgressRounds,
        handledAttemptOrdinal,
        externalContext,
        toolFeedback
      });
    // 用户提到文件夹/目录时，像首轮自动检索一样先在服务端预取目录清单：命中目录名则直接列出该目录的笔记，否则列出顶层目录。
    // 模型自己连续调用两次目录工具并不稳定，预取让第一轮就能依据真实目录作答；失败只跳过预取，不让回合失败。
    // 问“哪篇笔记重点最多”这类排名问题时，直接预取按重点数排序的笔记列表（可限定在提到的目录内）。
    const rankHighlights = /(重点|标注|划线).{0,8}(最多|最少|多少|排名|排行)|(最多|最少).{0,6}(重点|标注|划线)/.test(
      user.content
    );
    if (
      !initialSearchDone &&
      grant &&
      !turn.writeIntent &&
      (rankHighlights || /(文件夹|目录|分类|夹下|夹里|夹中)/.test(user.content))
    ) {
      const matched = await access.matchCatalogFolders({ grantId: grant.grantId, text: user.content }).catch(() => []);
      const ranked = rankHighlights ? { sortBy: 'annotations', limit: 10 } : {};
      const plans = matched.length
        ? matched.map(item => [
            'notes_list',
            { folderId: item.folderId, ...(rankHighlights ? { ...ranked, recursive: true } : {}) }
          ])
        : rankHighlights
          ? [['notes_list', ranked]]
          : [['folders_list', {}]];
      for (const [toolName, args] of plans) {
        const callId = hashRecord({ turnId: turn.turnId, initialCatalog: toolName, args });
        const prefetch = await store.appendToolCall(turn.turnId, generation, {
          callId,
          toolName,
          argumentsJson: args,
          maxCalls: maxTools
        });
        if (prefetch.status !== 'requested') continue;
        try {
          const listed = await access.listCatalog({ grantId: grant.grantId, toolName, args });
          await currentTurn(turn.turnId, generation, signal);
          await store.settleToolCall(turn.turnId, generation, callId, {
            resultJson: { catalog: true, kind: listed.spec.kind, total: listed.total, returned: listed.returned },
            sourceRefs: []
          });
        } catch (error) {
          await store
            .settleToolCall(turn.turnId, generation, callId, { errorCode: safeCode(error?.code) })
            .catch(() => undefined);
          if (error?.code === 'AI_CANCELLED') throw error;
        }
      }
    }
    if (!initialSearchDone && grant && /(我的|我记|笔记|资料|文档|记录|之前|根据|比较|总结|引用)/.test(user.content)) {
      const callId = hashRecord({ turnId: turn.turnId, initialSearch: true });
      const initialCall = await store.appendToolCall(turn.turnId, generation, {
        callId,
        toolName: 'notes_search',
        argumentsJson: { query: user.content, limit: 3, origin: 'automatic' },
        maxCalls: maxTools
      });
      try {
        const initial =
          initialCall.status === 'succeeded'
            ? { ...initialCall.resultJson, hits: initialCall.resultJson.hits }
            : await search.search({ grantId: grant.grantId, query: user.content, limit: 3 });
        await currentTurn(turn.turnId, generation, signal);
        if (initialCall.status === 'requested')
          await store.settleToolCall(turn.turnId, generation, callId, {
            resultJson: {
              hits: initial.hits.map(hit => ({ noteId: hit.noteId, title: hit.title, ref: hit.ref, text: hit.text })),
              inspected: initial.inspected,
              truncated: initial.truncated,
              mode: initial.mode,
              ...(initial.fallbackReason ? { fallbackReason: initial.fallbackReason } : {})
            },
            sourceRefs: initial.hits.map(hit => hit.ref)
          });
        sourceRefs = uniqueRefs([...sourceRefs, ...initial.hits.map(hit => hit.ref)]).slice(-12);
        searchTruncated = initial.truncated;
        searchFallback = initial.mode === 'keyword_fallback';
      } catch (error) {
        await store
          .settleToolCall(turn.turnId, generation, callId, { errorCode: safeCode(error?.code) })
          .catch(() => undefined);
        throw error;
      }
    }
    initialSearchDone = true;
    totalTools = Math.max(totalTools, (await store.listToolCalls(turn.turnId)).length);
    await save();
    for (let round = nextRound; round < maxRounds; round++) {
      await store.renewLease(turn.turnId, generation);
      await store.setPhase(turn.turnId, generation, sourceRefs.length ? 'retrieving' : 'generating');
      let request,
        manifest = null;
      // 已落盘的模型结果（恢复场景）可能含有原请求清单里的目录标题：先确认这些依赖仍被授权，并继承到新清单，
      // 否则新清单只重建当前目录，旧标题就脱离了依赖链。依赖已失效则丢弃该结果，由用户显式重试重新生成。
      const pending = (await store.listModelAttempts(turn.turnId)).find(
        attempt => attempt.ordinal > handledAttemptOrdinal && attempt.modelResult
      );
      let inheritedCatalog = (draft || null)?.catalogDeps ?? null;
      if (grant && pending?.manifestId) {
        try {
          const resumed = await access.catalogDependencies({ grantId: grant.grantId, manifestId: pending.manifestId });
          inheritedCatalog = {
            noteIds: [...new Set([...(inheritedCatalog?.noteIds ?? []), ...resumed.noteIds])],
            folderIds: [...new Set([...(inheritedCatalog?.folderIds ?? []), ...resumed.folderIds])]
          };
        } catch (error) {
          if (!['AI_SCOPE_FORBIDDEN', 'AI_SOURCE_STALE'].includes(error?.code)) throw error;
          await store.rejectModelResult(turn.turnId, generation, pending.ordinal, 'AI_OUTPUT_INVALID');
          fail('AI_SOURCE_STALE', '恢复的回答依赖的目录或笔记已不在授权范围内，请重试本轮。');
        }
      }
      if (grant) {
        const finalOnly = forceAnswer || round === maxRounds - 1 || totalTools >= maxTools;
        let prepared;
        for (;;) {
          const progress = proposalRequested
            ? proposalProgress(await store.listToolCalls(turn.turnId), sourceRefs, budgetCapacity)
            : '';
          const boundedQuestion = authorizedQuestion({
            userContent: user.content,
            round,
            finalOnly,
            proposalRequested,
            draftContext,
            toolFeedback,
            progress,
            proposalNudge,
            externalContext,
            webSearchEnabled: webSearch.enabled,
            searchFallback,
            searchTruncated,
            plainContext
          });
          try {
            prepared = await access.prepareRequest({
              grantId: grant.grantId,
              recipient: 'deepseek',
              modelId: reference.modelId,
              credentialRef: reference.credentialRef,
              userMessage: boundedQuestion,
              history,
              sourceRanges: sourceRefs.map(refRange),
              omissions: [
                ...(sourceRefs.length ? [] : ['no_source_match']),
                ...(searchTruncated ? ['candidate_cap'] : []),
                ...(searchFallback ? ['retrieval_fallback'] : [])
              ],
              maxTokens: MAX_OUTPUT_TOKENS,
              writeToolName: turn.writeIntent?.toolName ?? null,
              assistantTools: !turn.writeIntent,
              catalog: catalogSpecsFromCalls(await store.listToolCalls(turn.turnId)),
              inheritedCatalog,
              tools: availableTools(turn, true, finalOnly, artifactRequested, proposalRequested),
              format: 'json'
            });
            break;
          } catch (error) {
            // 提炼回合：来源体积超过请求预算（固定开销约 7KB，每条来源再加数百字节）时不让回合失败，
            // 从最旧的来源起移出窗口直到装得下；说明文字随后按移出后的真实窗口重算，并提示被移出重点的重新读取位置。
            if (
              error?.code !== 'AI_CONTEXT_BUDGET' ||
              sourceRefs.length <= 1 ||
              (!proposalRequested &&
                !(await store.listToolCalls(turn.turnId)).some(call => CATALOG_TOOL_NAMES.includes(call.toolName)))
            )
              throw error;
            sourceRefs = sourceRefs.slice(1);
            budgetCapacity = Math.min(budgetCapacity ?? Infinity, sourceRefs.length);
          }
        }
        proposalNudge = '';
        request = prepared.request;
        manifest = prepared.manifest;
        for (const call of await store.listToolCalls(turn.turnId)) {
          if (
            call.status === 'succeeded' &&
            call.sourceRefs.length &&
            !call.provenanceManifestId &&
            call.sourceRefs.every(ref => manifest.sources.some(source => hashRecord(source) === hashRecord(ref)))
          ) {
            await store.bindToolResultManifest(turn.turnId, generation, call.callId, manifest.manifestId);
          }
        }
      } else {
        request = {
          credentialRef: reference.credentialRef,
          modelId: reference.modelId,
          messages: plainMessages({
            prior,
            userContent: user.content,
            draftContext,
            toolFeedback,
            externalContext,
            webSearchEnabled: webSearch.enabled,
            writeIntent: turn.writeIntent
          }),
          maxTokens: MAX_OUTPUT_TOKENS,
          format: 'text',
          tools: availableTools(
            turn,
            false,
            forceAnswer || round === maxRounds - 1 || totalTools >= maxTools,
            artifactRequested,
            proposalRequested
          )
        };
      }
      await save();
      if (pending?.modelId && pending.modelId !== reference.modelId) fail('AI_MODEL_CHANGED', '恢复前模型配置已变化。');
      const delivery = pending
        ? { result: pending.modelResult, attemptOrdinal: pending.ordinal }
        : await paidCall(turn, generation, request, manifest, grant?.grantId ?? null, reference.credentialRef, signal);
      const { result, attemptOrdinal } = delivery;
      const permittedTools = pending
        ? availableTools(turn, Boolean(grant), false, artifactRequested, proposalRequested)
        : request.tools;
      if (result.toolCalls.some(call => !permittedTools.some(tool => tool.name === call.name))) {
        await store.rejectModelResult(turn.turnId, generation, attemptOrdinal, 'AI_TOOL_INVALID');
        fail('AI_TOOL_INVALID', '恢复的工具请求不在当前授权工具范围内。');
      }
      if (result.finishReason === 'tool_calls') {
        const persistedCalls = await store.listToolCalls(turn.turnId);
        if (
          !result.toolCalls.length ||
          result.toolCalls.length > 2 ||
          totalTools +
            result.toolCalls.filter(
              call =>
                !persistedCalls.some(
                  item => item.callId === hashRecord({ turnId: turn.turnId, providerCallId: call.id })
                )
            ).length >
            maxTools ||
          round === maxRounds - 1
        ) {
          fail('AI_AGENT_LIMIT', '工具轮次达到上限。');
        }
        if (result.toolCalls.some(call => proposalNames.has(call.name)) && result.toolCalls.length !== 1) {
          await store.rejectModelResult(turn.turnId, generation, attemptOrdinal, 'AI_TOOL_INVALID');
          fail('AI_TOOL_INVALID', '一轮只可提出一个明确的写入计划。');
        }

        const before = new Set(sourceRefs.map(hashRecord));
        let proposalSaved = false;
        for (const call of result.toolCalls) {
          const planSources = uniqueRefs([...sourceRefs, ...(manifest?.historySources ?? [])]);
          const outcome = await executeTool(
            turn,
            generation,
            grant?.grantId ?? null,
            call,
            signal,
            planSources,
            user.content,
            reference.modelId,
            proposalsOn,
            manifest ? manifestCatalogDeps(manifest) : null
          );
          totalTools = (await store.listToolCalls(turn.turnId)).length;
          proposalSaved ||= outcome.progress === true || outcome.catalog === true;
          if (outcome.actionId) {
            await currentTurn(turn.turnId, generation, signal);
            await store.completeTurn(turn.turnId, generation, {
              content: turn.writeIntent
                ? '已生成笔记计划，尚未写入。请在执行记录中查看差异并确认。'
                : '已生成待审成果。请在 AI 成果收件箱继续修改或确认采纳。',
              sourceRefs: [],
              citations: [],
              provenanceManifestId: null,
              sourceFree: true
            });
            return;
          }
          if (outcome.external)
            externalContext = `\n外部来源（合成验收，非真实联网；不得当作个人笔记引用）：${JSON.stringify(outcome.external.hits)}`;
          if (outcome.errorCode?.startsWith('AI_PROPOSAL_'))
            toolFeedback = `\n最近工具结果：${outcome.errorCode}。${outcome.hint ?? '知识候选的引文必须与本次已读原文逐字一致并落在已读范围内；请先读取原文再修正，或向用户说明无法提议。'}`;
          else if (outcome.errorCode === 'AI_SCOPE_FORBIDDEN')
            toolFeedback =
              '\n最近工具结果：AI_SCOPE_FORBIDDEN。该目录或笔记不存在或不在授权范围内；只使用 catalog 中出现过的 ID，不要猜测，也不要向用户暗示其他目录存在。';
          else if (outcome.errorCode)
            toolFeedback = `\n最近工具结果：${outcome.errorCode}。请调整参数，缺少公开关键词时只问关键问题。`;
          sourceRefs = uniqueRefs([...sourceRefs, ...outcome.sourceRefs]).slice(-12);
          searchTruncated ||= outcome.truncated;
          searchFallback ||= outcome.fallback;
          await save();
        }
        // 成功保存候选也算进展：初始检索可能已覆盖全文，之后不再产生新来源。
        if (!proposalSaved && sourceRefs.every(ref => before.has(hashRecord(ref)))) {
          noProgressRounds++;
          forceAnswer = (!actions && sourceRefs.length > 0 && !externalContext) || noProgressRounds >= 2;
        } else noProgressRounds = 0;
        nextRound = round + 1;
        handledAttemptOrdinal = attemptOrdinal;
        await save();
        continue;
      }
      if (result.finishReason !== 'stop' || result.truncated || result.refused) {
        const code = result.truncated
          ? 'AI_OUTPUT_TRUNCATED'
          : result.refused
            ? 'AI_PROVIDER_REFUSED'
            : 'AI_OUTPUT_INVALID';
        await store.rejectModelResult(turn.turnId, generation, attemptOrdinal, code);
        fail(code, '模型未返回完整可用回答。');
      }
      // 提炼回合：仍有待提交的重点却直接作答（常见于把“最终回答”误当作提交方式、声称已提交）时，先提醒一次再决定，
      // 而不是接受一句虚假的完成声明；最多提醒 2 次，之后按模型回答照常收尾（已保存的候选不受影响）。
      if (
        proposalRequested &&
        grant &&
        proposalNudges < 2 &&
        request.tools.some(tool => tool.name === 'knowledge_propose') &&
        analyzeProposal(await store.listToolCalls(turn.turnId), sourceRefs, budgetCapacity).needPropose
      ) {
        proposalNudges++;
        proposalNudge =
          '\n注意：上一条回答没有调用 knowledge_propose，但仍有待提交的重点。只有调用该工具才算提交，在回答里声称已提交无效；请现在调用 knowledge_propose 提交上面待提交的重点。';
        nextRound = round + 1;
        handledAttemptOrdinal = attemptOrdinal;
        await save();
        continue;
      }
      await store.setPhase(turn.turnId, generation, 'validating');
      let answer;
      try {
        answer = grant
          ? citedResult(result, request, manifest)
          : {
              content: result.content.trim(),
              sourceRefs: [],
              citations: [],
              provenanceManifestId: null,
              sourceFree: true
            };
        if (!answer.content) fail('AI_OUTPUT_INVALID', '模型返回空回答。');
      } catch (error) {
        if (['AI_CITATION_INVALID', 'AI_OUTPUT_INVALID'].includes(error.code))
          await store.rejectModelResult(turn.turnId, generation, attemptOrdinal, error.code);
        // 引文无法逐字核对时先让模型修正一次，而不是整轮失败；已展示的引用仍然逐条严格校验。
        if (error.code === 'AI_CITATION_INVALID' && citationRepairs < 1 && round < maxRounds - 1) {
          citationRepairs++;
          toolFeedback =
            '\n注意：上一条回答的引用无法在 sources 中逐字核对。请重新作答：quote 必须逐字摘自 sources 的 text 且 sourceId 对应；不确定时 citations 留空数组。';
          nextRound = round + 1;
          handledAttemptOrdinal = attemptOrdinal;
          await save();
          continue;
        }
        throw error;
      }
      if (externalContext)
        answer.content += '\n\n外部检索来源（合成验收，非真实联网）：' + renderExternalSources(externalContext);
      await currentTurn(turn.turnId, generation, signal);
      await store.completeTurn(turn.turnId, generation, answer);
      return;
    }
    fail('AI_AGENT_LIMIT', '模型轮次达到上限。');
  }

  async function run(turnId, mode = 'resume') {
    if (closed) fail('AI_GENERATION_UNAVAILABLE', 'AI 执行端已关闭。');
    if (active.has(turnId)) return active.get(turnId).promise;
    const controller = new AbortController();
    let timer;
    const promise = (async () => {
      let turn;
      try {
        const previous = await store.getTurn(turnId);
        const remainingMs = previous?.executionStartedAt
          ? MAX_RUN_MS - (now().getTime() - Date.parse(previous.executionStartedAt))
          : MAX_RUN_MS;
        timer = setTimeout(() => controller.abort(), Math.max(1, remainingMs));
        timer.unref?.();
        turn = await store.claimTurn(turnId, 300_000, { mode });
        await runClaimed(turn, controller.signal);
      } catch (error) {
        if (turn) await store.failTurn(turnId, turn.leaseGeneration, safeCode(error?.code)).catch(() => undefined);
        throw error;
      } finally {
        clearTimeout(timer);
        active.delete(turnId);
      }
    })();
    active.set(turnId, { controller, promise });
    return promise;
  }

  async function recover() {
    await store.recoverInterrupted();
    const attempts = await store.listModelAttempts();
    const turns = new Map((await store.listTurns()).map(turn => [turn.turnId, turn]));
    let uncertain = 0;
    for (const attempt of attempts) {
      if (!['prepared', 'reserved', 'sent'].includes(attempt.status)) continue;
      const turn = turns.get(attempt.turnId);
      if (!turn || (turn.status === 'running' && Date.parse(turn.leaseExpiresAt) > now().getTime())) continue;
      try {
        await budget.settle({ accountRef, attemptId: attempt.attemptId, disposition: 'unknown' });
      } catch (error) {
        if (error.code !== 'AI_BUDGET_NOT_FOUND' && error.code !== 'AI_BUDGET_CONFLICT') {
          logger.warn?.('Agent budget recovery deferred', { code: safeCode(error?.code) });
          continue;
        }
      }
      await store
        .advanceModelAttempt(attempt.attemptId, 'unknown', { errorCode: 'AI_DELIVERY_UNCERTAIN' })
        .catch(() => undefined);
      uncertain++;
    }
    return uncertain;
  }

  function cancel(turnId) {
    active.get(turnId)?.controller.abort();
  }
  async function retry(turnId) {
    const previous = active.get(turnId);
    if (previous) {
      previous.controller.abort();
      await previous.promise.catch(() => undefined);
    }
    return run(turnId, 'retry');
  }
  function close() {
    closed = true;
    return recovery.close(async () => {
      const running = [...active.values()];
      for (const entry of running) entry.controller.abort();
      await Promise.allSettled(running.map(entry => entry.promise));
    });
  }
  return { run, retry, cancel, recover: () => recovery.run(recover), close };
}
