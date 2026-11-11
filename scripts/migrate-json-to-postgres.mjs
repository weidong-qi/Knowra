import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrismaRuntime } from '../apps/api/src/infrastructure/prisma-client.js';
import {
  applyJsonMigration,
  buildJsonMigrationPlan,
  loadJsonMigrationSource
} from '../apps/api/src/infrastructure/migration/json-to-postgres.js';

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptsDirectory, '..');
const args = parseArguments(process.argv.slice(2));
const sourceFile = path.resolve(args.source ?? path.join(workspaceRoot, 'storage/data/knowledge-base.json'));
const storageRootDir = path.resolve(args['storage-root'] ?? workspaceRoot);
const uploadsDir = path.resolve(args['uploads-dir'] ?? path.join(storageRootDir, 'storage', 'uploads'));
const fallbackTimestamp = args['fallback-timestamp'] ?? new Date().toISOString();
const allowMissingAttachments = Boolean(args['allow-missing-attachments']);
const ownerId = args['owner-id'] ?? process.env.KNOWRA_OWNER_ID ?? 'demo';

try {
  const source = loadJsonMigrationSource(sourceFile);
  const result = buildJsonMigrationPlan({
    input: source.parsed,
    sourceFile,
    storageRootDir,
    uploadsDir,
    fallbackTimestamp,
    allowMissingAttachments,
    ownerId
  });
  const reportPath = args.report ? path.resolve(args.report) : null;
  if (reportPath) writeReport(reportPath, result.report, sourceFile, args.apply);
  if (!args.apply) {
    console.log(JSON.stringify(result.report, null, 2));
    process.exitCode = result.canApply ? 0 : 2;
  } else if (!result.canApply) {
    console.error(JSON.stringify(result.report, null, 2));
    process.exitCode = 2;
  } else {
    const runtime = await createPrismaRuntime({ databaseUrl: args['database-url'] ?? process.env.DATABASE_URL });
    try {
      await runtime.connect();
      const report = await applyJsonMigration({
        client: runtime.client,
        plan: result.plan,
        report: result.report
      });
      if (reportPath) writeReport(reportPath, report, sourceFile, true);
      console.log(JSON.stringify(report, null, 2));
    } finally {
      await runtime.disconnect();
    }
  }
} catch (error) {
  console.error(
    JSON.stringify(
      {
        status: 'failed',
        code: error.code ?? 'MIGRATION_FAILED',
        message: error.message
      },
      null,
      2
    )
  );
  process.exitCode = 1;
}

function parseArguments(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) continue;
    const key = value.slice(2);
    if (key === 'apply' || key === 'allow-missing-attachments') {
      result[key] = true;
      continue;
    }
    result[key] = values[index + 1];
    index += 1;
  }
  return result;
}

function writeReport(reportPath, report, sourceFile, applied) {
  const directory = path.dirname(reportPath);
  fs.mkdirSync(directory, { recursive: true });
  if (applied) {
    const backupPath = `${reportPath}.source.json`;
    fs.copyFileSync(sourceFile, backupPath);
    report.sourceBackupFile = backupPath;
  }
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
