import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { jsonChunks } from './json-chunks.ts';

/** 最小公开注入端口：函数属性保持 descriptor 的生产/消费关联，忽略的结果不作保证。 */
export interface FilePort<D> {
  mkdirSync: (path: string, options: { recursive: true }) => unknown;
  openSync: (path: string, flags: 'wx', mode: number) => D;
  writeFileSync: (descriptor: D, data: string, encoding: 'utf8') => unknown;
  fsyncSync: (descriptor: D) => unknown;
  closeSync: (descriptor: D) => unknown;
  renameSync: (from: string, to: string) => unknown;
  existsSync: (path: string) => unknown;
  rmSync: (path: string, options: { force: true; maxRetries: number; retryDelay: number }) => unknown;
}
// 原回调均为 ESM 裸调用，this 实际为 undefined；返回值保留原生转换和 guard 行为。
export type Hooks = {
  createUniqueId?: ((this: undefined) => unknown) | undefined;
  beforeCommit?: ((this: undefined) => unknown) | null | undefined;
};
export type Options<D> = Hooks & { fileSystem?: FilePort<D> | undefined };

/**
 * 私有存在类型擦除。方法双变性只在实现内容纳已由公开函数属性端口关联的 D。
 * 这里不证明 descriptor 的关联；原算法把同一 fileSystem.openSync 的返回值原样
 * 传给该对象的 write/fsync/close，不转换或替换。不得导出此视图作为注入合同。
 */
interface Operations {
  mkdirSync(path: string, options: { recursive: true }): unknown;
  openSync(path: string, flags: 'wx', mode: number): unknown;
  writeFileSync(descriptor: unknown, data: string, encoding: 'utf8'): unknown;
  fsyncSync(descriptor: unknown): unknown;
  closeSync(descriptor: unknown): unknown;
  renameSync(from: string, to: string): unknown;
  existsSync(path: string): unknown;
  rmSync(path: string, options: { force: true; maxRetries: number; retryDelay: number }): unknown;
}
// 仅描述原属性操作，不验证对象/可写性；getter、primitive 和原生抛错仍保留。
type ReadProperties = { code?: unknown; restoreError?: unknown; message?: unknown; then?: unknown } | null | undefined;
// 只在 string | undefined 域内描述成功的 length 读取；undefined 仍在原位置抛错。
type LengthRead = { readonly length: number };
// 第一处成功 length 读取支配直接写入，且 const chunk 不变，因此到达时实际为 string。
// 此独立调用视图不缩窄 chunk，也不声称公开 writeFileSync 接受 undefined。
type ReachableStringWrite = { writeFileSync(descriptor: unknown, data: string | undefined, encoding: 'utf8'): unknown };

const WINDOWS_REPLACE_ERROR_CODES = new Set<unknown>(['EACCES', 'EEXIST', 'EPERM']);

export function writeJsonFileAtomically(filePath: string, value: unknown, options?: Options<number>): void;
export function writeJsonFileAtomically<D>(
  filePath: string,
  value: unknown,
  options: Hooks & { fileSystem: FilePort<D> }
): void;
export function writeJsonFileAtomically(
  filePath: string,
  value: unknown,
  { fileSystem = fs, createUniqueId = randomUUID, beforeCommit }: Hooks & { fileSystem?: Operations | undefined } = {}
): void {
  const directoryPath = path.dirname(filePath);
  const baseName = path.basename(filePath);
  const uniqueId = `${process.pid}-${(createUniqueId as () => unknown)()}`;
  const temporaryPath = path.join(directoryPath, `.${baseName}.${uniqueId}.tmp`);
  const backupPath = path.join(directoryPath, `.${baseName}.${uniqueId}.bak`);
  let preserveBackup = false;

  fileSystem.mkdirSync(directoryPath, { recursive: true });
  try {
    writeAndSyncTemporaryFile(fileSystem, temporaryPath, value);
    replaceTarget(fileSystem, temporaryPath, filePath, backupPath, () => {
      const result = (beforeCommit as (() => unknown) | null | undefined)?.();
      if (result === false) throw new Error('Atomic JSON commit guard rejected');
      if ((result as ReadProperties)?.then) throw new TypeError('Atomic JSON commit guard must be synchronous');
    });
  } catch (error) {
    preserveBackup = Boolean((error as ReadProperties)?.restoreError);
    throw error;
  } finally {
    tryRemove(fileSystem, temporaryPath);
    if (!preserveBackup) {
      tryRemove(fileSystem, backupPath);
    }
  }
}

function writeAndSyncTemporaryFile(fileSystem: Operations, temporaryPath: string, value: unknown): void {
  const descriptor = fileSystem.openSync(temporaryPath, 'wx', 0o600);

  try {
    let buffer = '',
      wrote = false;
    for (const chunk of jsonChunks(value)) {
      wrote = true;
      if (buffer.length + (chunk as LengthRead).length > 64 * 1024) {
        if (buffer) fileSystem.writeFileSync(descriptor, buffer, 'utf8');
        buffer = '';
        if ((chunk as LengthRead).length > 64 * 1024) {
          (fileSystem as ReachableStringWrite).writeFileSync(descriptor, chunk, 'utf8');
          continue;
        }
      }
      buffer += chunk;
    }
    if (!wrote) throw new TypeError('JSON root must be serializable');
    if (buffer) fileSystem.writeFileSync(descriptor, buffer, 'utf8');
    fileSystem.fsyncSync(descriptor);
  } finally {
    fileSystem.closeSync(descriptor);
  }
}

function replaceTarget(
  fileSystem: Operations,
  temporaryPath: string,
  filePath: string,
  backupPath: string,
  beforeCommit: () => unknown
): void {
  try {
    beforeCommit();
    fileSystem.renameSync(temporaryPath, filePath);
    return;
  } catch (error) {
    if (!fileSystem.existsSync(filePath) || !WINDOWS_REPLACE_ERROR_CODES.has((error as ReadProperties)?.code)) {
      throw error;
    }
  }

  beforeCommit();
  fileSystem.renameSync(filePath, backupPath);
  try {
    beforeCommit();
    fileSystem.renameSync(temporaryPath, filePath);
  } catch (error) {
    restoreBackup(fileSystem, backupPath, filePath, error);
    throw error;
  }
}

function restoreBackup(fileSystem: Operations, backupPath: string, filePath: string, originalError: unknown): void {
  try {
    removeIfPresent(fileSystem, filePath);
    fileSystem.renameSync(backupPath, filePath);
  } catch (restoreError) {
    (originalError as { restoreError: unknown }).restoreError = restoreError;
  }
}

function removeIfPresent(fileSystem: Operations, targetPath: string): void {
  if (!fileSystem.existsSync(targetPath)) {
    return;
  }

  fileSystem.rmSync(targetPath, {
    force: true,
    maxRetries: 5,
    retryDelay: 50
  });
}

function tryRemove(fileSystem: Operations, targetPath: string): void {
  try {
    removeIfPresent(fileSystem, targetPath);
  } catch (error) {
    console.error(`Atomic JSON cleanup failed for ${path.basename(targetPath)}:`, (error as ReadProperties)?.message);
  }
}
