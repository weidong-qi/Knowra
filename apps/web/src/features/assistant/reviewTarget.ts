import type { ConversationMessage, ConversationTurn } from './conversationApi';
import type { NoteAction } from './noteActionApi';

/** Mirror the worker's latest successful action tool selection; the inbox choice never redirects a turn. */
export function isCurrentReviewTarget(action: NoteAction, conversationId: string | null,
  messages: ConversationMessage[], latestTurn: ConversationTurn | null): boolean {
  const last = messages.at(-1);
  if (!conversationId || !latestTurn || latestTurn.conversationId !== conversationId || latestTurn.status !== 'succeeded'
    || last?.role !== 'assistant' || last.turnId !== latestTurn.turnId
    || !['awaitingApproval', 'authorized'].includes(action.status) || action.datasetStale || action.grant?.revoked !== false) return false;
  const originalTurnId = action.grant?.originTurnId;
  if (!originalTurnId || !messages.some(message => message.role === 'assistant' && message.turnId === originalTurnId)) return false;
  const lastActionId = [...(latestTurn.toolCalls ?? [])].reverse().find(call => call.status === 'succeeded'
    && typeof call.resultJson?.actionId === 'string')?.resultJson?.actionId;
  if (lastActionId !== action.actionId) return false;
  if (action.requestId === latestTurn.turnId && originalTurnId === latestTurn.turnId) return true;
  return action.inboxEvents?.some(event => event.kind === 'revise' && event.requestId === latestTurn.turnId
    && event.originTurnId === latestTurn.turnId) ?? false;
}
