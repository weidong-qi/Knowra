// 普通 JSON 记录只复制可变容器；字符串等标量不可变，可安全复用。
// 避免 structuredClone 先把整个历史集合编码到大型原生缓冲，再解码复制正文。
export function cloneJsonData<Value>(value: Value): Value {
  const seen = new Map<object, object>();
  function clone<Input>(input: Input): Input {
    if (['function', 'symbol'].includes(typeof input)) return structuredClone(input);
    if (input === null || typeof input !== 'object') return input;
    if (seen.has(input)) return seen.get(input) as Input;
    const prototype = Object.getPrototypeOf(input);
    if (!Array.isArray(input) && prototype !== Object.prototype && prototype !== null) {
      const result = structuredClone(input);
      seen.set(input, result);
      return result;
    }
    const result: object = Array.isArray(input) ? new Array(input.length) : {};
    seen.set(input, result);
    for (const key of Object.keys(input))
      Object.defineProperty(result, key, {
        value: clone((input as Record<string, Input[keyof Input]>)[key]),
        enumerable: true,
        configurable: true,
        writable: true
      });
    return result as Input;
  }
  return clone(value);
}
