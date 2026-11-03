import type { AttachmentFileManager, LocalAttachmentRecord } from '../../infrastructure/local-attachment-types.ts';
import type { BinaryStream } from './contracts.ts';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { MAX_PDF_BYTES } from '@study-accelerator/shared/pdf';
import { createAppError } from '../../errors/app-error.ts';

export const pdfError = (code: string, message: string, status = 422) => createAppError(code, message, status);
export async function stagePdf(stream: BinaryStream, directory: string) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `.pdf-upload-${randomUUID()}.tmp`);
  const fd = fs.openSync(file, 'wx', 0o600);
  const hash = createHash('sha256');
  let size = 0,
    signature = Buffer.alloc(0);
  try {
    for await (const raw of stream) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      size += chunk.length;
      if (size > MAX_PDF_BYTES) throw pdfError('PDF_TOO_LARGE', 'PDF 不能超过 50 MiB。', 413);
      if (signature.length < 1024) signature = Buffer.concat([signature, chunk.subarray(0, 1024 - signature.length)]);
      fs.writeFileSync(fd, chunk);
      hash.update(chunk);
    }
    if (!size || !signature.includes(Buffer.from('%PDF-')))
      throw pdfError('PDF_FORMAT_INVALID', '文件不是可识别的 PDF。');
    fs.fsyncSync(fd);
    return { file, size, sha256: hash.digest('hex') };
  } catch (error) {
    fs.rmSync(file, { force: true });
    throw error;
  } finally {
    fs.closeSync(fd);
  }
}

export function parseByteRange(header: string | null | undefined, size: number) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) throw pdfError('RANGE_INVALID', '文件读取范围无效。', 416);
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] ? (match[2] ? Math.min(size - 1, Number(match[2])) : size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size)
    throw pdfError('RANGE_INVALID', '文件读取范围超出大小。', 416);
  return { start, end };
}

export function createPdfFiles(fileManager: AttachmentFileManager) {
  const verified = new Map<string, string>();
  const directory = fileManager.getManagedUploadsDirectory();
  for (const name of fs.readdirSync(directory))
    if (/^\.pdf-upload-[a-f0-9-]{36}\.tmp$/.test(name)) {
      const file = path.join(directory, name),
        stat = fs.lstatSync(file);
      if (stat.isFile() && !stat.isSymbolicLink() && Date.now() - stat.mtimeMs > 3600000) fs.rmSync(file);
    }
  async function inspect(attachment: LocalAttachmentRecord) {
    const file = fileManager.resolveReadableAttachmentPath(attachment);
    if (!file) throw pdfError('ATTACHMENT_MISSING', 'PDF 原文件缺失，请恢复原文件。', 409);
    const stat = fs.statSync(file, { bigint: true });
    const key = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
    if (!stat.isFile() || stat.size !== BigInt(attachment.size))
      throw pdfError('ATTACHMENT_CORRUPT', 'PDF 原文件大小不匹配。', 409);
    if (verified.get(attachment.id) !== `${key}:${attachment.sha256}`) {
      const hash = createHash('sha256');
      for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
      if (hash.digest('hex') !== attachment.sha256) throw pdfError('ATTACHMENT_CORRUPT', 'PDF 原文件校验失败。', 409);
      if (verified.size > 100) verified.clear();
      verified.set(attachment.id, `${key}:${attachment.sha256}`);
    }
    return file;
  }
  return { inspect, fileManager };
}
