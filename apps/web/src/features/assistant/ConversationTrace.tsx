import { Button } from '../../components/ui/button/Button';
import { SearchIcon } from '../../components/icons/knowra';
import type { ConversationTurn, ToolCall } from './conversationApi';
import styles from './ConversationView.module.css';

interface ConversationTraceProps {
  turnId: string;
  turn: ConversationTurn | undefined;
  turnStatusLabel: string | undefined;
  onLoad(turnId: string): void | Promise<void>;
  onReviewCandidates(): void;
}

/** 工具调用审计展示；按需读取、缓存和会话失效仍由会话编排层负责。 */
export function ConversationTrace({ turnId, turn, turnStatusLabel, onLoad, onReviewCandidates }: ConversationTraceProps) {
  return <details className={styles.trace} onToggle={event => { if (event.currentTarget.open) void onLoad(turnId); }}>
    <summary><SearchIcon size={13} />检索与调用记录</summary>
    {turn ? <Trace turn={turn} turnStatusLabel={turnStatusLabel} onReviewCandidates={onReviewCandidates} /> : <p>正在读取记录…</p>}
  </details>;
}

const toolLabel = (call: ToolCall) => call.toolName === 'notes_search' ? call.argumentsJson.origin === 'automatic' ? '自动检索笔记' : '检索笔记'
  : call.toolName === 'notes_read' ? '阅读笔记' : call.toolName === 'annotations_list' ? '读取重点标记'
    : call.toolName === 'knowledge_propose' ? '提交知识候选（待审核）' : '生成笔记计划（尚未写入）';

/** 每个工具调用结果的一句话摘要；提议工具没有来源片段，不能显示“0 个来源片段”。 */
function toolSummary(call: ToolCall, turn: ConversationTurn) {
  if (call.status === 'failed') return `失败：${call.errorCode ?? '未知原因'}`;
  if (call.status !== 'succeeded') return turn.status === 'running' ? '执行中' : '执行未完成';
  const result = call.resultJson;
  if (call.toolName === 'knowledge_propose') {
    const saved = Array.isArray(result?.candidates) ? result.candidates.length : 0;
    return result?.saved === true ? `已保存 ${saved} 条候选，尚未入库，需在知识库审核` : `已校验 ${saved} 条候选（未保存）`;
  }
  if (call.toolName === 'annotations_list') {
    const shown = Array.isArray(result?.annotations) ? result.annotations.length : 0;
    return `${typeof result?.total === 'number' ? `共 ${result.total} 处重点，本页 ${shown} 处` : `${shown} 处重点`} · ${call.sourceRefs.length} 个来源片段`;
  }
  return `${call.sourceRefs.length} 个来源片段`;
}

function Trace({ turn, turnStatusLabel, onReviewCandidates }: {
  turn: ConversationTurn;
  turnStatusLabel: string | undefined;
  onReviewCandidates(): void;
}) {
  const calls = turn.toolCalls ?? [];
  const savedCandidates = calls.some(call => call.toolName === 'knowledge_propose' && call.status === 'succeeded' && call.resultJson?.saved === true);
  return <div className={styles.traceBody}>
    <p>本轮：{turnStatusLabel}{turn.errorCode ? ` · ${turn.errorCode}` : ''} · 模型尝试 {turn.modelAttempts?.length ?? 0} 次</p>
    {calls.length ? <ol>{calls.map(call => <li key={call.callId}>
      <strong>{toolLabel(call)}</strong>
      {typeof call.argumentsJson.query === 'string' ? ` · ${call.argumentsJson.query}` : null}
      <span> · {toolSummary(call, turn)}</span>
      {call.resultJson?.mode === 'keyword_fallback' ? <span> · 索引无可用结果，已改用关键词检索</span>
        : call.resultJson?.mode === 'keyword' ? <span> · 关键词检索</span> : null}
      {call.resultJson?.truncated === true ? <span> · 检索范围受限</span> : null}
    </li>)}</ol> : <p>本轮没有检索或阅读工具记录。</p>}
    {savedCandidates && onReviewCandidates ? <Button variant="default" size="compact" onPress={onReviewCandidates}>在知识库审核候选</Button> : null}
  </div>;
}
