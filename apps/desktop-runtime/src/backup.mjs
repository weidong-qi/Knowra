import { validateTaskWorkspaceBackup } from './task-workspaces/backup-validation.mjs';
import { assertRestoreReadiness, readRestoreSnapshot } from './restore-readiness.mjs';
import { validateSqliteDeletionFacts } from './sqlite-deletion-facts-contract.mjs';
import { validateSqliteActionRows } from './ai-sqlite-action-store.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  LOCAL_DATA_COLLECTIONS,
  LOCAL_DATA_SCHEMA_VERSION,
  createEmptyLocalState,
  createPersistedLocalDocument,
  validatePersistedLocalState
} from '../../api/src/infrastructure/local-data-schema.js';
import { LOCAL_DATABASE_VERSION } from './sqlite-schema.mjs';
import { validateSqliteCoreOperationRows } from './core-operation-store.mjs';
import { createSqliteAiRepository } from './ai-sqlite-repository.mjs';
import { validateSqliteAccessRows } from './ai-sqlite-access-store.mjs';
import { validateSqliteConversationRows } from './ai-sqlite-conversation-store.mjs';
import { AI_RECORD_KINDS, validateAiEvent, validateAiRecord } from '../../api/src/modules/ai/record-contract.ts';
import { copyRecoveryDraftFiles, listArchivedDraftFiles } from './recovery-draft-files.mjs';
import { validateSqliteKnowledgeExtractionBackup } from './knowledge-extraction-validation.mjs';

