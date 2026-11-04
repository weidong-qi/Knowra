import { conversationApi, type ConversationMessage } from './conversationApi';

/** 消息和轮次是独立请求；终态必须与已读取的答案一致才可停止轮询。 */
export async function readConversationSnapshot(id: string, isCurrent: () => boolean) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!isCurrent()) return null;
    const messages: ConversationMessage[] = [];
    for (;;) {
      const page = await conversationApi.messages(id, messages.at(-1)?.sequence ?? 0);
      if (!isCurrent()) return null;
      messages.push(...page);
      if (page.length < 100) break;
    }
    const last = messages.at(-1);
    const turn = last ? await conversationApi.turn(id, last.turnId) : null;
    if (!isCurrent()) return null;
    if (turn?.status === 'succeeded' && !messages.some(message => message.role === 'assistant'
      && message.turnId === turn.turnId && (!turn.assistantMessageId || message.messageId === turn.assistantMessageId))) {
      // 后台可能在消息GET之后才提交答案；只补读一次，不接受不一致终态。
      if (attempt === 0) continue;
      throw new Error('回答已完成，但消息尚未完整读取，请重新加载助手。');
    }
    return { messages, turn };
  }
  return null;
}
