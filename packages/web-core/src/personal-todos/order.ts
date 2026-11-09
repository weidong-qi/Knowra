const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;
const ORDER_PATTERN = /^[0-9A-Za-z]{1,64}$/;

export const isOrderKey = (value: unknown): value is string =>
  typeof value === 'string' && ORDER_PATTERN.test(value) && !value.endsWith('0');

/**
 * 返回严格介于 before 与 after 之间的排序键（null 表示无界）。
 * 插入不改动兄弟节点的键，避免一次移动产生多条同步变更。
 */
export function orderBetween(before: string | null, after: string | null): string {
  const low = before ?? '';
  if (after !== null && !(low < after)) throw new RangeError('排序键区间无效');
  let upper: string | null = after;
  let result = '';
  for (let index = 0; ; index += 1) {
    const lowDigit = index < low.length ? DIGITS.indexOf(low[index]!) : 0;
    const highDigit = upper === null ? BASE : index < upper.length ? DIGITS.indexOf(upper[index]!) : 0;
    if (highDigit - lowDigit > 1) return result + DIGITS[Math.floor((lowDigit + highDigit) / 2)];
    result += DIGITS[lowDigit];
    // 当前位已比上界小，后续位不再受上界约束。
    if (highDigit - lowDigit === 1) upper = null;
  }
}

/** 同级重排时均匀分配短键；末尾加中位字符，避免产生被契约禁止的 0 结尾。 */
export function balancedOrderKeys(count: number): string[] {
  const width = Math.max(2, Math.ceil(Math.log(count + 1) / Math.log(BASE)) + 1);
  const capacity = BigInt(BASE) ** BigInt(width);
  return Array.from({ length: count }, (_, index) => {
    let value = (capacity * BigInt(index + 1)) / BigInt(count + 1);
    let key = '';
    for (let digit = 0; digit < width; digit += 1) {
      key = DIGITS[Number(value % BigInt(BASE))] + key;
      value /= BigInt(BASE);
    }
    return key + 'V';
  });
}
