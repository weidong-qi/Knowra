/** pdf.js 6 使用较新的内置方法；平板等旧浏览器缺失时在其加载前补齐。 */
type KeyedCollection<K, V> = {
  has(key: K): boolean;
  get(key: K): V | undefined;
  set(key: K, value: V): unknown;
};

function installGetOrInsert(target: object) {
  const proto = target as Record<string, unknown>;
  if (typeof proto.getOrInsert !== 'function') {
    Object.defineProperty(proto, 'getOrInsert', {
      configurable: true,
      writable: true,
      value<K, V>(this: KeyedCollection<K, V>, key: K, value: V): V {
        if (!this.has(key)) this.set(key, value);
        return this.get(key) as V;
      }
    });
  }
  if (typeof proto.getOrInsertComputed !== 'function') {
    Object.defineProperty(proto, 'getOrInsertComputed', {
      configurable: true,
      writable: true,
      value<K, V>(this: KeyedCollection<K, V>, key: K, compute: (key: K) => V): V {
        if (!this.has(key)) this.set(key, compute(key));
        return this.get(key) as V;
      }
    });
  }
}

installGetOrInsert(Map.prototype);
installGetOrInsert(WeakMap.prototype);

const promiseCtor = Promise as unknown as Record<string, unknown>;
if (typeof promiseCtor.try !== 'function') {
  Object.defineProperty(Promise, 'try', {
    configurable: true,
    writable: true,
    value<T>(callback: (...args: unknown[]) => T | PromiseLike<T>, ...args: unknown[]): Promise<T> {
      return new Promise<T>(resolve => resolve(callback(...args)));
    }
  });
}

export {};
