import { createAppError } from '../../../errors/app-error.ts';
import { versionPage } from '../domain/note-version-page.ts';

import type { NoteVersion } from '../domain/note-version.ts';
import type { VersionPage } from '../domain/note-version-page.ts';

/** 仓库不校验历史记录；读取结果不能冒充 NoteVersion 构造器的合法实例。 */
export type NoteVersionRecord = { -readonly [Field in keyof NoteVersion]?: unknown };
export interface NoteVersionRepositoryOptions {
  records?: NoteVersionRecord[] | null;
  /** 工厂创建时捕获，返回值按原 JS 真值规则判断。 */
  canReuse?: ((version: NoteVersionRecord) => unknown) | null;
  /** 每次写入重新读取，并保持 options 接收者；抛错不回滚已完成的数组修改。 */
  onChange?: ((records: NoteVersionRecord[]) => unknown) | null;
}
export interface NoteVersionListOptions {
  noteId?: unknown;
}
export interface NoteVersionPageOptions {
  noteId: unknown;
  limit: number;
  after?: { id?: unknown; createdAt?: unknown } | null;
  currentContentHash?: unknown;
}
export interface NoteVersionRepository {
  /** 可能返回已有或复用记录，不保证返回输入，也不保证保留输入的额外类型。 */
  save<Value extends NoteVersionRecord>(version: Value): NoteVersionRecord;
  findById(id: unknown): NoteVersionRecord | null;
  findByNoteIdAndContentHash(noteId: unknown, contentHash: unknown): NoteVersionRecord | null;
  list(options?: NoteVersionListOptions): NoteVersionRecord[];
  listIds(options?: NoteVersionListOptions): unknown[];
  listPage(options: NoteVersionPageOptions): VersionPage<NoteVersionRecord, unknown>;
  deleteById(id: unknown): NoteVersionRecord | null;
  deleteByNoteIds(noteIds: Iterable<unknown> | null | undefined): NoteVersionRecord[];
}

// 仅用于原操作点：Date/parse 会执行自身转换或抛错，localeCompare 仍直接调用原接收者。
// 算术 Date 视图只让 TS 保留原 Date 减法，不把仓库字段或公开返回值声明为有效日期/数字。
type DateConstructorView = new (value: unknown) => Date;
type DateArithmeticView = new (value: unknown) => number;
type LocaleCompareView = { localeCompare(other: unknown): number };

export function createInMemoryNoteVersionRepository(options: NoteVersionRepositoryOptions = {}): NoteVersionRepository {
  const records = options.records ?? [];
  const canReuse = options.canReuse ?? (() => true);
  const findReusable = (noteId: unknown, contentHash: unknown) =>
    records.find(item => item.noteId === noteId && item.contentHash === contentHash && canReuse(item)) ?? null;
  const persist = () => options.onChange?.(records);

  return {
    save<Value extends NoteVersionRecord>(version: Value): NoteVersionRecord {
      const existing = records.find(item => item.id === version.id);
      if (existing) {
        if (existing.noteId !== version.noteId || existing.contentHash !== version.contentHash) {
          throw createAppError('NOTE_VERSION_IMMUTABLE', 'NoteVersion cannot be changed', 409);
        }
        return existing;
      }
      const reusable = findReusable(version.noteId, version.contentHash);
      if (reusable) return reusable;
      records.push(version);
      persist();
      return version;
    },
    findById(id: unknown) {
      return records.find(item => item.id === id) ?? null;
    },
    findByNoteIdAndContentHash(noteId: unknown, contentHash: unknown) {
      return findReusable(noteId, contentHash);
    },
    list({ noteId }: NoteVersionListOptions = {}) {
      return records
        .filter(item => !noteId || item.noteId === noteId)
        .sort(
          (left, right) =>
            new (Date as DateConstructorView)(right.createdAt).getTime() -
            new (Date as DateConstructorView)(left.createdAt).getTime()
        );
    },
    listIds({ noteId }: NoteVersionListOptions = {}) {
      return records.filter(item => !noteId || item.noteId === noteId).map(item => item.id);
    },
    listPage({ noteId, limit, after, currentContentHash }: NoteVersionPageOptions) {
      const hashes = new Set<unknown>();
      const ordered = records
        .filter(item => item.noteId === noteId)
        .sort(
          (a, b) =>
            new (Date as unknown as DateArithmeticView)(b.createdAt) -
              new (Date as unknown as DateArithmeticView)(a.createdAt) ||
            (b.id as LocaleCompareView).localeCompare(a.id)
        )
        .filter(item => {
          if (hashes.has(item.contentHash)) return false;
          hashes.add(item.contentHash);
          return true;
        });
      const items = after
        ? ordered.filter(
            item =>
              (Date.parse as (value: unknown) => number)(item.createdAt) <
                (Date.parse as (value: unknown) => number)(after.createdAt) ||
              ((Date.parse as (value: unknown) => number)(item.createdAt) ===
                (Date.parse as (value: unknown) => number)(after.createdAt) &&
                (item.id as LocaleCompareView).localeCompare(after.id) < 0)
          )
        : ordered;
      return versionPage(items.slice(0, limit + 1), {
        limit,
        total: ordered.length,
        currentVersionId: ordered.find(item => item.contentHash === currentContentHash)?.id ?? null
      });
    },
    deleteById(id: unknown) {
      const index = records.findIndex(item => item.id === id);
      if (index < 0) return null;
      const [deleted] = records.splice(index, 1);
      persist();
      return deleted;
    },
    deleteByNoteIds(noteIds: Iterable<unknown> | null | undefined) {
      const ids = new Set(noteIds);
      const deleted = records.filter(item => ids.has(item.noteId));
      if (deleted.length) {
        for (const item of deleted) records.splice(records.indexOf(item), 1);
        persist();
      }
      return deleted;
    }
  };
}
