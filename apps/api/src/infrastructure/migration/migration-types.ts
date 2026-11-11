import type { MigrationClient } from './migration-client.ts';
import type { MigrationPlan } from './migration-records.ts';
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
  pdfAnnotations?: unknown[];
  contentAnnotations?: unknown[];
  annotationExclusions?: unknown[];
  annotationRevisions?: unknown[];
  analysisScopeSnapshots?: unknown[];

  schemaVersion?: number;
  data?: Record<string, object[]>;
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
  sourceFile?: string | null;
  storageRootDir?: string;
  uploadsDir?: string | null;
  fallbackTimestamp?: string;
  allowMissingAttachments?: boolean;
  ownerId?: string | null;
}
export interface ApplyJsonMigrationOptions {
  client?: MigrationClient;
  plan?: MigrationPlan | null;
  report?: MigrationReport & { appliedAt?: string };
  requireEmptyTarget?: boolean;
  replaceExisting?: boolean;
}
