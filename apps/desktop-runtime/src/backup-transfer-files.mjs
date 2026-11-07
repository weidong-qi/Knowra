import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const changed = () => new Error('所选备份目录或文件已变化，请重新选择；原资料和已有目标均保留。');
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
const unchangedFile = (a, b) =>
  same(a, b) && a.size === b.size && a.mtimeMs === b.mtimeMs && b.isFile() && b.nlink === 1;
const inside = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};

/** 记录原生选择结果和目录祖先；允许 macOS 自带 /var、/tmp 别名。 */
export function captureBackupDirectory(directory, selection) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw changed();
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (selection && !same(stat, selection))) throw changed();
  const canonical = fs.realpathSync(directory);
  const ancestors = [];
  let candidate = path.parse(directory).root;
  for (const segment of path.resolve(directory).slice(candidate.length).split(path.sep)) {
    candidate = path.join(candidate, segment);
    const entry = fs.lstatSync(candidate);
    const systemAlias =
      process.platform === 'darwin' &&
      ['/var', '/tmp'].includes(candidate) &&
      fs.realpathSync(candidate) === `/private${candidate}`;
    if ((!entry.isDirectory() || entry.isSymbolicLink()) && !systemAlias)
      throw new Error('所选目录及其父目录不能是符号链接。');
    ancestors.push({ path: candidate, stat: entry, link: entry.isSymbolicLink() ? fs.readlinkSync(candidate) : null });
  }
  const check = () => {
    if (fs.realpathSync(directory) !== canonical) throw changed();
    for (const entry of ancestors) {
      const current = fs.lstatSync(entry.path);
      if (
        !same(entry.stat, current) ||
        (entry.link
          ? !current.isSymbolicLink() || fs.readlinkSync(entry.path) !== entry.link
          : !current.isDirectory() || current.isSymbolicLink())
      )
        throw changed();
    }
  };
  return { directory: canonical, check };
}

export function captureExternalBackupDirectory(selection, managedRoot) {
  if (!selection || !Number.isSafeInteger(selection.dev) || !Number.isSafeInteger(selection.ino)) throw changed();
  const selected = captureBackupDirectory(selection.path, selection);
  const managed = fs.realpathSync(managedRoot);
  if (inside(managed, selected.directory) || inside(selected.directory, managed))
    throw new Error('请选择 Knowra 本机资料目录之外的独立目录；不能选择资料目录或其父目录。');
  return selected;
}

/** 拒绝链接和特殊文件，记录所有条目，复制前后检测替换、增删和内容变化。 */
export function captureBackupTree(root) {
  const directory = captureBackupDirectory(root);
  const entries = new Map();
  const visit = relative => {
    const file = path.join(directory.directory, relative);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
      throw new Error('完整备份只能包含普通文件和目录，不能包含符号链接或特殊文件。');
    if (stat.isFile() && stat.nlink !== 1) throw new Error('完整备份不能包含硬链接文件。');
    entries.set(relative, stat);
    if (stat.isDirectory()) fs.readdirSync(file).forEach(name => visit(relative ? `${relative}/${name}` : name));
  };
  visit('');
  const check = () => {
    directory.check();
    const current = captureBackupTreeSnapshot(directory.directory);
    if (current.size !== entries.size) throw changed();
    for (const [name, stat] of entries) {
      const next = current.get(name);
      if (!next || (stat.isFile() ? !unchangedFile(stat, next) : !same(stat, next) || !next.isDirectory()))
        throw changed();
    }
  };
  const checkFile = name => {
    directory.check();
    const segments = name.split('/');
    for (let index = 0; index <= segments.length; index++) {
      const relative = segments.slice(0, index).join('/');
      const expected = entries.get(relative);
      const current = fs.lstatSync(path.join(directory.directory, relative));
      if (
        !expected ||
        (expected.isFile()
          ? !unchangedFile(expected, current)
          : !same(expected, current) || !current.isDirectory() || current.isSymbolicLink())
      )
        throw changed();
    }
  };
  return { directory: directory.directory, entries, check, checkFile };
}

function captureBackupTreeSnapshot(root) {
  const entries = new Map();
  const visit = name => {
    const file = path.join(root, name);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw changed();
    entries.set(name, stat);
    if (stat.isDirectory()) fs.readdirSync(file).forEach(child => visit(name ? `${name}/${child}` : child));
  };
  visit('');
  return entries;
}

export function readBackupTransferFile(tree, name) {
  tree.checkFile(name);
  const expected = tree.entries.get(name);
  if (!expected?.isFile()) throw changed();
  const fd = fs.openSync(
    path.join(tree.directory, name),
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0)
  );
  try {
    if (!unchangedFile(expected, fs.fstatSync(fd))) throw changed();
    const bytes = fs.readFileSync(fd);
    if (!unchangedFile(expected, fs.fstatSync(fd))) throw changed();
    tree.checkFile(name);
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}

