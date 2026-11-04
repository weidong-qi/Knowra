import { isCurrentReviewTarget } from './reviewTarget';
import type { ConversationMessage, ConversationTurn, ToolCall } from './conversationApi';
import type { NoteAction } from './noteActionApi';

const assistant = (turnId: string): ConversationMessage => ({ messageId: `answer-${turnId}`, turnId, sequence: 1,
  role: 'assistant', content: '已生成成果', sourceRefs: [], sourceFree: true, createdAt: '2026-10-04T00:00:00Z' });
const call = (actionId: string, status: ToolCall['status'] = 'succeeded'): ToolCall => ({ callId: `call-${actionId}`, ordinal: 1,
  toolName: 'notes_create', argumentsJson: {}, resultJson: { actionId }, status, sourceRefs: [], errorCode: null });
const turn = (turnId: string, actionId: string, conversationId = 'conversation-a'): ConversationTurn => ({ turnId, conversationId,
  requestedPolicyId: null, status: 'succeeded', phase: 'finished', errorCode: null, toolCalls: [call(actionId)] });
const action = (events: NoteAction['inboxEvents'] = []): NoteAction => ({ actionId: 'draft-a', requestId: 'turn-a',
  status: 'awaitingApproval', grant: { originTurnId: 'turn-a', revoked: false }, inboxEvents: events,
  plan: { planHash: 'latest-hash', toolName: 'notes_create', items: [] } } as unknown as NoteAction);

it('允许同一 action 从 A 首稿、B 修订继续到 C，且依照 worker 最后成功工具成果', () => {
  const first = action();
  expect(isCurrentReviewTarget(first, 'conversation-a', [assistant('turn-a')], turn('turn-a', 'draft-a'))).toBe(true);
  const revised = action([{ kind: 'revise', requestId: 'turn-b', originTurnId: 'turn-b', resultPlanHash: 'latest-hash' }]);
  expect(isCurrentReviewTarget(revised, 'conversation-a', [assistant('turn-a'), assistant('turn-b')], turn('turn-b', 'draft-a'))).toBe(true);
  expect(isCurrentReviewTarget(revised, 'conversation-a', [assistant('turn-a'), assistant('turn-b')],
    { ...turn('turn-b', 'draft-a'), toolCalls: [call('draft-a'), call('draft-other')] })).toBe(false);
});

it('其他会话、其他成果、失败工具、缺失可信修订事件或原始轮次均不能放行', () => {
  const revised = action([{ kind: 'revise', requestId: 'turn-b', originTurnId: 'turn-b', resultPlanHash: 'latest-hash' }]);
  const history = [assistant('turn-a'), assistant('turn-b')];
  expect(isCurrentReviewTarget(revised, 'conversation-b', history, turn('turn-b', 'draft-a'))).toBe(false);
  expect(isCurrentReviewTarget(revised, 'conversation-a', history, turn('turn-b', 'draft-other'))).toBe(false);
  expect(isCurrentReviewTarget(revised, 'conversation-a', history, { ...turn('turn-b', 'draft-a'), toolCalls: [call('draft-a', 'failed')] })).toBe(false);
  expect(isCurrentReviewTarget(action(), 'conversation-a', history, turn('turn-b', 'draft-a'))).toBe(false);
  expect(isCurrentReviewTarget(revised, 'conversation-a', [assistant('turn-b')], turn('turn-b', 'draft-a'))).toBe(false);
  expect(isCurrentReviewTarget(revised, 'conversation-a', history, { ...turn('turn-b', 'draft-a'), status: 'running' })).toBe(false);
  expect(isCurrentReviewTarget({ ...revised, status: 'applied' }, 'conversation-a', history, turn('turn-b', 'draft-a'))).toBe(false);
  expect(isCurrentReviewTarget({ ...revised, datasetStale: true }, 'conversation-a', history, turn('turn-b', 'draft-a'))).toBe(false);
  expect(isCurrentReviewTarget({ ...revised, grant: { originTurnId: 'turn-a', revoked: true } }, 'conversation-a', history, turn('turn-b', 'draft-a'))).toBe(false);
});
