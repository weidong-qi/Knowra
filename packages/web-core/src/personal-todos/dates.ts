const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export const isTimeOfDay = (value: unknown): value is string => typeof value === 'string' && TIME_PATTERN.test(value);

/** 只接受带 Z 或数字偏移的完整 ISO 时间，避免无时区时间在不同设备上含义不同。 */
export function isZonedIso(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

const pad = (value: number) => String(value).padStart(2, '0');

/** 按给定 UTC 偏移（分钟，东八区为 480）把日期和时刻转成 UTC ISO。 */
export function zonedDateTimeToIso(date: string, time: string, utcOffsetMinutes: number): string {
  const sign = utcOffsetMinutes >= 0 ? '+' : '-';
  const absolute = Math.abs(utcOffsetMinutes);
  return new Date(`${date}T${time}:00${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`).toISOString();
}

/** 设备本地日期（YYYY-MM-DD）。 */
export function localDateOf(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
