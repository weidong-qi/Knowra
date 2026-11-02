import type { PrismaClient } from '@prisma/client';
import type { buildJsonMigrationPlan } from './json-to-postgres.js';
import type { MigrationReport } from './migration-report.ts';

export interface JsonMigrationInput {
  spaces?: unknown[];
  folders?: unknown[];
  tags?: unknown[];
  tagGroups?: unknown[];
  notes?: unknown[];
  noteVersions?: unknown[];
  knowledgeItems?: unknown[];
  knowledgeEvidence?: unknown[];
  knowledgeArtifactProvenance?: unknown[];
  learningObjectives?: unknown[];
  examProfiles?: unknown[];
  examFocuses?: unknown[];
  questions?: unknown[];
  questionObjectives?: unknown[];
  questionSources?: unknown[];
  attachments?: unknown[];
  contentAnnotations?: unknown[];
  annotationExclusions?: unknown[];
  annotationRevisions?: unknown[];
  analysisScopeSnapshots?: unknown[];

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
