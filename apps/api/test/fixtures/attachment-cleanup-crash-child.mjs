import fs from 'node:fs';
import path from 'node:path';
import { createAppContext } from '../../src/app.factory.ts';
import { createFileDataStore } from '../../src/infrastructure/file-data-store.ts';

const [root, phase] = process.argv.slice(2);
const dataStore = createFileDataStore(path.join(root, 'data.json'));
const app = createAppContext({ dataStore, storageRootDir: root, uploadsDir: path.join(root, 'uploads') });
const space = app.modules.knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
const note = app.modules.knowledge.noteService.createNote({
  spaceId: space.id,
  title: '合成附件清理',
  rawMarkdown: ''
});
const attachment = app.http.storage.uploadAttachment({
  noteId: note.id,
  fileName: 'fixture.txt',
  contentBase64: Buffer.from('synthetic cleanup').toString('base64')
});
const file = path.join(root, attachment.storagePath);
function freeze() {
  fs.writeFileSync(path.join(root, 'crash-boundary.json'), JSON.stringify({ attachment, file }));
  fs.writeSync(1, 'boundary-ready\n');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
}
if (phase === 'before-commit') dataStore.flush = freeze;
else {
  const remove = fs.rmSync;
  fs.rmSync = (target, options) => {
    if (String(target) === file) return freeze();
    return remove(target, options);
  };
}
try {
  app.http.storage.deleteAttachment({ id: attachment.id });
} catch {
  /* 等待父进程强杀 */
}
setInterval(() => {}, 1000);
