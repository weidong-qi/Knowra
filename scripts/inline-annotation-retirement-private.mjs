import { validatePersonalTodoHistory } from '../apps/api/src/modules/personal-todos/history-contract.ts';
import { createNoteVersionReferenceIndex } from '../apps/api/src/modules/knowledge/domain/note-version-references.ts';
import { referencedAnnotationRevisions } from '../apps/api/src/modules/knowledge/domain/history-retention.ts';
import { LOCAL_DATA_COLLECTIONS } from '../apps/api/src/infrastructure/local-data-schema.js';
import { validateAiState } from '../apps/api/src/modules/ai/record-state.ts';
import { validateTaskWorkspaceSnapshot } from '../apps/api/src/modules/task-workspaces/storage-validation.ts';
import { validateCoreOperationState } from '../apps/api/src/infrastructure/core-operation-contract.ts';
import { validateKnowledgeExtractionCommitState } from '../apps/api/src/modules/ai/knowledge-extraction-commit-contract.js';
import { validateExtractionTaskState } from '../apps/api/src/modules/ai/knowledge-extraction-task-contract.js';
import { HISTORY_NON_PRIVATE_TABLES } from '../apps/desktop-runtime/src/note-version-discard-gate.mjs';
import {
  validatePrivateHistory,
  privateHistoryTableNames
} from '../apps/desktop-runtime/src/private-history-validation.mjs';

const validators = {
  aiRuntime: validateAiState,
  taskWorkspaces: validateTaskWorkspaceSnapshot,
  coreOperations: validateCoreOperationState,
  knowledgeExtractionCommits: validateKnowledgeExtractionCommitState,
  aiKnowledgeExtractionTasks: validateExtractionTaskState
};
const allValidators = { ...validators, personalTodos: validatePersonalTodoHistory };
const fail = () => new Error('私有记录或待同步状态不可完整核对，未生成清理结论。');
const json = value => {
  try {
    return JSON.parse(value);
  } catch {
    throw fail();
  }
};

export function inspectJsonPrivateSource(document, state) {
  const privateSources = [];
  const present = new Set();
  const allowed = new Set([
    ...LOCAL_DATA_COLLECTIONS,
    ...Object.keys(allValidators),
    'schemaVersion',
    'version',
    'data',
    'exportedAt',
    'sync'
  ]);
  for (const [prefix, source] of document === state
    ? [['json', document]]
    : [
        ['json', document],
        ['json.data', state]
      ]) {
    if (Object.keys(source).some(key => !allowed.has(key) || (key === 'data' && source === state))) throw fail();
    for (const [key, validate] of Object.entries(allValidators)) {
      if (!Object.hasOwn(source, key)) continue;
      // 验证副本，不采用校验器可能生成的默认值或内存升级结果。
      try {
        validate(structuredClone(source[key]));
      } catch {
        throw fail();
      }
      if (source[key] === undefined) throw fail();
      present.add(key);
      privateSources.push({ name: `${prefix}.${key}`, records: [source[key]] });
    }
    if (source.sync !== undefined && (!source.sync || source.sync.version !== 1)) throw fail();
  }
  return {
    state,
    privateSources,
    pendingSyncSources: [],
    coverage: {
      privateRecords: Object.keys(validators).every(key => present.has(key)) ? 'checked' : 'unavailable-core-export',
      pendingSync: 'not-applicable-server-json'
    }
  };
}

const pendingMetadata = new Set([
  'entityUpload',
  'entityConflict',
  'knowledgeLifecycleQueue',
  'knowledgeLifecycleUpload',
  'examFocusReviewQueue',
  'examFocusReviewUpload',
  'attachmentPending',
  'bootstrap',
  'blocked'
]);
const settledMetadata = new Set([
  'capabilities',
  'clientPaused',
  'configured',
  'confirmed',
  'cursor',
  'datasetId',
  'deviceId',
  'entitySequence',
  'epoch',
  'generation',
  'lastSyncedAt',
  'ownerId',
  'serverEpoch',
  'serverUrl',
  'authoritativePurgeResult'
]);
const quote = name => `"${name.replaceAll('"', '""')}"`;
const nonempty = value =>
  value !== null && value !== false && value !== '' && (typeof value !== 'object' || Object.keys(value).length > 0);

