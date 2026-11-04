// window-events.js
// window 级事件绑定。beforeunload 时持久化编辑器滚动位置与
// 滚动位置缓存，避免页面刷新后丢失阅读位置。
// 由 client.js 的 bindEvents() 在初始化时一次性注册。

export function bindWindowEvents({ state, elements, deps }) {
  const { saveCurrentEditorScrollPosition, persistScrollPositions } = deps;

  globalThis.window.addEventListener('beforeunload', () => {
    saveCurrentEditorScrollPosition();
    persistScrollPositions();
  });
}