function readBackupFile(file) {
  const expected = fs.lstatSync(file);
  if (!expected.isFile() || expected.isSymbolicLink() || expected.nlink !== 1)
    throw new Error('备份文件必须是独立普通文件，不能是符号链接或硬链接。');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
  try {
    const matches = stat =>
      stat.isFile() &&
      stat.nlink === 1 &&
      expected.dev === stat.dev &&
      expected.ino === stat.ino &&
      expected.size === stat.size &&
      expected.mtimeMs === stat.mtimeMs;
    if (!matches(fs.fstatSync(fd))) throw new Error('备份文件在检查期间已变化。');
    const bytes = fs.readFileSync(fd);
    if (!matches(fs.fstatSync(fd)) || !matches(fs.lstatSync(file))) throw new Error('备份文件在检查期间已变化。');
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}
const digest = file => createHash('sha256').update(readBackupFile(file)).digest('hex');
function inventory(root, relative = '') {
  if (fs.lstatSync(path.join(root, relative)).isSymbolicLink()) throw new Error('备份目录中不允许符号链接。');
  return fs
    .readdirSync(path.join(root, relative), { withFileTypes: true })
    .flatMap(entry => {
      const name = path.join(relative, entry.name);
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile()))
        throw new Error('备份中只能包含普通文件和目录。');
      const stat = fs.lstatSync(path.join(root, name));
      if (stat.isFile() && stat.nlink !== 1) throw new Error('备份文件不允许硬链接。');
      return entry.isDirectory()
        ? inventory(root, name)
        : [{ path: name.split(path.sep).join('/'), sha256: digest(path.join(root, name)), size: stat.size }];
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}
const supportedPath = name =>
  name === 'local.sqlite' ||
  name === 'recovery-drafts.json' ||
  name === 'recovery.json' ||
  /^recovery-draft-archives\/[a-f0-9]{64}\.json$/.test(name) ||
  (typeof name === 'string' &&
    name.startsWith('uploads/') &&
    !name.includes('\\') &&
    name.split('/').every(segment => segment && segment !== '.' && segment !== '..'));

function verifyConversationAttachmentFiles(attachments, inventoryFiles) {
  const files = new Map(inventoryFiles.map(file => [file.path, file]));
  for (const attachment of attachments.filter(item => item.storageStatus === 'ready' && !item.removedAt)) {
    const file = files.get(`uploads/ai-conversations/${attachment.attachmentId}.bin`);
    if (!file || file.sha256 !== attachment.sha256 || file.size !== attachment.size) {
      throw new Error(`备份对话附件“${attachment.fileName}”缺失或内容校验失败。`);
    }
  }
}

function verifyNewConversationAttachmentBackup(databaseFile, files) {
  const db = new DatabaseSync(databaseFile, { readOnly: true });
  try {
    let taskWorkspace;
    try {
      taskWorkspace = { status: 'ready', ...validateTaskWorkspaceBackup(db, files) };
    } catch {
      taskWorkspace = { status: 'rescue-only', reasonCode: 'TASK_WORKSPACE_UNAVAILABLE' };
    }
    // 保留既有旧备份/损坏AI原始资料救援语义，仅新增附件的成功发布前检查。
    if (
      db.prepare('PRAGMA user_version').get().user_version >= 7 &&
      db.prepare("SELECT 1 FROM ai_conversation_records WHERE kind = 'aiConversationAttachment' LIMIT 1").get()
    ) {
      verifyConversationAttachmentFiles(validateSqliteConversationRows(db).conversationAttachments, files);
    }
    return taskWorkspace;
  } finally {
    db.close();
  }
}

export function backupPath(dataDirectory, id) {
  if (typeof id !== 'string' || !/^\d+-[a-f0-9-]+$/.test(id)) throw new Error('备份编号无效。');
  const root = path.join(dataDirectory, 'backups');
  if (fs.existsSync(root) && fs.lstatSync(root).isSymbolicLink()) throw new Error('备份目录不允许符号链接。');
  const directory = path.join(root, id);
  if (!fs.existsSync(directory) || !fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink())
    throw new Error('备份目录不存在或无效。');
  return directory;
}

export function createRuntimeBackup(
  store,
  dataDirectory,
  { backupRoot = dataDirectory, purpose = 'manual', draftsDirectory = backupRoot, recoveryDrafts } = {}
) {
  const backupDirectory = path.join(backupRoot, 'backups', `${Date.now()}-${randomUUID()}`);
  if (fs.existsSync(path.dirname(backupDirectory)) && fs.lstatSync(path.dirname(backupDirectory)).isSymbolicLink())
    throw new Error('备份目录不允许符号链接。');
  fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
  try {
    store.backupTo(path.join(backupDirectory, 'local.sqlite'));
    const uploads = path.join(dataDirectory, 'uploads');
    if (fs.existsSync(uploads))
      fs.cpSync(uploads, path.join(backupDirectory, 'uploads'), { recursive: true, dereference: false });
    copyRecoveryDraftFiles(dataDirectory, backupDirectory, draftsDirectory);
    if (recoveryDrafts !== undefined) {
      const browserDrafts = validateBackupDrafts(recoveryDrafts);
      const combined = { version: 1, drafts: { ...readBackupDrafts(backupDirectory).drafts, ...browserDrafts.drafts } };
      fs.writeFileSync(path.join(backupDirectory, 'recovery-drafts.json'), JSON.stringify(combined), { mode: 0o600 });
    }
    const files = inventory(backupDirectory);
    const taskWorkspace = verifyNewConversationAttachmentBackup(path.join(backupDirectory, 'local.sqlite'), files);
    fs.writeFileSync(
      path.join(backupDirectory, 'manifest.json'),
      JSON.stringify(
        {
          version: 1,
          createdAt: new Date().toISOString(),
          purpose,
          datasetId: store.getStatus().datasetId,
          files,
          taskWorkspace,
          ...(taskWorkspace.status === 'rescue-only' ? { restoreReady: false } : {})
        },
        null,
        2
      ),
      { mode: 0o600 }
    );
    return backupDirectory;
  } catch (error) {
    fs.rmSync(backupDirectory, { recursive: true, force: true });
    throw error;
  }
}

export function listRuntimeBackups(dataDirectory) {
  const root = path.join(dataDirectory, 'backups');
  if (!fs.existsSync(root)) return [];
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error('备份目录不允许符号链接。');
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter(
      entry =>
        entry.isDirectory() &&
        /^\d+-[a-f0-9-]+$/.test(entry.name) &&
        fs.existsSync(path.join(root, entry.name, 'manifest.json'))
    )
    .map(entry => {
      try {
        const manifest = JSON.parse(readBackupFile(path.join(root, entry.name, 'manifest.json')).toString('utf8'));
        return {
          id: entry.name,
          ...(manifest.taskWorkspace?.status === 'rescue-only'
            ? { restoreReady: false, error: '任务工作区不可校验，此备份仅供原始资料救援，不能直接恢复。' }
            : {}),
          createdAt: manifest.createdAt,
          purpose: manifest.purpose ?? 'legacy-unspecified',
          fileCount: manifest.files?.length ?? 0,
          size: manifest.files?.reduce((sum, file) => sum + (Number(file.size) || 0), 0) ?? 0
        };
      } catch {
        return {
          id: entry.name,
          createdAt: null,
          purpose: 'unknown',
          fileCount: 0,
          size: 0,
          error: '备份清单不可读，请检查此备份。'
        };
      }
    })
    .sort((a, b) => b.id.localeCompare(a.id));
}

/** 请求正文总量由 HTTP 解析器限制；这里仅接受草稿键和值，不接受文件路径。 */
export function validateBackupDrafts(record, { maxBytes = 8 * 1024 * 1024 } = {}) {
  if (
    !record ||
    record.version !== 1 ||
    !record.drafts ||
    typeof record.drafts !== 'object' ||
    Array.isArray(record.drafts)
  )
    throw new Error('恢复草稿格式无效。');
  if (Buffer.byteLength(JSON.stringify(record)) > maxBytes) throw new Error('恢复草稿过大，请先分批导出正文。');
  for (const [key, value] of Object.entries(record.drafts)) {
    const prefix = ['knowra:note-draft:v1:', 'knowra:knowledge-draft:v1:'].find(prefix => key.startsWith(prefix));
    if (!prefix || key.length > 2000) throw new Error('恢复草稿标识无效。');
    let parts;
    try {
      parts = JSON.parse(key.slice(prefix.length));
    } catch {
      throw new Error('恢复草稿标识无效。');
    }
    if (!Array.isArray(parts) || parts.length !== 2 || parts.some(part => typeof part !== 'string' || !part))
      throw new Error('恢复草稿标识无效。');
    if (prefix === 'knowra:knowledge-draft:v1:') {
      const form = value =>
        value &&
        ['title', 'canonicalStatement', 'userExplanation'].every(key => typeof value[key] === 'string') &&
        ['concept', 'fact', 'principle', 'process', 'algorithm', 'formula', 'comparison', 'application'].includes(
          value.knowledgeType
        );
      const source = value?.source;
      if (
        !value ||
        value.version !== 1 ||
        !['create', 'edit'].includes(value.kind) ||
        value.candidateId !== parts[1] ||
        !form(value.initialValue) ||
        !form(value.value) ||
        (value.kind === 'edit' && (typeof value.expectedUpdatedAt !== 'string' || !value.expectedUpdatedAt)) ||
        (source &&
          (value.kind !== 'create' ||
            typeof source.annotationId !== 'string' ||
            !source.annotationId ||
            typeof source.quoteText !== 'string' ||
            !Array.isArray(source.headingPath) ||
            source.headingPath.some(value => typeof value !== 'string') ||
            (source.noteVersionId !== undefined && typeof source.noteVersionId !== 'string') ||
            (source.expectedAnnotationRevision !== undefined &&
              (!Number.isInteger(source.expectedAnnotationRevision) || source.expectedAnnotationRevision < 1))))
      )
        throw new Error('知识恢复草稿格式无效。');
    } else if (
      !value ||
      typeof value.markdown !== 'string' ||
      typeof value.baseMarkdown !== 'string' ||
      (value.baseUpdatedAt !== undefined && typeof value.baseUpdatedAt !== 'string') ||
      (value.conflict !== undefined && typeof value.conflict !== 'string')
    )
      throw new Error('恢复草稿正文格式无效。');
  }
  return record;
}

export function readBackupDrafts(directory) {
  const readRecord = (file, archiveId) => {
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error('恢复草稿不能是符号链接。');
    const bytes = readBackupFile(file);
    if (archiveId && createHash('sha256').update(bytes).digest('hex') !== archiveId)
      throw new Error('恢复草稿归档内容校验失败。');
    const record = JSON.parse(bytes.toString('utf8'));
    // 原生旧草稿不受 HTTP 正文大小限制；仍逐项检查键、正文和知识表单。
    validateBackupDrafts(record, { maxBytes: Infinity });
    return { version: 1, drafts: record.drafts };
  };
  const file = path.join(directory, 'recovery-drafts.json');
  const record = fs.existsSync(file) ? readRecord(file) : { version: 1, drafts: {} };
  const archives = listArchivedDraftFiles(directory, { verify: false }).map(({ id, file }) => ({
    id,
    ...readRecord(file, id)
  }));
  if (archives.length) record.archivedDrafts = archives;
  return record;
}

function verifyBackupFiles(backupDirectory) {
  const manifestStat = fs.lstatSync(path.join(backupDirectory, 'manifest.json'));
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.nlink !== 1)
    throw new Error('备份清单必须是独立普通文件。');
  const manifest = JSON.parse(readBackupFile(path.join(backupDirectory, 'manifest.json')).toString('utf8'));
  if (
    manifest.version !== 1 ||
    !Array.isArray(manifest.files) ||
    !manifest.files.every(
      file =>
        file &&
        supportedPath(file.path) &&
        /^[a-f0-9]{64}$/.test(file.sha256) &&
        (file.size === undefined || (Number.isSafeInteger(file.size) && file.size >= 0))
    )
  )
    throw new Error('备份清单版本或文件路径无效。');
  const actual = inventory(backupDirectory).filter(item => item.path !== 'manifest.json');
  const expected = new Map(manifest.files.map(file => [file.path, file]));
  if (
    !expected.has('local.sqlite') ||
    expected.size !== manifest.files.length ||
    actual.length !== expected.size ||
    actual.some(
      file =>
        expected.get(file.path)?.sha256 !== file.sha256 ||
        (expected.get(file.path)?.size !== undefined && expected.get(file.path).size !== file.size)
    )
  )
    throw new Error('备份文件完整性校验失败，未恢复任何内容。');
  return { manifest, actual };
}

