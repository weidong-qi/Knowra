import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createAppContext } from '../../api/src/app.factory.js';
import { validateLocalSnapshot } from '../../api/src/infrastructure/local-data-schema.ts';
import { createLocalAttachmentFileManager } from '../../api/src/infrastructure/local-attachment-file-manager.ts';
import { createSqliteDataStore } from './sqlite-data-store.mjs';

const hash = content => createHash('sha256').update(content).digest('hex');

/** 只读原 JSON 与附件；源文件变化或附件不完整时拒绝生成基线。 */
export function exportJsonBaseline({ sourcePath, storageRootDir, outputPath }) {
  const source = fs.readFileSync(sourcePath);
  const snapshot = validateLocalSnapshot(JSON.parse(source));
  const uploadsDir = path.join(storageRootDir, 'storage', 'uploads');
  if (snapshot.data.attachments.length && !fs.existsSync(uploadsDir))
    throw new Error('默认附件目录不存在，请使用包含附件的整库导出快照。');
  const fileManager = snapshot.data.attachments.length
    ? createLocalAttachmentFileManager({ uploadsDir, storageRootDir })
    : null;
  const attachmentFiles = snapshot.data.attachments.map(item => {
    const file = fileManager.resolveReadableAttachmentPath(item);
    if (!file) throw new Error(`基线附件缺失：${item.id}`);
    const content = fs.readFileSync(file);
    if (item.sha256 && hash(content) !== item.sha256) throw new Error(`基线附件校验失败：${item.id}`);
    return { ...item, contentBase64: content.toString('base64') };
  });
  if (hash(fs.readFileSync(sourcePath)) !== hash(source)) throw new Error('导出过程中原资料库发生变化，请重新导出。');
  const output = JSON.stringify({ ...snapshot, exportedAt: new Date().toISOString(), attachmentFiles });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(outputPath, output, { flag: 'wx', mode: 0o600 });
  return {
    outputPath,
    sourceSha256: hash(source),
    snapshotSha256: hash(output),
    notes: snapshot.data.notes.length,
    attachments: attachmentFiles.length
  };
}

/** 一次性迁移到新目录。原快照不变，失败不发布半成品资料库。 */
export function importJsonSnapshot(sourcePath, destination) {
  if (fs.existsSync(destination)) throw new Error('迁移目标必须是尚不存在的新目录。');
  const input = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  validateLocalSnapshot(input);
  const staging = `${destination}.migration-${randomUUID()}`;
  let store;
  try {
    store = createSqliteDataStore(path.join(staging, 'local.sqlite'));
    const context = createAppContext({
      dataStore: store,
      storageRootDir: staging,
      uploadsDir: path.join(staging, 'uploads'),
      ownerId: 'demo'
    });
    context.http.storage.importKnowledgeBase(input);
    store.close();
    store = null;
    fs.renameSync(staging, destination);
  } catch (error) {
    store?.close();
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}
