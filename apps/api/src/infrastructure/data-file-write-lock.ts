import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createAppError } from '../errors/app-error.ts';

const busy = () =>
  createAppError('STORAGE_MAINTENANCE_BUSY', '资料库正在备份或清理，请稍后重试；当前修改尚未覆盖原文件。', 503);
const lockPath = (file: string) => `${file}.write-lock`;

/** 同步 JSON 写入和离线维护共用互斥锁；崩溃后的锁仅在原进程确定不存在时回收。 */
export function acquireDataFileWriteLock(file: string) {
  const target = lockPath(file);
  const token = randomUUID();
  const prepared = `${target}.${process.pid}-${token}.tmp`;
  // 先在独立文件中写完持有者，再以硬链接原子发布；公开锁不会出现空文件窗口。
  try {
    fs.writeFileSync(prepared, JSON.stringify({ token, pid: process.pid }), { flag: 'wx', mode: 0o600 });
    return publishLock();
  } finally {
    // 公开锁可能已取得；临时文件清理失败不能覆盖锁句柄或原始获取异常。
    try {
      fs.rmSync(prepared, { force: true });
    } catch (error) {
      console.warn('资料库写锁临时文件清理失败：', (error as NodeJS.ErrnoException).code);
    }
  }

  function publishLock() {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        fs.linkSync(prepared, target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        let reclaim: number | undefined;
        try {
          // 两个进程不能同时判死并回收同一个旧锁，否则可能误删对方新取得的锁。
          reclaim = fs.openSync(`${target}.reclaim`, 'wx', 0o600);
          const record = JSON.parse(fs.readFileSync(target, 'utf8'));
          if (!Number.isSafeInteger(record.pid) || record.pid < 1) throw busy();
          try {
            process.kill(record.pid, 0);
            throw busy();
          } catch (failure) {
            if ((failure as NodeJS.ErrnoException).code !== 'ESRCH') throw busy();
            fs.unlinkSync(target);
          }
        } catch {
          throw busy();
        } finally {
          if (reclaim !== undefined) {
            fs.closeSync(reclaim);
            fs.unlinkSync(`${target}.reclaim`);
          }
        }
        continue;
      }
      return {
        token,
        release() {
          if (JSON.parse(fs.readFileSync(target, 'utf8')).token !== token) throw busy();
          fs.unlinkSync(target);
        }
      };
    }
    throw busy();
  }
}

export function withDataFileWriteLock<Result>(
  file: string,
  token: string | null | undefined,
  operation: () => Result
): Result {
  if (token) {
    const current = JSON.parse(fs.readFileSync(lockPath(file), 'utf8'));
    if (current.token !== token || current.pid !== process.pid) throw busy();
    return operation();
  }
  const lock = acquireDataFileWriteLock(file);
  try {
    return operation();
  } finally {
    lock.release();
  }
}
