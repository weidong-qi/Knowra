import { randomUUID } from 'node:crypto';
import { validationError } from '../knowledge-errors.ts';

// 字符串会被修剪，不能保留字符串字面量；其他值保持原身份。
export function trimIfString<T>(value: T): T extends string ? string : T;
export function trimIfString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export function createSlug(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function createPrefixedId(prefix: unknown, seedValue: unknown = ''): string {
  const seed = createSlug(seedValue);
  const readablePart = seed ? `${seed}-` : '';
  return `${prefix}-${readablePart}${randomUUID()}`;
}

export function requireText(value: unknown, code: string, message: string): string {
  const normalized = trimIfString(value);
  if (typeof normalized !== 'string' || !normalized) {
    throw validationError(code, message);
  }
  return normalized;
}

export function normalizeOptionalId(value: unknown, code: string, message: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return requireText(value, code, message);
}

export function normalizeIdList(value: unknown, code: string, message: string): unknown[] {
  if (!Array.isArray(value)) {
    throw validationError(code, message);
  }

  // 不假定调用者保留原生 map / iterator；稀疏数组也会在 Set 中产生 undefined。
  const normalized = value.map((item: unknown) => requireText(item, code, message));
  return [...new Set(normalized)];
}
