import { hashRecord } from './record-contract.js';
import { PROPOSAL_GUIDANCE } from './proposal-progress.js';
import { ASSISTANT_GUIDANCE } from './assistant-tools.js';

// 仅组装请求文本与历史；授权核验、来源预算重试和外发仍由调用方负责。
export function plainHistory(prior) {
  // 授权回合的回答即使没有来源引用，也可能含目录与标题等授权资料；只有普通聊天（无来源清单）的回答才可进入无授权上下文。
  const safe = prior.filter(
    row => row.sourceFree && row.sourceRefs.length === 0 && !row.provenanceManifestId && row.content.length <= 4000
  );
  return safe.slice(-8).map(row => ({ role: row.role, content: row.content }));
}

export function authorizedHistory(prior) {
  const entries = [],
    plainContext = [];
  for (const row of prior.slice(-8)) {
    if (row.role === 'assistant' && !row.provenanceManifestId) {
      if (row.sourceFree && !row.sourceRefs.length) plainContext.push(`助手：${row.content.slice(0, 500)}`);
      continue;
    }
    if (row.role === 'user' && !row.provenanceManifestId) {
      // 用户消息可以由 R02 验证为无来源历史。
    }
    if (row.content.length > 12000) continue;
    const item = {
      role: row.role,
      content: row.content,
      sourceRefs: row.sourceRefs,
      sourceFree: row.sourceFree,
      provenanceManifestId: row.provenanceManifestId
    };
    item.provenanceHash = hashRecord({
      role: item.role,
      content: item.content,
      sourceRefs: item.sourceRefs,
      sourceFree: item.sourceFree,
      provenanceManifestId: item.provenanceManifestId
    });
    entries.push(item);
  }
  return { entries, plainContext: plainContext.slice(-4).join('\n').slice(0, 1600) };
}

export function authorizedQuestion({
  userContent,
  round,
  finalOnly,
  proposalRequested,
  draftContext,
  toolFeedback,
  progress,
  proposalNudge,
  externalContext,
  webSearchEnabled,
  searchFallback,
  searchTruncated,
  plainContext
}) {
  const roundGuidance = round
    ? finalOnly
      ? '\n工具结果已写入当前 sources 或 catalog。请直接依据这些来源作答；不足之处明确说明。'
      : '\n工具结果已写入当前 sources 或 catalog。若已足够，请直接回答；只有缺少关键来源时才继续搜索或阅读。'
    : '';
  const guidance = proposalRequested && !finalOnly ? `${roundGuidance}${PROPOSAL_GUIDANCE}` : roundGuidance;
  const coverage = `${draftContext}${toolFeedback}${progress}${proposalNudge}${externalContext}${webSearchEnabled ? '\n联网工具仅返回合成验收资料。' : '\n真实联网尚未配置，核实时不能假称已联网。'}${searchFallback ? '\n候选索引未提供可用结果，已使用关键词检索；关键词未命中不等于授权资料没有答案。' : ''}${searchTruncated ? '\n检索受到本次处理上限限制，不得声称已检查完整授权范围。' : ''}`;
  const contextRoom = 4000 - userContent.length - guidance.length - coverage.length;
  if (contextRoom < 0) {
    /** @type {Error & Partial<Pick<import('../../errors/app-error.ts').AppError, 'code'>>} */
    const error = new Error('提问与必要的检索说明超过上限。');
    error.code = 'AI_INPUT_TOO_LARGE';
    throw error;
  }
  const context = plainContext && contextRoom >= 8 ? `先前普通聊天：${plainContext}\n`.slice(0, contextRoom) : '';
  const boundedQuestion = `${context}${userContent}${guidance}${coverage}`;
  return boundedQuestion;
}

export function plainMessages({
  prior,
  userContent,
  draftContext,
  toolFeedback,
  externalContext,
  webSearchEnabled,
  writeIntent
}) {
  const messages = [
    {
      role: 'system',
      content: `${ASSISTANT_GUIDANCE} 此会话没有笔记读取授权；不得声称读过用户资料或编造笔记引用。${webSearchEnabled ? '联网工具仅返回合成验收资料。' : '真实联网尚未配置；需要最新信息或核实时明确说明不可用，不能假称已联网。'}`
    },
    ...plainHistory(prior),
    { role: 'user', content: `${userContent}${draftContext}${toolFeedback}${externalContext}` }
  ];
  if (writeIntent) messages[0].content += '用户已明确请求生成笔记计划，只调用所开放的写入计划工具；不得宣称已保存。';
  return messages;
}
