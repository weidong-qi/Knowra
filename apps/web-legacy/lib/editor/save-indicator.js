export function getSaveStateLabel({ saveState, lastSavedAt = null, formatDate = String } = {}) {
  switch (saveState) {
    case 'pending':
      return '待保存';
    case 'saving':
      return '保存中...';
    case 'saved':
      return lastSavedAt ? `已保存 ${formatDate(lastSavedAt)}` : '已保存';
    case 'error':
      return '保存失败';
    default:
      return '实时编辑';
  }
}
