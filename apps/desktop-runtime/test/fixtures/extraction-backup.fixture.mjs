import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createSqliteDataStore } from '../../src/sqlite-data-store.mjs';
import { createRuntimeBackup } from '../../src/backup.mjs';
import { createAppContext } from '../../../api/src/app.factory.ts';
import {
  createExtractionTaskSources,
  extractionTaskGateway,
  quietTaskLogger
} from '../../../api/test/fixtures/knowledge-extraction-task.fixture.js';
import { temporaryDirectory } from '../helpers.mjs';

export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function treeHashes(root, relative = '') {
  return fs
    .readdirSync(path.join(root, relative), { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap(entry => {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      return entry.isDirectory()
        ? [{ path: `${name}/` }, ...treeHashes(root, name)]
        : [{ path: name, hash: digest(fs.readFileSync(path.join(root, name))) }];
    });
}

export function mutateBackup(directory, mutate) {
  const file = path.join(directory, 'local.sqlite');
  const db = new DatabaseSync(file);
  try {
    mutate(db);
  } finally {
    db.close();
  }
  const manifestFile = path.join(directory, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const bytes = fs.readFileSync(file),
    item = manifest.files.find(item => item.path === 'local.sqlite');
  Object.assign(item, { size: bytes.length, sha256: digest(bytes) });
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
}

export function copyBackup(f, name, mutate = () => {}) {
  const directory = path.join(f.root, name);
  fs.cpSync(f.backup, directory, { recursive: true });
  mutateBackup(directory, mutate);
  return directory;
}

export const selection = directory => {
  const { dev, ino } = fs.lstatSync(directory);
  return { path: directory, dev, ino };
};

/** 真正的合成 start/run/原子接纳；不手填授权或成功任务。 */
export async function extractionBackupFixture(t, { onCall, run = true } = {}) {
  const root = temporaryDirectory(t),
    dataRoot = path.join(root, 'data');
  const store = createSqliteDataStore(path.join(dataRoot, 'local.sqlite'));
  const mock = extractionTaskGateway(onCall);
  const app = createAppContext({
    dataStore: store,
    ownerId: 'demo',
    storageRootDir: dataRoot,
    uploadsDir: path.join(dataRoot, 'uploads'),
    knowledgeExtractionMock: {
      gateway: mock.gateway,
      clock: () => new Date('2026-10-02T12:00:00Z'),
      schedule() {},
      logger: quietTaskLogger
    }
  });
  const service = app.knowledgeExtractionTasks;
  t.after(async () => {
    await service.close();
    store.close();
  });
  const sources = await createExtractionTaskSources(app);
  const job = await service.start(sources.input);
  if (run) await service.run(job.jobId);
  const backup = createRuntimeBackup(store, dataRoot);
  return { root, dataRoot, store, app, service, mock, job, backup, ...sources };
}
