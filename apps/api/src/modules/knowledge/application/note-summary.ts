import { stripKnowraMarks } from '@study-accelerator/shared/knowra-marks';

/** 摘要只投影现有字段，不把历史输入提升为已验证领域数据。 */
export interface NoteSummaryInput {
  id?: unknown;
  spaceId?: unknown;
  folderId?: unknown;
  title?: unknown;
  plainText?: unknown;
  rawMarkdown?: unknown;
  contentKind?: 'markdown' | 'pdf';
  pdfSource?: { attachmentId: string; sha256: string; importRequestHash?: string } | null;
  internalLinks?: unknown;
  status?: unknown;
  sourceType?: unknown;
  favorite?: unknown;
  aiVisibility?: unknown;
  deleted?: unknown;
  tagIds?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface NoteSummaryOutlineEntry {
  level: number;
  title: string;
}

/** 直接读取保留输入类型；数组分支会再次读取并迭代，不保证元素是字符串。 */
export interface NoteSummary<Source extends NoteSummaryInput = NoteSummaryInput> {
  contentKind: 'markdown' | 'pdf';
  pdfSource: Source['pdfSource'];
  id: Source['id'];
  spaceId: Source['spaceId'];
  folderId: Source['folderId'];
  title: Source['title'];
  summary: string;
  characterCount: number;
  readingMinutes: number;
  outline: NoteSummaryOutlineEntry[];
  internalLinks: unknown[];
  status: Source['status'];
  sourceType: Source['sourceType'];
  favorite: Source['favorite'];
  aiVisibility: NonNullable<Source['aiVisibility']> | 'normal';
  deleted: Source['deleted'];
  tagIds: unknown[];
  createdAt: Source['createdAt'];
  updatedAt: Source['updatedAt'];
  contentLoaded: false;
}

const SUMMARY_CHARACTER_LIMIT = 240;
const READING_CHARACTERS_PER_MINUTE = 360;

export function createNoteSummary<Source extends NoteSummaryInput>(note: Source): NoteSummary<Source> {
  const plainText = String(note?.plainText ?? '');
  const characterCount = countCharacters(plainText);

  return {
    id: note.id,
    spaceId: note.spaceId,
    folderId: note.folderId,
    title: note.title,
    summary: plainText.slice(0, SUMMARY_CHARACTER_LIMIT),
    characterCount,
    readingMinutes: Math.max(1, Math.ceil(characterCount / READING_CHARACTERS_PER_MINUTE)),
    outline: extractOutline(note.rawMarkdown),
    internalLinks: Array.isArray(note.internalLinks) ? [...note.internalLinks] : [],
    status: note.status,
    sourceType: note.sourceType,
    favorite: note.favorite,
    aiVisibility: note.aiVisibility ?? 'normal',
    deleted: note.deleted,
    tagIds: Array.isArray(note.tagIds) ? [...note.tagIds] : [],
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    contentLoaded: false,
    contentKind: note.contentKind ?? 'markdown',
    pdfSource: note.pdfSource
  };
}

function extractOutline(markdown: unknown): NoteSummaryOutlineEntry[] {
  return stripKnowraMarks(String(markdown ?? ''))
    .split('\n')
    .flatMap(line => {
      const match = /^(#{1,3})\s+(.+)$/.exec(line.trim());
      return match ? [{ level: match[1].length, title: match[2].trim() }] : [];
    });
}

function countCharacters(value: unknown): number {
  return String(value ?? '').replace(/\s/g, '').length;
}
