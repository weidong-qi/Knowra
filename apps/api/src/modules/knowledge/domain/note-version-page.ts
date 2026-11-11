import { createAppError } from '../../../errors/app-error.ts';

export interface VersionPageQuery {
  limit?: unknown;
  cursor?: unknown;
}

export interface VersionPageCursor {
  id: string;
  createdAt: string;
  [key: string]: unknown;
}

export interface VersionSummaryInput {
  id: string;
  noteId: string;
  contentHash: string;
  createdAt: string | Date;
  createdBy: string;
}

/** 原字段只做投影，不由分页助手校验；默认公开契约仍是原有字符串输入。 */
export type VersionSummaryFields = { [Field in keyof VersionSummaryInput]?: unknown };
export interface VersionSummary<Source extends VersionSummaryFields = VersionSummaryInput> {
  id: Source['id'];
  noteId: Source['noteId'];
  contentHash: Source['contentHash'];
  createdAt: string;
  createdBy: Source['createdBy'];
}

export interface VersionPageOptions<CurrentVersionId = string | null> {
  limit: number;
  total: number;
  currentVersionId: CurrentVersionId;
}

export interface VersionPage<
  Source extends VersionSummaryFields = VersionSummaryInput,
  CurrentVersionId = string | null
> {
  items: VersionSummary<Source>[];
  total: number;
  currentVersionId: CurrentVersionId;
  nextCursor: string | null;
}

export function parseVersionPageQuery({ limit = 20, cursor }: VersionPageQuery = {}): {
  limit: number;
  after: VersionPageCursor | null;
} {
  const size = Number(limit);
  if (!Number.isInteger(size) || size < 1 || size > 100) {
    throw createAppError('NOTE_VERSION_PAGE_INVALID', '版本分页数量须为 1 到 100', 400);
  }
  let after: VersionPageCursor | null = null;
  if (cursor) {
    try {
      const decoded: unknown = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
      if (!isVersionPageCursor(decoded)) throw new Error();
      after = decoded;
    } catch {
      throw createAppError('NOTE_VERSION_CURSOR_INVALID', '版本分页游标无效', 400);
    }
  }
  return { limit: size, after };
}

function isVersionPageCursor(value: unknown): value is VersionPageCursor {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    !!value.id &&
    'createdAt' in value &&
    typeof value.createdAt === 'string' &&
    Number.isFinite(Date.parse(value.createdAt))
  );
}

export function versionSummary<Source extends VersionSummaryFields>(version: Source): VersionSummary<Source>;
export function versionSummary(version: VersionSummaryInput): VersionSummary;
export function versionSummary<Source extends VersionSummaryFields>(version: Source): VersionSummary<Source> {
  return {
    id: version.id,
    noteId: version.noteId,
    contentHash: version.contentHash,
    createdAt: new (Date as new (value: unknown) => Date)(version.createdAt).toISOString(),
    createdBy: version.createdBy
  };
}

export function versionPage<Source extends VersionSummaryFields, CurrentVersionId>(
  items: readonly Source[],
  options: VersionPageOptions<CurrentVersionId>
): VersionPage<Source, CurrentVersionId>;
export function versionPage(items: readonly VersionSummaryInput[], options: VersionPageOptions): VersionPage;
export function versionPage<Source extends VersionSummaryFields, CurrentVersionId>(
  items: readonly Source[],
  { limit, total, currentVersionId }: VersionPageOptions<CurrentVersionId>
): VersionPage<Source, CurrentVersionId> {
  const selected = items.slice(0, limit).map(versionSummary<Source>);
  const last = selected.at(-1);
  return {
    items: selected,
    total,
    currentVersionId,
    nextCursor:
      items.length > limit && last
        ? Buffer.from(JSON.stringify({ createdAt: last.createdAt, id: last.id })).toString('base64url')
        : null
  };
}
