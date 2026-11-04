/** 模型凭据（API Key / 模型）变更通知：依赖当前账户的展示（如账户余额）收到后应清空旧数据并重新读取。 */
export const CREDENTIAL_CHANGED_EVENT = 'knowra:model-credential-changed';

export function notifyCredentialChanged(): void {
  window.dispatchEvent(new Event(CREDENTIAL_CHANGED_EVENT));
}
