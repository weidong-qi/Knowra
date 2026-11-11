import type { AppError } from '../errors/app-error.ts';
import type { AttachmentStatus } from './attachment-status.ts';

/** 文件定位与完整性巡检也接受尚未补齐的旧元数据。 */
export interface AttachmentFileMetadata {
  id?: string | null;
  fileName?: string | null;
  storagePath?: string | null;
  size?: number;
  sha256?: string | null;
}

export interface LocalAttachmentRecord extends AttachmentFileMetadata {
  id: string;
  noteId: string;
  fileName: string;
  storagePath: string;
  size: number;
  mimeType?: string;
  status?: AttachmentStatus;
  verifiedAt?: string | null;
  createdAt?: string;
}
/** PG status 仍是数据库原始字符串；恢复流程只与已知状态比较。 */
export type AttachmentRecoveryRecord = Omit<LocalAttachmentRecord, 'status'> & { status?: string };

export interface LocalAttachmentDataStore {
  readonly state: { attachments: LocalAttachmentRecord[] };
}

export interface AttachmentFileManager {
  buildStoragePath(id: string | null | undefined, safeName: string | null | undefined): string;
  getAttachmentCandidatePaths(attachment: AttachmentFileMetadata | null | undefined): string[];
  getAttachmentFileName(attachment: AttachmentFileMetadata | null | undefined): string;
  getManagedUploadsDirectory(): string;
  reconcileAttachmentRecord(attachment: AttachmentFileMetadata): boolean;
  removeAttachmentFile(attachment: AttachmentFileMetadata): boolean;
  resolveManagedAttachmentPath(attachment: AttachmentFileMetadata | null | undefined): string | null;
  resolveManagedAbsolutePath(id: string | null | undefined, safeName: string | null | undefined): string;
  resolvePortableStoragePath(storagePath: string | null | undefined): string | null;
  resolveReadableAttachmentPath(attachment: AttachmentFileMetadata): string | null;
}

/** IO 与宿主提交错误仍原样抛出，只在原对象上保留既有诊断字段。 */
export interface AttachmentOperationError extends Partial<AppError> {
  cleanupError?: Error;
  rollbackError?: Error;
  recordLookupError?: Error;
  restoreError?: Error;
  statusPersistError?: Error;
}

export type AttachmentFileHealth =
  | { status: 'ready'; verifiedAt: string; content: Buffer }
  | { status: 'missing' | 'failed' | 'corrupt'; verifiedAt: null; content?: undefined };

export interface AttachmentRestoreBody {
  contentBase64?: string;
}
export interface AttachmentRestoreIntent {
  attachment: LocalAttachmentRecord;
  staged?: string;
  backup?: string;
}
