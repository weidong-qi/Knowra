import { stripKnowraMarks } from '@study-accelerator/shared/knowra-marks';
import { updateStructure, extractNoteLinks } from '@study-accelerator/content-anchor';
import type { AnnotationStructure } from '@study-accelerator/content-anchor';

export interface NoteDeletionPackage {
  id: string;
  deletedAt: string;
  annotationStates: Array<{ id: string; lifecycleStatus: string; revision: number }>;
}

/** 默认类型保留规范调用契约；泛型只描述历史字段的原样透传，不代表已经校验。 */
export interface NoteConstructorInput<
  Status = string,
  SourceType = string,
  Favorite = boolean,
  Deleted = boolean,
  ContentHash = string | null,
  Structure = AnnotationStructure,
  CreatedAt = string | null,
  UpdatedAt = string | null,
  FolderDeletionPackageId = string | null,
  DeletionPackage = NoteDeletionPackage | null,
  TagId = string,
  InternalLink = string
> {
  id: string;
  spaceId?: string | null;
  folderId?: string | null;
  title: string;
  rawMarkdown: unknown;
  status?: Status | string;
  sourceType?: SourceType | string;
  favorite?: Favorite | boolean;
  aiVisibility?: string;
  deleted?: Deleted | boolean;
  tagIds?: TagId[];
  plainText?: unknown;
  internalLinks?: InternalLink[] | null;
  contentHash?: ContentHash | null;
  annotationStructure?: Structure | null;
  createdAt?: CreatedAt | string;
  updatedAt?: UpdatedAt | CreatedAt | string;
  folderDeletionPackageId?: FolderDeletionPackageId | null;
  deletionPackage?: DeletionPackage | null;
}

function stripMarkdown(markdown: string): string {
  // 先去掉 Knowra 标记（重点、挖空），否则搜索、摘要会被标签打断。
  return stripKnowraMarks(markdown)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractInternalLinks(markdown: string): string[] {
  return extractNoteLinks(markdown).targetIds;
}

/** 泛型输出保留真实输入与既有默认值；历史 unknown 不会被提升为规范领域值。 */
export class Note<
  Status = string,
  SourceType = string,
  Favorite = boolean,
  Deleted = boolean,
  ContentHash = string | null,
  Structure = AnnotationStructure,
  CreatedAt = string | null,
  UpdatedAt = string | null,
  FolderDeletionPackageId = string | null,
  DeletionPackage = NoteDeletionPackage | null,
  TagId = string,
  InternalLink = string
> {
  declare id: string;
  declare spaceId: string | null;
  declare folderId: string | null;
  declare title: string;
  declare rawMarkdown: string;
  declare plainText: string;
  declare internalLinks: InternalLink[] | string[];
  declare contentHash: ContentHash | null;
  declare annotationStructure: NonNullable<Structure> | AnnotationStructure;
  declare status: Status | string;
  declare sourceType: SourceType | string;
  declare favorite: Favorite | boolean;
  declare aiVisibility: string;
  declare deleted: Deleted | boolean;
  declare tagIds: TagId[];
  declare createdAt: CreatedAt | string;
  declare updatedAt: UpdatedAt | CreatedAt | string;
  declare folderDeletionPackageId: FolderDeletionPackageId | null;
  declare deletionPackage: DeletionPackage | null;

  constructor({
    id,
    spaceId = null,
    folderId = null,
    title,
    rawMarkdown,
    status = 'draft',
    sourceType = 'manual',
    favorite = false,
    aiVisibility = 'normal',
    deleted = false,
    tagIds = [],
    plainText,
    internalLinks,
    contentHash = null,
    annotationStructure = null,
    createdAt = new Date().toISOString(),
    updatedAt = createdAt,
    folderDeletionPackageId = null,
    deletionPackage = null
  }: NoteConstructorInput<
    Status,
    SourceType,
    Favorite,
    Deleted,
    ContentHash,
    Structure,
    CreatedAt,
    UpdatedAt,
    FolderDeletionPackageId,
    DeletionPackage,
    TagId,
    InternalLink
  >) {
    if (!id?.trim()) {
      throw new Error('Note id is required');
    }
    if (!title?.trim()) {
      throw new Error('Note title is required');
    }
    if (typeof rawMarkdown !== 'string') {
      throw new Error('Note rawMarkdown is required');
    }

    this.id = id;
    this.spaceId = spaceId;
    this.folderId = folderId;
    this.title = title.trim();
    this.rawMarkdown = rawMarkdown;
    this.plainText = typeof plainText === 'string' ? plainText : stripMarkdown(rawMarkdown);
    this.internalLinks = Array.isArray(internalLinks) ? [...new Set(internalLinks)] : extractInternalLinks(rawMarkdown);
    this.contentHash = contentHash;
    this.annotationStructure = annotationStructure ?? updateStructure('', rawMarkdown);
    this.status = status;
    this.sourceType = sourceType;
    this.favorite = favorite;
    this.aiVisibility = aiVisibility;
    this.deleted = deleted;
    this.tagIds = [...new Set(tagIds)];
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
    this.folderDeletionPackageId = folderDeletionPackageId;
    this.deletionPackage = deletionPackage;
  }
}
