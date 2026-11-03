// recorder-elements.js
// 极简假 DOM 元素，专供事件绑定器单测用。
// 监听器登记到 Map；dispatch(type, target, overrides) 派发合成事件并调用对应 handler。
// 不引入 jsdom。

export function createRecorderElement() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener() {
      // 现有 client.js 不存在 removeEventListener 调用，保留占位即可。
    },
    dispatch(type, target, overrides = {}) {
      const handler = listeners.get(type);
      if (!handler) {
        throw new Error(`No listener registered for event type "${type}"`);
      }
      handler({ target, stopPropagation() {}, preventDefault() {}, ...overrides });
    },
    has(type) {
      return listeners.has(type);
    }
  };
}
