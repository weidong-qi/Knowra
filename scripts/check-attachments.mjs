import fs from 'node:fs';
import path from 'node:path';
import { createPrismaRuntime } from '../apps/api/src/infrastructure/prisma-client.js';
import {
  buildAttachmentRepairRecord,
  inspectAttachmentIntegrity
} from '../apps/api/src/infrastructure/attachment-integrity.js';
import { createLocalAttachmentFileManager } from '../apps/api/src/infrastructure/local-attachment-file-manager.ts';
import { createFileDataStore } from '../apps/api/src/infrastructure/file-data-store.js';
import { validatePersistedLocalState } from '../apps/api/src/infrastructure/local-data-schema.js';
import { readJsonFileSync } from '../apps/api/src/infrastructure/json-file-reader.ts';
import { readAttachmentInspectionSource } from '../apps/api/src/infrastructure/attachment-inspection-source.ts';

const options = parseArgs(process.argv.slice(2));

try {
  const report = await run(options);
  if (options.reportPath) writeReport(options.reportPath, report);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.status === 'ready' ? 0 : 2;
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}

async function run({ driver, sourcePath, storageRootDir, reportPath, repair, attachmentsOnly }) {
  const generatedAt = new Date().toISOString();
  const fileManager = createLocalAttachmentFileManager({
    uploadsDir: resolvePath(process.env.STORAGE_UPLOADS_DIR || 'storage/uploads', storageRootDir),
    storageRootDir
  });
  const context = {
    driver,
    sourcePath,
    storageRootDir,
    reportPath: reportPath ?? null,
    repair,
    attachmentsOnly,
    validationScope: attachmentsOnly ? 'attachment-integrity' : 'complete-library',
    generatedAt
  };

  if (driver === 'local-json') {
    return runLocalInspection({ ...context, fileManager });
  }
  return runPostgresInspection({ ...context, fileManager });
}

function runLocalInspection({ sourcePath, fileManager, generatedAt, repair, attachmentsOnly, ...context }) {
  const absolutePath = path.resolve(sourcePath);
  const parsed = attachmentsOnly ? null : readJsonFileSync(absolutePath);
  const state = attachmentsOnly
    ? readAttachmentInspectionSource(absolutePath)
    : validatePersistedLocalState(parsed?.data ?? parsed);
  let result = inspectAttachmentIntegrity({
    attachments: state.attachments,
    fileManager,
    generatedAt
  });
  const repairs = buildAttachmentRepairs(state.attachments, result, generatedAt);

  if (repair && repairs.length > 0) {
    const dataStore = createFileDataStore(absolutePath);
    dataStore.state.attachments.splice(
      0,
      dataStore.state.attachments.length,
      ...state.attachments.map(attachment => repairs.find(item => item.id === attachment.id)?.record ?? attachment)
    );
    dataStore.flush();
    result = inspectAttachmentIntegrity({
      attachments: dataStore.state.attachments,
      fileManager,
      generatedAt: new Date().toISOString()
    });
  }

  return { ...context, ...result, repairs };
}

async function runPostgresInspection({ fileManager, generatedAt, repair, ...context }) {
  const { mapAttachment } = await import('../apps/api/src/modules/knowledge/infrastructure/postgres/mappers.js');
  const runtime = await createPrismaRuntime({ databaseUrl: process.env.DATABASE_URL });
  await runtime.connect();
  try {
    const rows = await runtime.client.attachment.findMany({
      orderBy: { createdAt: 'asc' }
    });
    let attachments = rows.map(mapAttachment);
    let result = inspectAttachmentIntegrity({
      attachments,
      fileManager,
      generatedAt
    });
    const repairs = buildAttachmentRepairs(attachments, result, generatedAt);

    if (repair && repairs.length > 0) {
      await runtime.client.$transaction(
        repairs.map(({ id, record }) =>
          runtime.client.attachment.update({
            where: { id },
            data: {
              size: record.size,
              sha256: record.sha256,
              status: record.status,
              verifiedAt: record.verifiedAt ? new Date(record.verifiedAt) : null
            }
          })
        )
      );
      attachments = attachments.map(
        attachment => repairs.find(item => item.id === attachment.id)?.record ?? attachment
      );
      result = inspectAttachmentIntegrity({
        attachments,
        fileManager,
        generatedAt: new Date().toISOString()
      });
    }

    return { ...context, ...result, repairs };
  } finally {
    await runtime.disconnect();
  }
}

function buildAttachmentRepairs(attachments, result, generatedAt) {
  return result.items
    .filter(
      item => item.observedStatus !== item.storedStatus || (item.observedStatus === 'ready' && item.warnings.length > 0)
    )
    .map(item => {
      const attachment = attachments.find(candidate => candidate.id === item.attachmentId);
      return {
        id: item.attachmentId,
        record: buildAttachmentRepairRecord(attachment, item, {
          verifiedAt: generatedAt
        })
      };
    });
}

function parseArgs(args) {
  const parsed = {
    driver: process.env.PERSISTENCE_DRIVER || 'local-json',
    sourcePath: 'storage/data/knowledge-base.json',
    storageRootDir: process.cwd(),
    reportPath: null,
    repair: false,
    attachmentsOnly: false
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--repair') {
      parsed.repair = true;
    } else if (arg === '--attachments-only') {
      parsed.attachmentsOnly = true;
    } else if (arg.startsWith('--driver=')) {
      parsed.driver = arg.slice('--driver='.length);
    } else if (arg === '--driver') {
      parsed.driver = args[++index];
    } else if (arg.startsWith('--source=')) {
      parsed.sourcePath = arg.slice('--source='.length);
    } else if (arg === '--source') {
      parsed.sourcePath = args[++index];
    } else if (arg.startsWith('--storage-root=')) {
      parsed.storageRootDir = arg.slice('--storage-root='.length);
    } else if (arg === '--storage-root') {
      parsed.storageRootDir = args[++index];
    } else if (arg.startsWith('--report=')) {
      parsed.reportPath = arg.slice('--report='.length);
    } else if (arg === '--report') {
      parsed.reportPath = args[++index];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!['local-json', 'postgres'].includes(parsed.driver)) {
    throw new Error(`Unsupported attachment check driver: ${parsed.driver}`);
  }
  if (parsed.attachmentsOnly && (parsed.repair || parsed.driver !== 'local-json')) {
    throw new Error('--attachments-only 仅用于 local-json 的只读附件检查');
  }
  parsed.sourcePath = path.resolve(parsed.sourcePath);
  parsed.storageRootDir = path.resolve(parsed.storageRootDir);
  if (parsed.reportPath) parsed.reportPath = path.resolve(parsed.reportPath);
  return parsed;
}

function resolvePath(targetPath, rootDir) {
  return path.isAbsolute(targetPath) ? targetPath : path.resolve(rootDir, targetPath);
}

function writeReport(reportPath, report) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}
