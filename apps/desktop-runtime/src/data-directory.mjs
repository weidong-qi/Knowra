import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function defaultDataDirectory({ platform = process.platform, home = os.homedir(), env = process.env } = {}) {
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Knowra', 'offline');
  if (platform === 'win32')
    return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Knowra', 'offline');
  return path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'knowra', 'offline');
}

/** 单个数据目录只允许一个运行服务；多窗口共享该服务。异常退出后按 PID 检查恢复。 */
export function lockDataDirectory(directory) {
  return acquireDataDirectoryLock(directory, false);
}

/** 救援准备阶段取得两层锁，检查结束后才同时释放，旧版失败启动也不能改源根目录。 */
export function lockDataDirectoryForRecovery(directory) {
  return acquireDataDirectoryLock(directory, true);
}

function acquireDataDirectoryLock(directory, retainStartupGate) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const startupGate = path.join(directory, 'startup.lock');
  try {
    fs.mkdirSync(startupGate, { mode: 0o700 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw new Error('本地资料库正在启动或上次启动中断，请检查 startup.lock，禁止并发恢复实例锁。', { cause: error });
  }
  const gate = fs.lstatSync(startupGate);
  const removeGate = () => {
    const current = fs.lstatSync(startupGate);
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== gate.dev || current.ino !== gate.ino)
      throw new Error('启动协调锁已被替换，已保留现场，请检查 startup.lock。');
    fs.rmdirSync(startupGate);
  };
  let release;
  try {
    release = acquireRuntimeLock(directory);
  } catch (error) {
    removeGate();
    throw error;
  }
  if (!retainStartupGate) {
    removeGate();
    return release;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      release();
    } finally {
      removeGate();
    }
  };
}

function acquireRuntimeLock(directory) {
  const lockPath = path.join(directory, 'runtime.lock');
  const token = randomUUID();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, 'wx', 0o600);
      const identity = fs.fstatSync(fd);
      try {
        fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token }));
        fs.fsyncSync(fd);
      } catch (error) {
        const current = fs.lstatSync(lockPath);
        if (
          current.isFile() &&
          !current.isSymbolicLink() &&
          current.nlink === 1 &&
          current.dev === identity.dev &&
          current.ino === identity.ino
        )
          fs.unlinkSync(lockPath);
        throw error;
      } finally {
        fs.closeSync(fd);
      }
      return () => {
        try {
          const current = fs.lstatSync(lockPath);
          if (
            !current.isFile() ||
            current.isSymbolicLink() ||
            current.nlink !== 1 ||
            current.dev !== identity.dev ||
            current.ino !== identity.ino
          )
            throw new Error('运行协调锁已被替换，已保留现场，请检查 runtime.lock。');
          if (JSON.parse(fs.readFileSync(lockPath, 'utf8')).token === token) fs.unlinkSync(lockPath);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let owner, previous;
      try {
        previous = fs.lstatSync(lockPath);
        if (!previous.isFile() || previous.isSymbolicLink() || previous.nlink !== 1)
          throw new Error('invalid lock', { cause: error });
        owner = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      } catch (readError) {
        throw new Error('本地数据目录锁无法验证，请保留数据并检查 runtime.lock。', { cause: readError });
      }
      if (!Number.isInteger(owner.pid) || owner.pid <= 0)
        throw new Error('本地数据目录锁无效，已停止启动。', { cause: error });
      try {
        process.kill(owner.pid, 0);
      } catch (probeError) {
        if (probeError.code === 'ESRCH') {
          // 对比原记录，避免删除已被其他启动进程替换的锁。
          const current = fs.lstatSync(lockPath);
          if (
            current.isFile() &&
            !current.isSymbolicLink() &&
            current.nlink === 1 &&
            current.dev === previous.dev &&
            current.ino === previous.ino &&
            fs.readFileSync(lockPath, 'utf8') === JSON.stringify(owner)
          )
            fs.unlinkSync(lockPath);
          continue;
        }
      }
      throw new Error('此本地数据目录已被使用，请使用已打开的实例。', { cause: error });
    }
  }
  throw new Error('无法取得本地数据目录锁，请重试。');
}
