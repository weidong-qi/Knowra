/** 助手可用状态变更通知（暂停、恢复、放行等）：助手视图收到后应重新读取状态，不必手动刷新。 */
export const ASSISTANT_STATUS_CHANGED_EVENT = 'knowra:assistant-status-changed';

export function notifyAssistantStatusChanged(): void {
  window.dispatchEvent(new Event(ASSISTANT_STATUS_CHANGED_EVENT));
}
