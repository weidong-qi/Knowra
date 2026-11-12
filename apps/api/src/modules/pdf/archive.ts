import type { Writable } from 'node:stream';
import type { PdfArchiveOptions, PdfSnapshot, PdfState, BinaryStream } from './contracts.ts';
interface StagedEntry {
  file: string;
  size: number;
  sha256: string;
  complete: boolean;
  fd: number | null;
}
interface PendingArchive {
  directory: string;
  snapshot: PdfSnapshot;
  entries: Map<string, StagedEntry>;
  expires: number;
  baseline: string;
  operationId: string;
}
interface ArchiveManifest {
  format: string;
  snapshotSha256: string;
  files: Array<{ id: string; sha256: string; size: number }>;
}
interface LegacySnapshot extends PdfSnapshot {
  attachmentFiles?: Array<{ id: string; contentBase64: string }>;
}
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { once } from 'node:events';
import { Zip, ZipPassThrough, Unzip, strToU8, zipSync } from 'fflate';
import { MAX_PDF_BYTES } from '@study-accelerator/shared/pdf';
import {
  validateLocalSnapshot,
  LOCAL_SNAPSHOT_VERSION,
  LOCAL_DATA_SCHEMA_VERSION
} from '../../infrastructure/local-data-schema.ts';
import { createAttachmentDirectorySwap } from '../../infrastructure/attachment-directory-swap.ts';
import { assertSpacesOwnedBy } from '../../infrastructure/owner-boundary.ts';
import { assertNoInsecureImageUrls } from '../knowledge/application/note-content-policy.ts';
import { pdfError } from './files.ts';

