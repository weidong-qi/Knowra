/** 静态支持域；运行校验仍按原有读取顺序拒绝无效 JS 输入。 */
export interface CatalogArguments {
  readonly parentId?: string;
  readonly folderId?: string;
  readonly titleQuery?: string;
  readonly recursive?: boolean;
  readonly sortBy?: string;
  readonly limit?: number | null;
  readonly offset?: number | null;
}
export interface FolderCatalogSpec {
  kind: 'folders';
  parentId: string | null;
  offset: number;
  limit: number;
}
export interface NoteCatalogSpec {
  kind: 'notes';
  folderId: string | null;
  titleQuery: string | null;
  recursive: boolean;
  sortBy: string;
  offset: number;
  limit: number;
}
export type CatalogSpec = FolderCatalogSpec | NoteCatalogSpec;
export interface CatalogCall {
  readonly status: unknown;
  readonly toolName: string;
  readonly argumentsJson?: CatalogArguments | null;
}

/** 目录类只读工具：让模型看到授权范围内的目录结构与笔记标题（元数据，不含正文）。 */
export const FOLDER_LIMIT = 30;
export const NOTE_LIMIT = 20;
export const CATALOG_TOOL_NAMES = Object.freeze(['folders_list', 'notes_list']);
export const MAX_CATALOG_SPECS = 3;

export const FOLDERS_LIST_TOOL = Object.freeze({
  name: 'folders_list',
  description:
    '列出授权范围内的目录（名称、ID、笔记数），结果在 catalog 中。不传 parentId 为顶层目录，传目录 ID 为其子目录。',
  parameters: {
    type: 'object',
    properties: {
      parentId: { type: 'string', maxLength: 128 },
      limit: { type: 'integer', minimum: 1, maximum: FOLDER_LIMIT },
      offset: { type: 'integer', minimum: 0 }
    },
    additionalProperties: false
  }
});

export const NOTES_LIST_TOOL = Object.freeze({
  name: 'notes_list',
  description:
    '列出授权范围内笔记的标题、ID、重点数（不含正文），结果在 catalog 中。folderId 限定目录（recursive=true 含子目录），titleQuery 按标题查找，sortBy=annotations 按重点数排序；正文用 notes_read。',
  parameters: {
    type: 'object',
    properties: {
      folderId: { type: 'string', maxLength: 128 },
      titleQuery: { type: 'string', maxLength: 100 },
      recursive: { type: 'boolean' },
      sortBy: { type: 'string', enum: ['updated', 'annotations'] },
      limit: { type: 'integer', minimum: 1, maximum: NOTE_LIMIT },
      offset: { type: 'integer', minimum: 0 }
    },
    additionalProperties: false
  }
});

function invalid() {
  const error: Error & { code?: string } = new Error('目录工具参数无效。');
  error.code = 'AI_TOOL_ARGUMENTS_INVALID';
  return error;
}
const validId: (value: unknown) => boolean = value =>
  typeof value === 'string' && value.length > 0 && value.length <= 128;

/** 工具参数 → 固定形状的规格；既用于执行校验，也用于重建发送给模型的 catalog 和清单记录。 */
export function normalizeCatalogSpec(toolName: string, args: CatalogArguments | null | undefined): CatalogSpec {
  const allowed =
    toolName === 'folders_list'
      ? ['parentId', 'limit', 'offset']
      : toolName === 'notes_list'
        ? ['folderId', 'titleQuery', 'recursive', 'sortBy', 'limit', 'offset']
        : null;
  if (
    !allowed ||
    !args ||
    typeof args !== 'object' ||
    Array.isArray(args) ||
    Object.keys(args).some(key => !allowed.includes(key))
  )
    throw invalid();
  const maxLimit = toolName === 'folders_list' ? FOLDER_LIMIT : NOTE_LIMIT;
  const limit = args.limit ?? maxLimit,
    offset = args.offset ?? 0;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxLimit || !Number.isSafeInteger(offset) || offset < 0)
    throw invalid();
  if (toolName === 'folders_list') {
    if (args.parentId !== undefined && !validId(args.parentId)) throw invalid();
    return { kind: 'folders', parentId: args.parentId ?? null, offset, limit };
  }
  if (args.folderId !== undefined && !validId(args.folderId)) throw invalid();
  if (
    args.titleQuery !== undefined &&
    (typeof args.titleQuery !== 'string' || !args.titleQuery.trim() || args.titleQuery.length > 100)
  )
    throw invalid();
  if (args.recursive !== undefined && typeof args.recursive !== 'boolean') throw invalid();
  if (args.sortBy !== undefined && !['updated', 'annotations'].includes(args.sortBy)) throw invalid();
  return {
    kind: 'notes',
    folderId: args.folderId ?? null,
    titleQuery: args.titleQuery?.trim() ?? null,
    recursive: args.recursive ?? false,
    sortBy: args.sortBy ?? 'updated',
    offset,
    limit
  };
}

/** 只取本回合最近几次成功的目录调用，按参数去重；过多的目录结果会挤占来源预算。 */
export function catalogSpecsFromCalls(calls: Iterable<CatalogCall, unknown, unknown>): CatalogSpec[] {
  const specs = new Map<string, CatalogSpec>();
  for (const call of calls) {
    if (call.status !== 'succeeded' || !CATALOG_TOOL_NAMES.includes(call.toolName)) continue;
    let spec;
    try {
      spec = normalizeCatalogSpec(call.toolName, call.argumentsJson);
    } catch {
      continue;
    }
    const key = JSON.stringify(spec);
    specs.delete(key);
    specs.set(key, spec);
  }
  return [...specs.values()].slice(-MAX_CATALOG_SPECS);
}
