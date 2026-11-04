// V4-04 utility: combine className fragments safely.
// 仅用于合并静态或字符串化的类名；禁止拼接外部 CSS 哈希到结果中。

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
