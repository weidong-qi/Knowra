import type { PrismaClient } from '@prisma/client';
import type { buildJsonMigrationPlan } from './json-to-postgres.js';
import type { MigrationReport } from './migration-report.ts';

export interface JsonMigrationInput {
  schemaVersion?: number;
  data?: ReturnType<typeof import('../local-data-schema.js').createEmptyLocalState>;
  knowledgeExtractionCommits?: unknown;
  sync?: {
    tombstones?: Record<
      string,
      { collection: string; id: string; revision: number; eventId: string; deletedAt: string | null }
    >;
  };
}
export interface JsonMigrationOptions {
  input?: JsonMigrationInput;
  sourceFile?: string;
  storageRootDir?: string;
  uploadsDir?: string;
  fallbackTimestamp?: string;
  allowMissingAttachments?: boolean;
  ownerId?: string;
}
export interface ApplyJsonMigrationOptions {
  client?: PrismaClient;
  plan?: ReturnType<typeof buildJsonMigrationPlan>['plan'];
  report?: MigrationReport & { appliedAt?: string };
  requireEmptyTarget?: boolean;
  replaceExisting?: boolean;
}