export function inspectSqlitePrivateSource(db, version) {
  const tables = new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map(row => row.name)
  );
  const metadata = db.prepare('SELECT key,value FROM metadata').all();
  const privateCoverage = validatePrivateHistory(db, tables, version);

  const knownTables = privateHistoryTableNames(version);
  const privateSources = [],
    pendingSyncSources = [];
  for (const table of tables) {
    if (HISTORY_NON_PRIVATE_TABLES.includes(table)) continue;
    if (table === 'sync_uploads' || table === 'sync_conflicts') {
      const field = table === 'sync_uploads' ? 'request' : 'payload';
      const records = db
        .prepare(`SELECT ${quote(field)} AS payload FROM ${quote(table)}`)
        .all()
        .map(row => json(row.payload));
      if (records.some(record => !record || typeof record !== 'object' || Array.isArray(record))) throw fail();
      pendingSyncSources.push({ name: `sqlite.${table}`, records });
      continue;
    }
    const records = [];
    for (const column of db.prepare(`PRAGMA table_info(${quote(table)})`).all()) {
      if (/BLOB/i.test(column.type)) {
        if (db.prepare(`SELECT 1 FROM ${quote(table)} WHERE length(${quote(column.name)}) > 0 LIMIT 1`).get())
          throw fail();
        continue;
      }
      if (!/TEXT|CHAR|CLOB|JSON|^$/i.test(column.type)) continue;
      for (const row of db
        .prepare(`SELECT ${quote(column.name)} AS value FROM ${quote(table)} WHERE ${quote(column.name)} IS NOT NULL`)
        .iterate()) {
        if (typeof row.value !== 'string') throw fail();
        records.push(
          column.name.endsWith('_json') || (table === 'sync_recovery' && column.name === 'payload')
            ? json(row.value)
            : row.value
        );
      }
    }
    privateSources.push({
      name: knownTables.has(table) ? `sqlite.${table}` : 'sqlite.otherPrivateTables',
      records,
      tablesScanned: 1
    });
  }
  const outbox = [];
  const states = new Set([
    'pending',
    'sending',
    'acknowledged',
    'retry_wait',
    'blocked_dependency',
    'conflict',
    'failed_permanent'
  ]);
  for (const row of db
    .prepare("SELECT state,protocol_version,changes,dependencies FROM sync_outbox WHERE state IS NOT 'acknowledged'")
    .iterate()) {
    if (!states.has(row.state) || row.protocol_version !== 1) throw fail();
    const changes = json(row.changes),
      dependencies = json(row.dependencies);
    if (!Array.isArray(changes) || !Array.isArray(dependencies)) throw fail();
    outbox.push({ changes, dependencies });
  }
  pendingSyncSources.push({ name: 'sqlite.sync_outbox', records: outbox });
  const otherMetadata = [];
  for (const row of metadata) {
    if (typeof row.key !== 'string' || typeof row.value !== 'string') throw fail();
    if (row.key.startsWith('sync:')) {
      const key = row.key.slice(5),
        value = json(row.value);
      if (pendingMetadata.has(key) || key.startsWith('bootstrapPage:') || !settledMetadata.has(key)) {
        pendingSyncSources.push({
          name: 'sqlite.sync_metadata',
          records: nonempty(value) ? (Array.isArray(value) ? value : [value]) : []
        });
      } else otherMetadata.push(value);
    } else if (!row.key.endsWith('Version')) otherMetadata.push(row.value);
  }
  privateSources.push({ name: 'sqlite.metadata', records: otherMetadata });
  return { privateSources, pendingSyncSources, coverage: { privateRecords: privateCoverage, pendingSync: 'checked' } };
}

// 只识别重点形状或明确的 contentAnnotations 容器，避免把任务自身的 schemaVersion 当成重点。
function legacyCopies(value, inAnnotations = false, depth = 0) {
  if (depth > 100) throw fail();
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      let nested;
      try {
        nested = JSON.parse(trimmed);
      } catch {
        return 0;
      }
      return legacyCopies(nested, inAnnotations, depth + 1);
    }
    return 0;
  }
  if (!value || typeof value !== 'object') return 0;
  if (Array.isArray(value)) return value.reduce((n, item) => n + legacyCopies(item, inAnnotations, depth + 1), 0);
  const annotation =
    inAnnotations ||
    (typeof value.noteId === 'string' &&
      typeof value.quoteText === 'string' &&
      ('fromPosition' in value || 'anchorFingerprint' in value || 'originSnapshot' in value));
  if (annotation) {
    const version = value.schemaVersion ?? 1;
    if (![1, 2, 3].includes(version)) throw fail();
    return version < 3 ? 1 : 0;
  }
  let total = 0;
  for (const [key, child] of Object.entries(value))
    total += legacyCopies(
      child,
      key === 'contentAnnotations' || (value.collection === 'contentAnnotations' && key === 'value'),
      depth + 1
    );
  return total;
}

export function inspectPrivateReferences(sources, targets, revisions) {
  const groups = new Map();
  for (const source of sources) {
    const group = groups.get(source.name) ?? { records: [], tablesScanned: 0 };
    for (const record of source.records) group.records.push(record);
    group.tablesScanned += source.tablesScanned ?? 0;
    groups.set(source.name, group);
  }
  const bySource = {};
  let valuesScanned = 0,
    copies = 0;
  for (const [name, { records, tablesScanned }] of groups) {
    const referenced = createNoteVersionReferenceIndex({ private: records });
    const revisionReferenced = referencedAnnotationRevisions({ annotationRevisions: revisions }, records);
    const revisionIds = new Set(revisions.map(row => row.id));
    const references = targets.filter(
      row => referenced(row) || (revisionIds.has(row.id) && revisionReferenced(row))
    ).length;
    const embeddedLegacy = records.reduce((n, record) => n + legacyCopies(record), 0);
    bySource[name] = {
      valuesScanned: records.length,
      referencedTargets: references,
      legacyCopies: embeddedLegacy,
      ...(tablesScanned ? { tablesScanned } : {})
    };
    valuesScanned += records.length;
    copies += embeddedLegacy;
  }
  return { valuesScanned, legacyCopies: copies, bySource };
}
