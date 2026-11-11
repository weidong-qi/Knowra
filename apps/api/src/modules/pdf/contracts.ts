import type { PrismaClient, Prisma } from '@prisma/client';
import type { PdfAnnotation, PdfSource } from '@study-accelerator/shared/pdf';
import type { Note, NoteConstructorInput } from '../knowledge/domain/note.ts';
import type { LocalAttachmentRecord } from '../../infrastructure/local-attachment-types.ts';
import type { createMaintenanceGate } from '../../infrastructure/maintenance-gate.ts';
import type { buildNoteData, mapNote } from '../knowledge/infrastructure/postgres/mappers.ts';
import type { buildJsonMigrationPlan, applyJsonMigration } from '../../infrastructure/migration/json-to-postgres.ts';
import type { createPdfFiles } from './files.ts';

export type BinaryStream = AsyncIterable<Uint8Array | string>;
export type Awaitable<T> = T | PromiseLike<T>;
export type PdfNoteRecord = Omit<Note, 'internalLinks' | 'annotationStructure' | 'deletionPackage'> & {
  internalLinks?: unknown[];
  annotationStructure?: unknown;
  deletionPackage?: unknown;
  deletedAt?: string | Date | null;
};
export type PdfNewNote = NoteConstructorInput & { contentKind: 'pdf'; pdfSource: PdfSource; spaceId: string };
export type PdfAttachment = LocalAttachmentRecord & { mimeType: string };
export type PdfStoredAnnotation = PdfAnnotation & { requestHash?: string; importRequestHash?: string };
export interface PdfFolder {
  id: string;
  spaceId: string;
  name: string;
  parentId: string | null;
  deletedAt?: string | Date | null;
}
export interface PdfSpace {
  id: string;
  userId: string;
}
export interface PdfState extends Record<string, object[]> {
  notes: PdfNoteRecord[];
  folders: PdfFolder[];
  spaces: PdfSpace[];
  attachments: PdfAttachment[];
  pdfAnnotations: PdfStoredAnnotation[];
}
export interface PdfSnapshot {
  version?: string;
  schemaVersion: number;
  data: PdfState;
  exportedAt?: string;
}
export interface PdfDataStore {
  state: PdfState;
  runTransaction<T>(operation: () => T): T;
  flush(): void;
  exportSnapshot(): PdfSnapshot;
  prepareImport(snapshot: PdfSnapshot): PdfSnapshot;
  commitImport(snapshot: PdfSnapshot): object;
}
export interface PdfKnowledge {
  repositories: {
    noteRepository: {
      findById(id: string): Awaitable<PdfNoteRecord | null | undefined>;
      list(input: { spaceId: string }): Awaitable<PdfNoteRecord[]>;
    };
    knowledgeSpaceRepository: { findById(id: string | null | undefined): Awaitable<PdfSpace | null | undefined> };
    folderRepository: { findById(id: string): Awaitable<PdfFolder | null | undefined> };
  };
  noteService: { createNote(note: PdfNewNote): Awaitable<PdfNoteRecord> };
}
export interface PdfPostgres {
  buildNoteData: typeof buildNoteData;
  mapNote: typeof mapNote;
  readSnapshot(tx: Prisma.TransactionClient): Promise<Record<string, object[]>>;
  buildMigrationPlan: typeof buildJsonMigrationPlan;
  applyMigration(
    input: Omit<NonNullable<Parameters<typeof applyJsonMigration>[0]>, 'client'>
  ): ReturnType<typeof applyJsonMigration>;
}
export interface PdfRepositoryOptions {
  dataStore: PdfDataStore | null;
  db: PrismaClient | null;
  postgres: PdfPostgres | null;
  knowledge: PdfKnowledge;
  ownerId: string;
}
export interface PdfServiceOptions extends Partial<Pick<PdfRepositoryOptions, 'dataStore' | 'db' | 'postgres'>> {
  knowledge: PdfKnowledge;
  ownerId: string;
  uploadsDir: string;
  storageRootDir: string;
  maintenanceGate?: ReturnType<typeof createMaintenanceGate> | null;
  beforeImport?: () => Promise<unknown>;
}
export interface PdfArchiveOptions extends Pick<PdfRepositoryOptions, 'dataStore' | 'db' | 'postgres' | 'ownerId'> {
  files: ReturnType<typeof createPdfFiles>;
  storageRootDir: string;
  maintenanceGate?: ReturnType<typeof createMaintenanceGate> | null;
  beforeImport?: () => Promise<unknown>;
}
export interface PdfImportInput {
  operationId?: string;
  spaceId?: string;
  fileName?: string;
  folderId?: string | null;
  title?: string | null;
}
export type PdfMutationInput = Partial<
  Pick<PdfAnnotation, 'operationId' | 'type' | 'segments' | 'quoteText' | 'kind' | 'comment'>
> & { expectedRevision?: number };
