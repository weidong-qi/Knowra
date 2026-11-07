import fs from 'node:fs';
import path from 'node:path';
import { captureBackupDirectory, captureBackupTree, readBackupTransferFile } from './backup-transfer-files.mjs';

const inside = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};

// macOS 大小写/Unicode 别名的 realpath 字符串不一定统一；以每层目录身份判断包含关系。
function hasSourceAncestor(directory, source) {
  const identity = fs.lstatSync(source);
  for (let candidate = directory; ; candidate = path.dirname(candidate)) {
    const stat = fs.lstatSync(candidate);
    if (stat.dev === identity.dev && stat.ino === identity.ino) return true;
    if (candidate === path.dirname(candidate)) return false;
  }
}

/** 只接受已存在的普通父目录；规范路径和祖先身份均受保护，不跟随用户目录别名。 */
export function captureRecoveryDestination(destination, source) {
  const resolved = path.resolve(destination);
  const parent = captureBackupDirectory(path.dirname(resolved));
  const target = path.join(parent.directory, path.basename(resolved));
  if (inside(source, target) || hasSourceAncestor(parent.directory, source))
    throw new Error('救援导出目标必须位于源资料目录之外。');
  try {
    fs.lstatSync(target);
  } catch (error) {
    if (error.code === 'ENOENT') return { parent, name: path.basename(target) };
    throw error;
  }
  throw new Error('导出目录已存在，禁止覆盖。');
}

export function requireExternalRecoveryTemporaryDirectory(directory, source) {
  const temporary = captureBackupDirectory(directory);
  if (inside(source, temporary.directory) || hasSourceAncestor(temporary.directory, source))
    throw new Error('救援临时目录必须位于源资料目录之外。');
  return temporary;
}

/** 在两层协调锁均已取得后建立检查边界；目录时间也属于不变条件。 */
export function captureRecoverySource(directory) {
  const tree = captureBackupTree(directory);
  const stamps = new Map(
    [...tree.entries.keys()].map(name => [name, fs.lstatSync(path.join(directory, name), { bigint: true })])
  );
  const check = () => {
    tree.check();
    for (const [name, expected] of stamps) {
      const current = fs.lstatSync(path.join(directory, name), { bigint: true });
      if (!['dev', 'ino', 'mode', 'nlink', 'size', 'mtimeNs', 'ctimeNs'].every(key => expected[key] === current[key]))
        throw new Error('救援检查期间源资料或目录已变化，已停止发布；请关闭写入来源后重试。');
    }
  };
  check();
  return { check, entries: tree.entries, read: name => readBackupTransferFile(tree, name) };
}
