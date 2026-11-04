export interface NoteVersionRetentionPolicy {
  recentMs: number;
  dailyUntilMs: number;
  maxAgeMs: number;
  sampleMs: number;
  maxPerNote: number;
  maxBytesPerNote: number;
}

/** 历史 JSON 的时间字段未作结构校验；原 Date.parse 仍负责转换。 */
export type RetentionJsonValue =
  string | number | boolean | null | RetentionJsonValue[] | { [key: string]: RetentionJsonValue | undefined };

export interface RetainableNoteVersion {
  id: string;
  createdAt?: RetentionJsonValue;
}

export interface NoteVersionPruneOptions<T extends RetainableNoteVersion> {
  versions: readonly T[];
  now?: number;
  protectedIds?: ReadonlySet<string>;
  policy?: Readonly<NoteVersionRetentionPolicy>;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const NOTE_VERSION_RETENTION: Readonly<NoteVersionRetentionPolicy> = Object.freeze({
  recentMs: DAY,
  dailyUntilMs: 30 * DAY,
  maxAgeMs: 30 * DAY,
  sampleMs: 10 * 60 * 1000,
  maxPerNote: 20,
  maxBytesPerNote: 2 * 1024 * 1024
});

const bucketOf = (
  age: number,
  createdAt: RetentionJsonValue | undefined,
  policy: Readonly<NoteVersionRetentionPolicy>
): string => {
  const time = Date.parse(createdAt as string);
  if (age <= policy.recentMs) return `m${Math.floor(time / policy.sampleMs)}`;
  return `d${Math.floor(time / DAY)}`;
};

/**
 * 恢复点有数量、年龄和字节上限：24 小时内每 10 分钟一个，其后每天一个，最长 30 天。
 * 当前正文和来源凭证是保留根，不属于可淘汰恢复点配额；不能为满足配额截断引用。
 * 返回应删除的版本 ID。
 */
export function selectVersionsToPrune<T extends RetainableNoteVersion>({
  versions,
  now = Date.now(),
  protectedIds = new Set<string>(),
  policy = NOTE_VERSION_RETENTION
}: NoteVersionPruneOptions<T>): string[] {
  const ordered = [...versions].sort(
    (left, right) =>
      Date.parse(right.createdAt as string) - Date.parse(left.createdAt as string) || right.id.localeCompare(left.id)
  );
  const kept = new Set<string>();
  const seen = new Set<string>();
  let count = 0,
    bytes = 0;
  for (const version of ordered) {
    const age = now - Date.parse(version.createdAt as string);
    if (protectedIds.has(version.id) || !Number.isFinite(age)) {
      kept.add(version.id);
      continue;
    }
    const length = Buffer.byteLength(JSON.stringify(version));
    if (age > policy.maxAgeMs || count >= policy.maxPerNote || bytes + length > policy.maxBytesPerNote) continue;
    const bucket = bucketOf(age, version.createdAt, policy);
    if (seen.has(bucket)) continue;
    seen.add(bucket);
    kept.add(version.id);
    count++;
    bytes += length;
  }
  return ordered.filter(version => !kept.has(version.id)).map(version => version.id);
}
