/** 本地历史记录未必经过领域构造器；只要求 schema 已验证的基本字段。 */
export interface NoteRecord {
  id: string;
  title: string;
  rawMarkdown: string;
  contentKind?: 'markdown' | 'pdf';
  pdfSource?: { attachmentId: string; sha256: string; importRequestHash?: string } | null;
  spaceId?: string | null;
  folderId?: string | null;
  tagIds?: string[];
  internalLinks?: string[];
  aiVisibility?: string;
  annotationStructure?: unknown;
  plainText?: unknown;
  contentHash?: unknown;
  status?: unknown;
  sourceType?: unknown;
  favorite?: unknown;
  deleted?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  folderDeletionPackageId?: unknown;
  deletionPackage?: unknown;
}

export interface NoteListOptions {
  spaceId?: string | null;
  folderId?: string | null;
  tagId?: string | null;
  tagIds?: string[] | string | null;
  match?: string | null;
  tagMatch?: string | null;
  deletedOnly?: unknown;
  includeDeleted?: unknown;
  contentKind?: 'markdown' | 'pdf';
  favoriteOnly?: unknown;
  sortBy?: string | null;
  order?: string | null;
  offset?: unknown;
  limit?: unknown;
}

/** 同步本地仓库；保存和普通查询保留记录引用，批量查询浅拷贝并复制标签数组。 */
export interface NoteRepository {
  save(note: NoteRecord): NoteRecord;
  findById(id: string | null | undefined): NoteRecord | null;
  findByIds(ids?: Iterable<string> | null): NoteRecord[];
  delete(id: string | null | undefined): NoteRecord | null;
  list(options?: NoteListOptions): NoteRecord[];
  deleteWhere(predicate: (note: NoteRecord) => unknown): NoteRecord[];
}

export interface NoteRepositoryOptions {
  /** 保留初始数组引用；省略或 null 时使用新数组。 */
  records?: NoteRecord[] | null;
  /** 每次读取当前回调并保留 options 接收者；异常不回滚内存变更。 */
  onChange?: ((records: NoteRecord[]) => void) | null;
}

// 原生 Date 构造器与 parse 接受 JavaScript 值并可能抛错；只扩展类型重载，不预处理或缓存 Date。
type NativeDateConstructor = new (value: unknown) => Date;
type NativeDateParser = { parse(value: unknown): number };
// sortBy 允许任意字段名，只在动态读取处声明未知值，不给领域模型添加宽泛索引签名。
type SortableNoteRecord = NoteRecord & { [field: string]: unknown };

export function createInMemoryNoteRepository(options: NoteRepositoryOptions = {}): NoteRepository {
  const notes = options.records ?? [];

  function persist() {
    options.onChange?.(notes);
  }

  function isTruthy(value: unknown) {
    return value === true || value === 'true';
  }

  function compareValues(left: NoteRecord, right: NoteRecord, sortBy: string, order: string) {
    if (left?.favorite !== right?.favorite) {
      return left?.favorite ? -1 : 1;
    }

    const direction = order === 'asc' ? 1 : -1;
    const leftValue = (left as SortableNoteRecord)?.[sortBy] ?? '';
    const rightValue = (right as SortableNoteRecord)?.[sortBy] ?? '';

    if (sortBy === 'createdAt' || sortBy === 'updatedAt') {
      return (
        (new (Date as NativeDateConstructor)(leftValue).getTime() -
          new (Date as NativeDateConstructor)(rightValue).getTime()) *
        direction
      );
    }

    return String(leftValue).localeCompare(String(rightValue)) * direction;
  }

  return {
    save(note) {
      const existingIndex = notes.findIndex(item => item.id === note.id);

      if (existingIndex === -1) {
        notes.push(note);
        persist();
        return note;
      }

      note.updatedAt = new Date(
        Math.max(
          (Date as NativeDateParser).parse(note.updatedAt),
          (Date as NativeDateParser).parse(notes[existingIndex].updatedAt) + 1
        )
      ).toISOString();
      notes[existingIndex] = note;
      persist();
      return note;
    },
    findById(noteId) {
      return notes.find(note => note.id === noteId) ?? null;
    },
    findByIds(noteIds) {
      const ids = new Set(noteIds ?? []);
      return notes.filter(note => ids.has(note.id)).map(note => ({ ...note, tagIds: [...(note.tagIds ?? [])] }));
    },
    delete(noteId) {
      const existingIndex = notes.findIndex(note => note.id === noteId);
      if (existingIndex === -1) {
        return null;
      }

      const [deletedNote] = notes.splice(existingIndex, 1);
      persist();
      return deletedNote;
    },
    list(options = {}) {
      const results = notes
        .filter(note => {
          if (isTruthy(options.deletedOnly)) {
            return note.deleted;
          }

          return isTruthy(options.includeDeleted) ? true : !note.deleted;
        })
        .filter(note => (options.spaceId ? note.spaceId === options.spaceId : true))
        .filter(note => (options.folderId ? note.folderId === options.folderId : true))
        .filter(note => {
          const tagIds = Array.isArray(options.tagIds)
            ? options.tagIds
            : typeof options.tagIds === 'string'
              ? options.tagIds.split(',').filter(Boolean)
              : [];
          // 历史记录可缺少 tagIds；类型断言保留原 includes 的 TypeError，不新增回退或校验。
          if (tagIds.length === 0) return options.tagId ? note.tagIds!.includes(options.tagId) : true;
          return (options.match ?? options.tagMatch) === 'any'
            ? tagIds.some(tagId => note.tagIds!.includes(tagId))
            : tagIds.every(tagId => note.tagIds!.includes(tagId));
        })
        .filter(note => (isTruthy(options.favoriteOnly) ? note.favorite : true))
        .filter(note => !options.contentKind || (note.contentKind ?? 'markdown') === options.contentKind);

      const sortBy = options.sortBy ?? 'updatedAt';
      const order = options.order ?? 'desc';
      results.sort((left, right) => compareValues(left, right, sortBy, order));

      const offset = options.offset ? Number(options.offset) : 0;

      if (options.limit) {
        return results.slice(offset, offset + Number(options.limit));
      }

      if (offset > 0) {
        return results.slice(offset);
      }

      return results;
    },
    deleteWhere(predicate) {
      const deletedNotes: NoteRecord[] = [];

      for (let index = notes.length - 1; index >= 0; index -= 1) {
        if (!predicate(notes[index])) {
          continue;
        }

        deletedNotes.push(notes[index]);
        notes.splice(index, 1);
      }

      if (deletedNotes.length > 0) {
        persist();
      }

      return deletedNotes.reverse();
    }
  };
}
