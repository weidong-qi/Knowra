import { afterEach, describe, expect, it, vi } from 'vitest';

describe('pdfPolyfills', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('缺少 getOrInsertComputed 时补齐 Map 与 WeakMap，已有实现不覆盖', async () => {
    const mapProto = Map.prototype as unknown as Record<string, unknown>;
    const weakProto = WeakMap.prototype as unknown as Record<string, unknown>;
    const originals = [mapProto.getOrInsert, mapProto.getOrInsertComputed, weakProto.getOrInsertComputed];
    delete mapProto.getOrInsert;
    delete mapProto.getOrInsertComputed;
    delete weakProto.getOrInsertComputed;
    await import('./pdfPolyfills');
    const compute = vi.fn((key: string) => key.length);
    const map = new Map<string, number>();
    const getOrInsertComputed = mapProto.getOrInsertComputed as (key: string, fn: (key: string) => number) => number;
    expect(getOrInsertComputed.call(map, 'abc', compute)).toBe(3);
    expect(getOrInsertComputed.call(map, 'abc', compute)).toBe(3);
    expect(compute).toHaveBeenCalledTimes(1);
    const key = {};
    const weak = new WeakMap<object, number>();
    expect((weakProto.getOrInsertComputed as (k: object, fn: () => number) => number).call(weak, key, () => 7)).toBe(7);
    if (originals[0]) mapProto.getOrInsert = originals[0];
    if (originals[1]) mapProto.getOrInsertComputed = originals[1];
    if (originals[2]) weakProto.getOrInsertComputed = originals[2];
  });
});
