import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { root, readJson } from './lib.mjs';

const config = await readJson(join(root, '.backup-location.json')).catch(error => {
  if (error.code === 'ENOENT') return {};
  throw error;
});
const backup = resolve(
  root,
  process.env.KNOWRA_DESIGN_BACKUP_DIR || config.backupDirectory || join(dirname(root), '原版备份')
);
const inventory = await readJson(join(backup, '校验清单.json'));
let failed = 0;
for (const item of inventory.files) {
  try {
    const data = await readFile(join(backup, 'project', item.path));
    if (data.length !== item.bytes || createHash('sha256').update(data).digest('hex') !== item.sha256)
      throw new Error('内容已变化');
  } catch (error) {
    failed++;
    console.error(`${item.path}：${error.message}`);
  }
}
if (failed) {
  process.exitCode = 1;
} else {
  console.log(`原版备份校验通过：${inventory.files.length}个文件。`);
}