function removeCreatedEmptyFile(target, fd, created) {
  try {
    if (
      !created?.isFile() ||
      created.size !== 0 ||
      created.nlink !== 1 ||
      !unchangedFile(created, fs.fstatSync(fd)) ||
      !unchangedFile(created, fs.lstatSync(target))
    )
      return false;
    fs.unlinkSync(target); // 只处理仍绑定本次 FD 的空文件，不清理替换目录。
    return true;
  } catch {
    return false;
  }
}

/** 每个目录和文件均独占创建；最终清单是有效完整备份的提交标志。 */
export function createOwnedBackupDirectory(parent, name) {
  parent.check();
  const root = path.join(parent.directory, name);
  fs.mkdirSync(root, { mode: 0o700 }); // EEXIST 包括已存在的空目录，绝不 rename 覆盖。
  const owned = new Map([['', fs.lstatSync(root)]]);
  const checkParents = (name = '') => {
    parent.check();
    const segments = name.split('/');
    for (let index = 0; index < segments.length; index++) {
      const relative = segments.slice(0, index).join('/');
      const expected = owned.get(relative);
      if (!expected) continue; // 未创建的子目录随后用独占 mkdir 创建。
      const stat = fs.lstatSync(path.join(root, relative));
      if (!expected || !same(expected, stat) || !stat.isDirectory() || stat.isSymbolicLink()) throw changed();
    }
  };
  const check = () => {
    parent.check();
    for (const [relative, expected] of owned) {
      const stat = fs.lstatSync(path.join(root, relative));
      if (
        expected.isFile()
          ? !unchangedFile(expected, stat)
          : !same(expected, stat) || !stat.isDirectory() || stat.isSymbolicLink()
      )
        throw changed();
    }
    const actual = captureBackupTreeSnapshot(root);
    if (actual.size !== owned.size || [...actual.keys()].some(name => !owned.has(name))) throw changed();
  };
  const write = (name, bytes) => {
    checkParents(name);
    const segments = name.split('/');
    for (let index = 1; index < segments.length; index++) {
      const relative = segments.slice(0, index).join('/');
      if (!owned.has(relative)) {
        fs.mkdirSync(path.join(root, relative), { mode: 0o700 });
        owned.set(relative, fs.lstatSync(path.join(root, relative)));
      }
    }
    checkParents(name);
    const target = path.join(root, name);
    const fd = fs.openSync(
      target,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW ?? 0),
      0o600
    );
    let created,
      writing = false,
      removed = false;
    try {
      created = fs.fstatSync(fd);
      if (!created.isFile() || created.size !== 0 || created.nlink !== 1) throw changed();
      // O_EXCL 只保护文件名；打开后、写资料前还须确认目录和实际路径仍绑定本次创建。
      checkParents(name);
      if (!unchangedFile(created, fs.lstatSync(target)) || !unchangedFile(created, fs.fstatSync(fd))) throw changed();
      writing = true;
      fs.writeFileSync(fd, bytes);
      fs.fsyncSync(fd);
    } catch (error) {
      if (!writing) removed = removeCreatedEmptyFile(target, fd, created);
      throw error;
    } finally {
      try {
        if (!removed) owned.set(name, fs.fstatSync(fd));
      } finally {
        fs.closeSync(fd);
      }
    }
    checkParents(name);
    if (!unchangedFile(owned.get(name), fs.lstatSync(target))) throw changed();
  };
  const cleanup = () => {
    try {
      check();
      const actual = captureBackupTreeSnapshot(root);
      if (actual.size !== owned.size || [...actual.keys()].some(name => !owned.has(name))) return false;
      for (const [name, expected] of [...owned].sort((a, b) => b[0].length - a[0].length)) {
        parent.check();
        const stat = fs.lstatSync(path.join(root, name));
        if (expected.isFile() ? !unchangedFile(expected, stat) : !same(expected, stat) || !stat.isDirectory())
          return false;
        if (stat.isFile()) fs.unlinkSync(path.join(root, name));
        else fs.rmdirSync(path.join(root, name));
      }
      return true;
    } catch {
      return false;
    } // 所选路径或子项被替换时保留现场，不递归删除替换物。
  };
  const remove = name => {
    try {
      checkParents(name);
      const expected = owned.get(name);
      if (!expected?.isFile() || !unchangedFile(expected, fs.lstatSync(path.join(root, name)))) return false;
      fs.unlinkSync(path.join(root, name));
      owned.delete(name);
      return true;
    } catch {
      return false;
    }
  };
  return { root, write, check, remove, cleanup };
}

export const backupTransferDigest = bytes => createHash('sha256').update(bytes).digest('hex');