/** 界面激活前检查数据库版本、资料引用和附件；离线救援复制不依赖应用 schema。 */
export function inspectRuntimeBackup(backupDirectory, { restoreContext } = {}) {
  const { manifest, actual } = verifyBackupFiles(backupDirectory);
  if (manifest.taskWorkspace?.status === 'rescue-only')
    throw new Error('任务工作区不可校验，此备份仅供原始资料救援，不能直接恢复。');
  // 旧 CLI 导出保留 WAL 模式；直接只读打开也可能在来源生成 sidecar。
  // 在私有临时副本检查，既不修改原文件，也不污染其清单。
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-backup-inspect-'));
  let db;
  try {
    const bytes = readBackupFile(path.join(backupDirectory, 'local.sqlite'));
    if (createHash('sha256').update(bytes).digest('hex') !== actual.find(file => file.path === 'local.sqlite').sha256)
      throw new Error('备份文件完整性校验失败，未恢复任何内容。');
    const databasePath = path.join(temporary, 'local.sqlite');
    fs.writeFileSync(databasePath, bytes, { flag: 'wx', mode: 0o600 });
    db = new DatabaseSync(databasePath, { readOnly: true });
    if (
      db
        .prepare('PRAGMA integrity_check')
        .all()
        .some(row => row.integrity_check !== 'ok')
    )
      throw new Error('备份数据库完整性校验失败。');
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (version < 1 || version > LOCAL_DATABASE_VERSION) throw new Error('备份数据库版本不受支持，请升级应用。');
    validateSqliteDeletionFacts(db);
    const datasetId = db.prepare("SELECT value FROM metadata WHERE key='datasetId'").get()?.value;
    if (manifest.datasetId !== undefined && datasetId !== undefined && manifest.datasetId !== datasetId)
      throw new Error('备份清单与数据库资料集标识不一致。');
    const taskWorkspaceInfo = validateTaskWorkspaceBackup(db, actual);
    validateSqliteCoreOperationRows(db);
    validateSqliteActionRows(db);
    let aiJobs = [],
      conversationAttachments = [];
    if (version >= 4) {
      if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('备份 AI 私有记录引用不完整。');
      const ai = createSqliteAiRepository(db);
      for (const kind of Object.keys(AI_RECORD_KINDS)) ai.list(kind).forEach(record => validateAiRecord(kind, record));
      aiJobs = ai.list('aiJob');
      for (const job of aiJobs) ai.listEvents(job.jobId).forEach(validateAiEvent);
      if (version >= 6) validateSqliteAccessRows(db);
      if (version >= 7) conversationAttachments = validateSqliteConversationRows(db).conversationAttachments;
    }
    validateSqliteKnowledgeExtractionBackup(db, aiJobs);
    const state = createEmptyLocalState();
    for (const row of db.prepare('SELECT collection, payload FROM entities').all()) {
      if (!LOCAL_DATA_COLLECTIONS.includes(row.collection)) throw new Error('备份包含未知资料类型。');
      state[row.collection].push(JSON.parse(row.payload));
    }
    const schemaMarker = db.prepare("SELECT value FROM metadata WHERE key = 'localDataSchemaVersion'").get()?.value;
    const schemaVersion = schemaMarker === undefined ? 6 : Number(schemaMarker);
    if (
      (schemaMarker !== undefined && !/^[1-9][0-9]*$/.test(schemaMarker)) ||
      !Number.isSafeInteger(schemaVersion) ||
      schemaVersion < 1 ||
      schemaVersion > LOCAL_DATA_SCHEMA_VERSION
    )
      throw new Error('备份核心资料格式版本无效或不受支持。');
    // 只读旧格式投影；不会回写备份、升级表或将新版损坏摘要降级。
    const normalized = validatePersistedLocalState({ ...createPersistedLocalDocument(state), schemaVersion });
    const files = new Map(actual.map(file => [file.path, file]));
    for (const attachment of state.attachments.filter(item => item.status === 'ready')) {
      const file = files.get(`uploads/${attachment.id}-${attachment.fileName}`);
      if (!file || file.sha256 !== attachment.sha256 || file.size !== attachment.size)
        throw new Error(`备份附件“${attachment.fileName}”缺失或内容校验失败。`);
    }
    verifyConversationAttachmentFiles(conversationAttachments, actual);
    const draftRecord = readBackupDrafts(backupDirectory);
    const draftCount = [draftRecord, ...(draftRecord.archivedDrafts ?? [])].reduce(
      (count, record) => count + Object.keys(record.drafts).length,
      0
    );
    // 固有格式检查始终独立可用；只有恢复入口传入当前上下文。
    if (restoreContext)
      assertRestoreReadiness(
        restoreContext,
        readRestoreSnapshot(db, normalized, { projectProvenance: true, initialState: state })
      );
    return {
      valid: true,
      ...taskWorkspaceInfo,
      createdAt: manifest.createdAt,
      purpose: manifest.purpose ?? 'legacy-unspecified',
      fileCount: actual.length,
      size: actual.reduce((sum, file) => sum + file.size, 0),
      noteCount: state.notes.length,
      attachmentCount: state.attachments.length,
      pendingOperations: db.prepare("SELECT COUNT(*) AS count FROM sync_outbox WHERE state != 'acknowledged'").get()
        .count,
      draftCount
    };
  } finally {
    try {
      db?.close();
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
}

/** 只能恢复到不存在的新目录，保留同步队列；不覆盖运行中的数据库。 */
export function restoreRuntimeBackup(backupDirectory, destination) {
  if (fs.existsSync(destination)) throw new Error('恢复目标必须是尚不存在的新目录。');
  const { manifest, actual } = verifyBackupFiles(backupDirectory);
  if (manifest.taskWorkspace?.status === 'rescue-only')
    throw new Error('任务工作区不可校验，此备份仅供原始资料救援，不能直接恢复。');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const staging = `${destination}.restore-${randomUUID()}`;
  try {
    fs.mkdirSync(staging, { mode: 0o700 });
    for (const file of actual) {
      const target = path.join(staging, file.path);
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      fs.copyFileSync(path.join(backupDirectory, file.path), target);
      fs.chmodSync(target, 0o600);
    }
    fs.renameSync(staging, destination);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}