function readSnapshot(input: unknown): PdfSnapshot {
  const validated: unknown = validateLocalSnapshot(input);
  return validated as PdfSnapshot;
}
const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export function createPdfArchive({
  dataStore,
  db,
  postgres,
  files,
  ownerId,
  storageRootDir,
  maintenanceGate = null,
  beforeImport = async () => {}
}: PdfArchiveOptions) {
  const pending = new Map<string, PendingArchive>();
  // 客户端在拿到 token 前放弃的预检操作：晚到的检查结果直接丢弃，避免占用待确认名额。
  const abandoned = new Map<string, number>();
  const uploadsDir = files.fileManager.getManagedUploadsDirectory();
  const exportsDir = path.resolve(storageRootDir, process.env.STORAGE_EXPORTS_DIR || 'storage/exports');
  const tempRoot = path.resolve(storageRootDir, process.env.STORAGE_TEMP_DIR || 'storage/temp');
  const gate = maintenanceGate ?? { runMaintenance: <T>(task: () => Promise<T>) => task() };
  async function snapshot(): Promise<PdfSnapshot> {
    return dataStore
      ? dataStore.exportSnapshot()
      : {
          version: LOCAL_SNAPSHOT_VERSION,
          schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
          data: (await db!.$transaction(tx => postgres!.readSnapshot(tx))) as PdfState
        };
  }
  function cleanup() {
    for (const [id, expires] of abandoned) if (expires < Date.now()) abandoned.delete(id);
    for (const [id, item] of pending)
      if (item.expires < Date.now()) {
        fs.rmSync(item.directory, { recursive: true, force: true });
        pending.delete(id);
      }
  }
  async function writeArchive(output: Writable) {
    const current = await snapshot();
    const metadata = Buffer.from(JSON.stringify(current));
    const byteBudget = metadata.length + current.data.attachments.reduce((sum, file) => sum + file.size + 1024, 0);
    if (metadata.length > 64 * 1024 * 1024 || current.data.attachments.length > 65533 || byteBudget > 0xffff0000)
      throw pdfError('ARCHIVE_TOO_LARGE', '资料包超过 ZIP 首版支持的容量，请使用 Mac 完整目录备份。', 413);
    const manifest = {
      format: 'knowra-archive-v1',
      snapshotSha256: digest(metadata),
      files: current.data.attachments.map(item => ({ id: item.id, sha256: item.sha256, size: item.size }))
    };
    let outputError: Error | undefined;
    output.on('error', (error: Error) => {
      outputError = error;
    });
    const zip = new Zip((error, chunk, final) => {
      if (error) {
        outputError = error;
        return;
      }
      if (!output.destroyed) {
        output.write(chunk);
        if (final) output.end();
      }
    });
    async function push(entry: ZipPassThrough, chunk: Uint8Array, final = false) {
      if (outputError || output.destroyed) throw outputError ?? new Error('备份传输中断');
      entry.push(chunk, final);
      if (output.writableNeedDrain) await once(output, 'drain');
    }
    /** @type {Array<[string, Uint8Array]>} */
    const metadataEntries: Array<[string, Uint8Array]> = [
      ['manifest.json', strToU8(JSON.stringify(manifest))],
      ['snapshot.json', metadata]
    ];
    try {
      for (const [name, bytes] of metadataEntries) {
        const entry = new ZipPassThrough(name);
        zip.add(entry);
        await push(entry, bytes, true);
      }
      for (const attachment of current.data.attachments) {
        const source = await files.inspect(attachment);
        const entry = new ZipPassThrough(`files/${attachment.id}.bin`);
        zip.add(entry);
        const hash = createHash('sha256');
        let size = 0;
        for await (const chunk of fs.createReadStream(source)) {
          hash.update(chunk);
          size += chunk.length;
          await push(entry, chunk);
        }
        if (size !== attachment.size || hash.digest('hex') !== attachment.sha256)
          throw pdfError('ARCHIVE_FILE_CHANGED', '备份期间原文件发生变化，未生成完整备份。', 409);
        await push(entry, new Uint8Array(), true);
      }
      const next = await snapshot();
      // exportedAt 不属于业务事实。
      if (digest(JSON.stringify(current.data)) !== digest(JSON.stringify(next.data)))
        throw pdfError('ARCHIVE_CHANGED', '备份期间资料发生变化，请重试。', 409);
      zip.end();
      if (!output.writableFinished) await once(output, 'finish');
    } catch (error) {
      zip.terminate();
      output.destroy(error instanceof Error ? error : undefined);
      throw error;
    }
  }
  async function inspect(stream: BinaryStream, operationId = '') {
    cleanup();
    if (pending.size >= 3) throw pdfError('ARCHIVE_BUSY', '已有待确认的导入，请完成或稍后重试。', 409);
    fs.mkdirSync(tempRoot, { recursive: true, mode: 0o700 });
    const directory = fs.mkdtempSync(path.join(tempRoot, 'pdf-archive-'));
    let archiveSize = 0,
      tail = Buffer.alloc(0);
    const entries = new Map<string, StagedEntry>();
    let failure: Error | undefined;
    let count = 0;
    const unzip = new Unzip(entry => {
      if (
        ++count > 65535 ||
        !/^(manifest\.json|snapshot\.json|files\/[A-Za-z0-9._-]{1,200}\.bin)$/.test(entry.name) ||
        entries.has(entry.name)
      ) {
        failure = pdfError('ARCHIVE_INVALID', '备份包含重复或无效文件。');
        return;
      }
      const file = path.join(directory, String(count));
      const fd = fs.openSync(file, 'wx', 0o600);
      const info: StagedEntry = { file, size: 0, sha256: '', complete: false, fd };
      entries.set(entry.name, info);
      const hash = createHash('sha256');
      entry.ondata = (error, chunk, final) => {
        if (failure) return;
        if (error) {
          failure = error;
          return;
        }
        info.size += chunk.length;
        const limit =
          entry.name === 'snapshot.json'
            ? 64 * 1024 * 1024
            : entry.name === 'manifest.json'
              ? 8 * 1024 * 1024
              : MAX_PDF_BYTES;
        if (info.size > limit) {
          failure = pdfError('ARCHIVE_TOO_LARGE', '备份中的单个文件超过支持的大小。', 413);
          return;
        }
        fs.writeFileSync(fd, chunk);
        hash.update(chunk);
        if (final) {
          fs.fsyncSync(fd);
          fs.closeSync(fd);
          info.fd = null;
          info.sha256 = hash.digest('hex');
          info.complete = true;
        }
      };
      // 只接受本应用导出的无压缩 ZIP，避免不受控解压膨胀。
      if (entry.compression !== 0) {
        failure = pdfError('ARCHIVE_INVALID', '请使用 Knowra 导出的完整备份包。');
        return;
      }
      entry.start();
    });
    try {
      for await (const rawChunk of stream) {
        const chunk = Buffer.from(rawChunk);
        archiveSize += chunk.length;
        if (archiveSize > 0xffff0000) throw pdfError('ARCHIVE_TOO_LARGE', '资料包超过 ZIP 首版支持的容量。', 413);
        tail = Buffer.concat([tail, chunk]).subarray(-22);
        unzip.push(chunk);
        if (failure) throw failure;
      }
      if (
        tail.length !== 22 ||
        tail.readUInt32LE(0) !== 0x06054b50 ||
        tail.readUInt16LE(20) !== 0 ||
        tail.readUInt16LE(10) !== count ||
        tail.readUInt32LE(12) + tail.readUInt32LE(16) !== archiveSize - 22
      )
        throw pdfError('ARCHIVE_INCOMPLETE', '备份包未完整传输或格式不受支持。');
      unzip.push(new Uint8Array(), true);
      if (failure) throw failure;
      if (
        [...entries.values()].some(item => !item.complete) ||
        !entries.has('manifest.json') ||
        !entries.has('snapshot.json')
      )
        throw pdfError('ARCHIVE_INVALID', '备份包不完整。');
      const manifest = JSON.parse(fs.readFileSync(entries.get('manifest.json')!.file, 'utf8')) as ArchiveManifest;
      const raw = JSON.parse(fs.readFileSync(entries.get('snapshot.json')!.file, 'utf8')) as PdfSnapshot;
      if (
        manifest.format !== 'knowra-archive-v1' ||
        manifest.snapshotSha256 !== entries.get('snapshot.json')!.sha256 ||
        !Array.isArray(manifest.files)
      )
        throw pdfError('ARCHIVE_INVALID', '备份清单校验失败。');
      const current = readSnapshot(raw);
      assertSpacesOwnedBy(current.data.spaces, ownerId);
      current.data.notes.forEach(note => assertNoInsecureImageUrls(note.rawMarkdown));
      if (
        entries.size !== current.data.attachments.length + 2 ||
        manifest.files.length !== current.data.attachments.length
      )
        throw pdfError('ARCHIVE_INVALID', '备份文件清单与资料不一致。');
      for (const attachment of current.data.attachments) {
        const file = entries.get(`files/${attachment.id}.bin`),
          declared = manifest.files.find(item => item.id === attachment.id);
        const limit = attachment.mimeType === 'application/pdf' ? MAX_PDF_BYTES : 6 * 1024 * 1024;
        if (
          !file ||
          !declared ||
          file.sha256 !== attachment.sha256 ||
          file.size !== attachment.size ||
          file.size > limit ||
          declared.sha256 !== file.sha256 ||
          declared.size !== file.size
        )
          throw pdfError('ARCHIVE_INVALID', '备份原文件大小或哈希不匹配。');
      }
      const token = randomUUID();
      const baseline = digest(JSON.stringify((await snapshot()).data));
      if (operationId && abandoned.has(operationId)) throw pdfError('ARCHIVE_CANCELLED', '备份检查已取消。', 409);
      pending.set(token, {
        directory,
        snapshot: { ...raw, ...current },
        entries,
        expires: Date.now() + 10 * 60 * 1000,
        baseline,
        operationId
      });
      return {
        token,
        notes: current.data.notes.length,
        pdfs: current.data.notes.filter(note => note.contentKind === 'pdf').length,
        annotations: current.data.pdfAnnotations.length,
        attachments: current.data.attachments.length
      };
    } catch (error) {
      for (const item of entries.values()) if (item.fd !== null) fs.closeSync(item.fd);
      fs.rmSync(directory, { recursive: true, force: true });
      throw error;
    }
  }
  async function restore(token: string) {
    cleanup();
    const item = pending.get(token);
    if (!item) throw pdfError('ARCHIVE_EXPIRED', '导入预览已失效，请重新选择备份。', 409);
    if (digest(JSON.stringify((await snapshot()).data)) !== item.baseline)
      throw pdfError('ARCHIVE_CHANGED', '当前资料已变化，请重新检查备份后恢复。', 409);
    fs.mkdirSync(exportsDir, { recursive: true, mode: 0o700 });
    const backupId = `before-restore-${randomUUID()}`;
    const backupPath = path.join(exportsDir, `${backupId}.zip`);
    await writeArchive(fs.createWriteStream(`${backupPath}.tmp`, { flags: 'wx', mode: 0o600 }));
    fs.renameSync(`${backupPath}.tmp`, backupPath);
    const staging = fs.mkdtempSync(path.join(path.dirname(uploadsDir), '.pdf-archive-import-'));
    const records = item.snapshot.data.attachments.map(attachment => ({
      ...attachment,
      status: 'ready' as const,
      verifiedAt: new Date().toISOString(),
      storagePath: files.fileManager.buildStoragePath(attachment.id, attachment.fileName)
    }));
    const transaction = createAttachmentDirectorySwap({
      uploadsDirectory: uploadsDir,
      stagingDirectory: staging,
      records
    });
    try {
      // 普通资料快照不接管 AI 私有文件等独立目录。
      for (const entry of fs.readdirSync(uploadsDir, { withFileTypes: true }))
        if (entry.isDirectory() && !entry.name.startsWith('.'))
          fs.cpSync(path.join(uploadsDir, entry.name), path.join(staging, entry.name), {
            recursive: true,
            dereference: false
          });
      for (const attachment of records) {
        const basename = path.basename(
          files.fileManager.resolveManagedAbsolutePath(attachment.id, attachment.fileName)
        );
        fs.copyFileSync(item.entries.get(`files/${attachment.id}.bin`)!.file, path.join(staging, basename));
      }
      const imported = { ...item.snapshot, data: { ...item.snapshot.data, attachments: records } };
      const prepared = dataStore?.prepareImport(imported);
      await beforeImport();
      if (digest(JSON.stringify((await snapshot()).data)) !== item.baseline)
        throw pdfError('ARCHIVE_CHANGED', '资料已变化，请重新检查备份后恢复。', 409);
      transaction.commit();
      if (dataStore) dataStore.commitImport(prepared!);
      else {
        const migration = postgres!.buildMigrationPlan({
          input: imported,
          storageRootDir,
          uploadsDir,
          allowMissingAttachments: false,
          ownerId
        });
        if (!migration.canApply) throw pdfError('ARCHIVE_INVALID', '备份数据库预检未通过。');
        await postgres!.applyMigration({
          plan: migration.plan,
          report: migration.report,
          requireEmptyTarget: false,
          replaceExisting: true
        });
      }
      transaction.finalize();
      pending.delete(token);
      fs.rmSync(item.directory, { recursive: true, force: true });
      return { restored: true, backupId };
    } catch (error) {
      transaction.rollback();
      throw error;
    }
  }
  async function inspectLegacy(value: unknown, operationId = '') {
    const input = value as LegacySnapshot;
    const validated = readSnapshot(input);
    const entries: Record<string, Uint8Array> = {},
      byId = new Map((input.attachmentFiles ?? []).map(file => [file.id, file]));
    for (const attachment of validated.data.attachments) {
      const item = byId.get(attachment.id);
      if (!item || typeof item.contentBase64 !== 'string') throw pdfError('ARCHIVE_INVALID', '旧版快照缺少原附件。');
      const bytes = Buffer.from(item.contentBase64, 'base64');
      if (bytes.length !== attachment.size || (attachment.sha256 && digest(bytes) !== attachment.sha256))
        throw pdfError('ARCHIVE_INVALID', '旧版快照原文件校验失败。');
      attachment.sha256 = digest(bytes);
      entries[`files/${attachment.id}.bin`] = bytes;
    }
    const snapshotBytes = strToU8(JSON.stringify({ version: LOCAL_SNAPSHOT_VERSION, ...validated }));
    const manifest = {
      format: 'knowra-archive-v1',
      snapshotSha256: digest(snapshotBytes),
      files: validated.data.attachments.map(item => ({ id: item.id, size: item.size, sha256: item.sha256 }))
    };
    entries['snapshot.json'] = snapshotBytes;
    entries['manifest.json'] = strToU8(JSON.stringify(manifest));
    return inspect(Readable.from([zipSync(entries, { level: 0 })]), operationId);
  }
  return {
    inspectLegacy,
    cancelOperation(operationId: string) {
      if (!operationId) return;
      abandoned.set(operationId, Date.now() + 10 * 60 * 1000);
      for (const [token, item] of pending)
        if (item.operationId === operationId) {
          fs.rmSync(item.directory, { recursive: true, force: true });
          pending.delete(token);
        }
    },
    cancel(token: string) {
      const item = pending.get(token);
      if (item) fs.rmSync(item.directory, { recursive: true, force: true });
      pending.delete(token);
    },
    export: (output: Writable) => gate.runMaintenance(() => writeArchive(output)),
    inspect,
    restore: (token: string) => gate.runMaintenance(() => restore(token)),
    backupFile(id: string) {
      if (!/^before-restore-[a-f0-9-]{36}$/.test(id)) throw pdfError('ARCHIVE_NOT_FOUND', '保护备份不存在。', 404);
      const file = path.join(exportsDir, `${id}.zip`);
      if (!fs.existsSync(file)) throw pdfError('ARCHIVE_NOT_FOUND', '保护备份不存在。', 404);
      return file;
    }
  };
}
