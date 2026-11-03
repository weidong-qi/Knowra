/** 浏览器离线模式的草稿位于 sessionStorage；原生端草稿由服务端从原子文件备份。 */
export function captureBrowserBackupDrafts() {
  const drafts: Record<string, unknown> = {};
  if (window.knowraDesktop?.readRecoveryDrafts) return { version: 1, drafts };
  for (let index = 0; index < sessionStorage.length; index++) {
    const key = sessionStorage.key(index);
    if (!key?.startsWith('knowra:note-draft:v1:') && !key?.startsWith('knowra:knowledge-draft:v1:')) continue;
    drafts[key] = JSON.parse(sessionStorage.getItem(key) ?? 'null');
  }
  return { version: 1, drafts };
}
