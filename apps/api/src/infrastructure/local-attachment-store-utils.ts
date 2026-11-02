import fs from 'node:fs';
import fsp from 'node:fs/promises';
import crypto, { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { BinaryLike } from 'node:crypto';
import type { PathLike } from 'node:fs';
import type { AttachmentOperationError } from './local-attachment-types.ts';

export function ensureDirectory(directoryPath: string) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

export function sanitizeFileName(fileName: unknown) {
  return (
    String(fileName ?? 'attachment.bin')
      .replace(/(?:[/\\?%*:|"<>]|[^\x20-\x7e\u0080-\uffff])+/g, '-')
      .replace(/\s+/g, ' ')
      .replace(/-+/g, '-')
      .replace(/^[.\s-]+|[.\s-]+$/g, '') || 'attachment.bin'
  );
}

export function createAttachmentId() {
  return `attachment-${randomUUID()}`;
}

export function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function sha256Buffer(value: BinaryLike) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function sha256FileSync(filePath: PathLike) {
  return sha256Buffer(fs.readFileSync(filePath));
}

export function writeFileAtomically(filePath: string, content: string | Uint8Array) {
  ensureDirectory(path.dirname(filePath));
  const temporaryPath = `${filePath}.tmp-${randomUUID()}`;
  let operationError: AttachmentOperationError | null = null;

  try {
    const descriptor = fs.openSync(temporaryPath, 'wx', 0o600);
    try {
      fs.writeFileSync(descriptor, content);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    operationError = error as AttachmentOperationError;
    throw error;
  } finally {
    removeTemporaryFile(temporaryPath, operationError);
  }
}

export async function writeFileAtomicallyAsync(filePath: string, content: string | Uint8Array) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${randomUUID()}`;
  let operationError: AttachmentOperationError | null = null;

  try {
    const handle = await fsp.open(temporaryPath, 'wx', 0o600);
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fsp.rename(temporaryPath, filePath);
  } catch (error) {
    operationError = error as AttachmentOperationError;
    throw error;
  } finally {
    await removeTemporaryFileAsync(temporaryPath, operationError);
  }
}

export function toPortablePath(targetPath: string | null | undefined) {
  return String(targetPath ?? '')
    .replaceAll('\\', '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '')
    .trim();
}

export function joinPortablePath(...segments: (string | null | undefined)[]) {
  return segments
    .map(segment => toPortablePath(segment))
    .filter(Boolean)
    .join('/');
}

export function looksWindowsAbsolute(targetPath: string | null | undefined) {
  return /^[A-Za-z]:[\\/]/.test(String(targetPath ?? ''));
}

export function looksPosixAbsolute(targetPath: string | null | undefined) {
  return String(targetPath ?? '').startsWith('/');
}

export function uniquePaths(paths: string[]) {
  return [...new Set(paths.filter(Boolean).map(value => path.normalize(value)))];
}

export function scheduleFileCleanup(storagePath: string | null | undefined, remainingAttempts = 5) {
  if (!storagePath || remainingAttempts <= 0) {
    return;
  }

  setTimeout(() => {
    try {
      if (fs.existsSync(storagePath)) {
        fs.rmSync(storagePath, { force: true, maxRetries: 5, retryDelay: 50 });
      }
    } catch (error) {
      console.error(
        'scheduleFileCleanup: rmSync failed, scheduling retry:',
        (error as AttachmentOperationError)?.message
      );
      scheduleFileCleanup(storagePath, remainingAttempts - 1);
    }
  }, 150);
}

export function moveFileSafely(sourcePath: string | null | undefined, targetPath: string | null | undefined) {
  if (!sourcePath || !targetPath || path.normalize(sourcePath) === path.normalize(targetPath)) {
    return;
  }

  ensureDirectory(path.dirname(targetPath));
  try {
    fs.renameSync(sourcePath, targetPath);
  } catch (error) {
    console.error('renameSync failed, falling back to copy+delete:', (error as AttachmentOperationError)?.message);
    fs.copyFileSync(sourcePath, targetPath);
    fs.rmSync(sourcePath, { force: true, maxRetries: 5, retryDelay: 50 });
  }
}

function removeTemporaryFile(filePath: string, operationError: AttachmentOperationError | null) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  try {
    fs.rmSync(filePath, { force: true });
  } catch (cleanupError) {
    if (operationError) {
      operationError.cleanupError = cleanupError as Error;
      return;
    }
    throw cleanupError;
  }
}

async function removeTemporaryFileAsync(filePath: string, operationError: AttachmentOperationError | null) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  try {
    await fsp.rm(filePath, { force: true });
  } catch (cleanupError) {
    if (operationError) {
      operationError.cleanupError = cleanupError as Error;
      return;
    }
    throw cleanupError;
  }
}
