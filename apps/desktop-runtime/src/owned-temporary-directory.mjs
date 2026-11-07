import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { captureBackupDirectory } from './backup-transfer-files.mjs';

const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
const changed = () => new Error('私有临时目录或文件已变化，已保留现场，禁止清理替换物。');

/** 只清理本次独占创建并登记的普通文件；遇到替换或未知条目时保留整个目录。 */
export function createOwnedTemporaryDirectory(prefix, directory = os.tmpdir(), { outside } = {}) {
  const parent = captureBackupDirectory(directory);
  parent.check();
  if (outside) {
    const source = fs.statSync(outside);
    for (let candidate = parent.directory; ; candidate = path.dirname(candidate)) {
      if (same(source, fs.statSync(candidate))) throw new Error('私有临时目录必须位于来源目录之外。');
      if (candidate === path.dirname(candidate)) break;
    }
  }
  const root = fs.mkdtempSync(path.join(parent.directory, prefix));
  const identity = fs.lstatSync(root);
  const files = new Map();
  const checkDirectory = () => {
    parent.check();
    const stat = fs.lstatSync(root);
    if (!same(identity, stat) || !stat.isDirectory() || stat.isSymbolicLink()) throw changed();
  };
  const requireOwnedFile = (name, stat) => {
    if (!files.has(name) || !same(files.get(name), stat) || !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
      throw changed();
  };
  const check = () => {
    checkDirectory();
    for (const name of files.keys()) requireOwnedFile(name, fs.lstatSync(path.join(root, name)));
  };
  const record = (name, stat = fs.lstatSync(path.join(root, name))) => {
    checkDirectory();
    if (path.basename(name) !== name || !stat.isFile() || stat.nlink !== 1 || stat.isSymbolicLink()) throw changed();
    const current = fs.lstatSync(path.join(root, name));
    if (!same(stat, current) || !current.isFile() || current.nlink !== 1 || current.isSymbolicLink()) throw changed();
    if (files.has(name) && !same(files.get(name), stat)) throw changed();
    files.set(name, stat);
  };
  const read = name => {
    check();
    const file = path.join(root, name);
    const expected = fs.lstatSync(file, { bigint: true });
    const fd = fs.openSync(
      file,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0)
    );
    const stable = stat =>
      stat.isFile() &&
      stat.nlink === 1n &&
      ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(key => expected[key] === stat[key]);
    try {
      requireOwnedFile(name, fs.fstatSync(fd));
      if (!stable(fs.fstatSync(fd, { bigint: true }))) throw changed();
      const bytes = fs.readFileSync(fd);
      if (!stable(fs.fstatSync(fd, { bigint: true })) || !stable(fs.lstatSync(file, { bigint: true }))) throw changed();
      check();
      return bytes;
    } finally {
      fs.closeSync(fd);
    }
  };
  const cleanup = () => {
    try {
      checkDirectory();
      const names = fs.readdirSync(root);
      for (const name of names) {
        const stat = fs.lstatSync(path.join(root, name));
        if (
          !files.has(name) ||
          !same(files.get(name), stat) ||
          !stat.isFile() ||
          stat.isSymbolicLink() ||
          stat.nlink !== 1
        )
          return false;
      }
      for (const name of names) {
        checkDirectory();
        const stat = fs.lstatSync(path.join(root, name));
        if (!same(files.get(name), stat) || !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) return false;
        fs.unlinkSync(path.join(root, name));
      }
      checkDirectory();
      fs.rmdirSync(root);
      return true;
    } catch {
      return false;
    }
  };
  return { directory: root, check, record, read, cleanup };
}
