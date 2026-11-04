const guards = new Set<() => boolean>();

/** 显式保存表单阻止应用内导航；表单自行提供保存/放弃对话框。 */
export function registerNavigationGuard(guard: () => boolean) {
  guards.add(guard);
  return () => { guards.delete(guard); };
}

export function canNavigate() {
  return [...guards].every(guard => guard());
}
