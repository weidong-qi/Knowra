import type { Prisma } from '@prisma/client';

export interface MigrationReportOptions {
  readonly sourceFile?: string | null;
  readonly storageRootDir?: string | null;
  readonly generatedAt?: string;
}
export interface MigrationReportEntry {
  [key: string]: Prisma.JsonValue | undefined;
  code: string;
  message: string;
}
interface MigrationAttachmentFile {
  attachmentId: string;
  filePath: string | null;
  exists: boolean;
  size: number;
  contentSha256: string | null;
}
export interface MigrationReport {
  phase: string;
  migration: string;
  generatedAt: string;
  sourceFile: string | null;
  storageRootDir: string | null;
  status: 'ready' | 'blocked' | 'applied';
  counts: Record<string, number>;
  repairs: MigrationReportEntry[];
  warnings: MigrationReportEntry[];
  errors: MigrationReportEntry[];
  attachmentFiles: MigrationAttachmentFile[];
  checksum: string | null;
  appliedAt?: string;
  sourceBackupFile?: string;
}
type ReportDetails = Record<string, Prisma.JsonValue | undefined>;
export interface MigrationReportTools {
  report: MigrationReport;
  count(collection: string, value: number): void;
  repair(code: string, message: string, details?: ReportDetails | null): void;
  warn(code: string, message: string, details?: ReportDetails | null): void;
  error(code: string, message: string, details?: ReportDetails | null): void;
  finish(status?: MigrationReport['status']): MigrationReport;
}

export function createMigrationReport({
  sourceFile,
  storageRootDir,
  generatedAt = new Date().toISOString()
}: MigrationReportOptions = {}): MigrationReportTools {
  const report: MigrationReport = {
    phase: 'Phase1.0',
    migration: 'json-to-postgres',
    generatedAt,
    sourceFile: sourceFile ?? null,
    storageRootDir: storageRootDir ?? null,
    status: 'ready',
    counts: {},
    repairs: [],
    warnings: [],
    errors: [],
    attachmentFiles: [],
    checksum: null
  };

  return {
    report,
    count(collection: string, value: number) {
      report.counts[collection] = value;
    },
    repair(code: string, message: string, details: ReportDetails | null | undefined = {}) {
      report.repairs.push({ code, message, ...details });
    },
    warn(code: string, message: string, details: ReportDetails | null | undefined = {}) {
      report.warnings.push({ code, message, ...details });
    },
    error(code: string, message: string, details: ReportDetails | null | undefined = {}) {
      report.errors.push({ code, message, ...details });
      report.status = 'blocked';
    },
    finish(status: MigrationReport['status'] = report.errors.length ? 'blocked' : 'ready') {
      report.status = status;
      return report;
    }
  };
}
