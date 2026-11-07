import fs from 'node:fs';
import path from 'node:path';
import { openReadonlySqliteSnapshot } from '../apps/desktop-runtime/src/sqlite-readonly-snapshot.mjs';

const SOURCE_COLLECTIONS = [
  'knowledgeEvidence',
  'questionSources',
  'analysisScopeSnapshots',
  'contentAnnotations',
  'annotationRevisions'
];
const POSTGRES_TABLES = [
  'SyncJournal',
  'User',
  'KnowledgeSpace',
  'Folder',
  'Tag',
  'TagGroup',
  'Note',
  'NoteTag',
  'Attachment',
  'ContentAnnotation',
  'AnnotationExclusion',
  'AnnotationRevision',
  'AnalysisScopeSnapshot',
  'NoteVersion',
  'KnowledgeItem',
  'LearningObjective',
  'ExamProfile',
  'ExamFocus',
  'Question',
  'QuestionObjective',
  'QuestionSource',
  'KnowledgeEvidence'
];

const byteLength = value => Buffer.byteLength(String(value ?? ''), 'utf8');
const payloadBytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');

function recentVersionCounts(versions, now) {
  const result = { last7Days: 0, last30Days: 0, last30DaysContentBytes: 0 };
  for (const version of versions) {
    const created = Date.parse(version.createdAt ?? '');
    if (!Number.isFinite(created) || created > now) continue;
    if (now - created <= 7 * 86400000) result.last7Days++;
    if (now - created <= 30 * 86400000) {
      result.last30Days++;
      result.last30DaysContentBytes += byteLength(version.content);
    }
  }
  return result;
}

export function summarizeCollections(state, { now = Date.now() } = {}) {
  const collections = {};
  for (const [name, records] of Object.entries(state)) {
    if (!Array.isArray(records)) continue;
    collections[name] = {
      count: records.length,
      logicalBytes: records.reduce((sum, record) => sum + payloadBytes(record), 0)
    };
  }
  const notes = state.notes ?? [];
  const versions = state.noteVersions ?? [];
  const activeNotes = notes.filter(record => !record.deleted && !record.deletedAt);
  const recycledNotes = notes.filter(record => record.deleted || record.deletedAt);
  const countsByNote = new Map();
  for (const version of versions) countsByNote.set(version.noteId, (countsByNote.get(version.noteId) ?? 0) + 1);
  const versionCounts = [...countsByNote.values()].sort((a, b) => a - b);
  return {
    collections,
    content: {
      currentNoteBodyBytes: activeNotes.reduce((sum, record) => sum + byteLength(record.rawMarkdown), 0),
      recycledNoteBodyBytes: recycledNotes.reduce((sum, record) => sum + byteLength(record.rawMarkdown), 0),
      noteVersionContentBytes: versions.reduce((sum, record) => sum + byteLength(record.content), 0),
      sourceAndSnapshotLogicalBytes: SOURCE_COLLECTIONS.reduce(
        (sum, name) => sum + (collections[name]?.logicalBytes ?? 0),
        0
      ),
      currentNotes: activeNotes.length,
      recycledNotes: recycledNotes.length,
      versionCount: versions.length,
      maxVersionsPerNote: versionCounts.at(-1) ?? 0,
      medianVersionsPerVersionedNote: versionCounts.length
        ? versionCounts[Math.floor((versionCounts.length - 1) / 2)]
        : 0,
      versionCadence: recentVersionCounts(versions, now)
    }
  };
}

export function measureDirectory(directory) {
  const result = { bytes: 0, allocatedBytes: 0, files: 0, symlinksSkipped: 0, exists: fs.existsSync(directory) };
  if (!result.exists) return result;
  function visit(target) {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) {
      result.symlinksSkipped++;
      return;
    }
    if (stat.isFile()) {
      result.files++;
      result.bytes += stat.size;
      result.allocatedBytes += stat.blocks == null ? stat.size : stat.blocks * 512;
      return;
    }
    if (stat.isDirectory()) for (const entry of fs.readdirSync(target)) visit(path.join(target, entry));
  }
  visit(directory);
  return result;
}

function measureBackups(directory) {
  const files = measureDirectory(directory);
  const byPurpose = { manual: 0, 'before-restore': 0, 'legacy-unspecified': 0, other: 0 };
  let readableManifests = 0;
  let newestCreatedAt = null;
  let oldestCreatedAt = null;
  if (files.exists && fs.lstatSync(directory).isDirectory())
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(directory, entry.name, 'manifest.json');
      if (!fs.existsSync(manifestPath)) {
        byPurpose.other++;
        continue;
      }
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        readableManifests++;
        const purpose =
          manifest.purpose === undefined
            ? 'legacy-unspecified'
            : manifest.purpose === 'manual' || manifest.purpose === 'before-restore'
              ? manifest.purpose
              : 'other';
        byPurpose[purpose]++;
        const created = Date.parse(manifest.createdAt);
        if (Number.isFinite(created)) {
          const date = new Date(created).toISOString();
          if (!oldestCreatedAt || date < oldestCreatedAt) oldestCreatedAt = date;
          if (!newestCreatedAt || date > newestCreatedAt) newestCreatedAt = date;
        }
      } catch {
        byPurpose.other++;
      }
    }
  return { ...files, readableManifests, byPurpose, oldestCreatedAt, newestCreatedAt };
}

export function measureManagedFiles({ uploadsDir, tempDir, exportsDir, backupsDir }) {
  return {
    attachments: measureDirectory(uploadsDir),
    temporaryTasks: measureDirectory(tempDir),
    exports: measureDirectory(exportsDir),
    backups: measureBackups(backupsDir)
  };
}

function commonReport(driver, database, summary, files, sync = {}) {
  const structuralIndexBytes =
    driver === 'postgres'
      ? database.indexAllocatedBytes
      : driver === 'sqlite'
        ? Object.entries(database.tableAllocatedBytes)
            .filter(([name]) => name.startsWith('sqlite_autoindex_'))
            .reduce((sum, [, bytes]) => sum + bytes, 0)
        : 0;
  const syncAllocatedBytes =
    driver === 'postgres'
      ? sync.journalAllocatedBytes
      : driver === 'sqlite'
        ? Object.values(sync.tableAllocatedBytes).reduce((sum, bytes) => sum + bytes, 0)
        : sync.journalLogicalBytes;
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    driver,
    database,
    ...summary,
    files,
    sync,
    categories: {
      currentNoteBody: { bytes: summary.content.currentNoteBodyBytes, basis: 'utf8-content' },
      recycledNoteBody: { bytes: summary.content.recycledNoteBodyBytes, basis: 'utf8-content' },
      noteHistory: { bytes: summary.content.noteVersionContentBytes, basis: 'utf8-content' },
      sourcesAndSnapshots: {
        bytes: summary.content.sourceAndSnapshotLogicalBytes ?? summary.content.sourceSnapshotTableBytes,
        basis: driver === 'postgres' ? 'allocated-table-bytes' : 'utf8-records'
      },
      examHistorySnapshots: { status: 'model-not-implemented', bytes: null },
      attachments: { bytes: files.attachments.bytes, basis: 'managed-files' },
      searchIndexes: {
        dedicatedIndexBytes: null,
        status: 'dedicated-index-not-measured',
        structuralDatabaseIndexBytes: structuralIndexBytes
      },
      temporaryTasks: { bytes: files.temporaryTasks.bytes, basis: 'managed-files' },
      syncLog: { bytes: syncAllocatedBytes, basis: driver === 'local-json' ? 'utf8-journal' : 'allocated-table-bytes' },
      backups: { bytes: files.backups.bytes, basis: 'managed-files' },
      exports: { bytes: files.exports.bytes, basis: 'managed-files' }
    },
    policy: {
      automaticRecyclePurge: 'disabled',
      automaticVersionPrune: 'disabled',
      tombstoneExpiration: 'disabled',
      backupExpiration: 'not-configured'
    },
    interpretation:
      '内容字段和集合 logicalBytes 是 UTF-8 估算值；文件 bytes 与数据库页占用分别统计，不能相加解释为可立即释放的空间。'
  };
}

export function measureJsonStorage({ sourcePath, files, now } = {}) {
  const parsed = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const state = parsed.data ?? parsed;
  if (!Array.isArray(state.notes) || !Array.isArray(state.noteVersions))
    throw new Error('JSON 资料缺少笔记或版本集合，已停止统计。');
  const sync = parsed.sync ?? {};
  return commonReport(
    'local-json',
    { fileBytes: fs.statSync(sourcePath).size },
    summarizeCollections(state, { now }),
    files,
    {
      journalLogicalBytes: Object.keys(sync).length ? payloadBytes(sync) : 0,
      changes: sync.changes?.length ?? 0,
      tombstones: Object.keys(sync.tombstones ?? {}).length,
      tombstoneLogicalBytes: payloadBytes(sync.tombstones ?? {})
    }
  );
}

export function measureSqliteStorage({ sourcePath, files, now } = {}) {
  const snapshot = openReadonlySqliteSnapshot(sourcePath);
  const db = snapshot.database;
  try {
    const state = {};
    for (const row of db.prepare('SELECT collection, payload FROM entities').all()) {
      (state[row.collection] ??= []).push(JSON.parse(row.payload));
    }
    state.notes ??= [];
    state.noteVersions ??= [];
    const tablePages = {};
    for (const row of db.prepare('SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name').all())
      tablePages[row.name] = Number(row.bytes);
    const pageSize = db.prepare('PRAGMA page_size').get().page_size;
    const freePages = db.prepare('PRAGMA freelist_count').get().freelist_count;
    const syncTables = [
      'sync_base',
      'sync_outbox',
      'sync_recovery',
      'sync_conflicts',
      'sync_uploads',
      'local_revisions'
    ];
    const syncCounts = Object.fromEntries(
      syncTables.map(name => [name, db.prepare(`SELECT COUNT(*) AS count FROM ${name}`).get().count])
    );
    const outboxStates = Object.fromEntries(
      db
        .prepare('SELECT state, COUNT(*) AS count FROM sync_outbox GROUP BY state')
        .all()
        .map(row => [row.state, row.count])
    );
    const database = {
      fileBytes: fs.statSync(snapshot.databasePath).size,
      walBytes: fs.existsSync(`${snapshot.databasePath}-wal`) ? fs.statSync(`${snapshot.databasePath}-wal`).size : 0,
      freePageBytes: pageSize * freePages,
      tableAllocatedBytes: tablePages
    };
    return commonReport('sqlite', database, summarizeCollections(state, { now }), files, {
      tableCounts: syncCounts,
      outboxStates,
      tableAllocatedBytes: Object.fromEntries(syncTables.map(name => [name, tablePages[name] ?? 0]))
    });
  } finally {
    snapshot.close();
  }
}

export async function measurePostgresStorage({ databaseUrl, files } = {}) {
  const { createPrismaRuntime } = await import('../apps/api/src/infrastructure/prisma-client.js');
  const runtime = await createPrismaRuntime({ databaseUrl });
  await runtime.connect();
  try {
    const tableStats = {};
    for (const table of POSTGRES_TABLES) {
      const rows = await runtime.client.$queryRawUnsafe(`SELECT COUNT(*)::bigint AS count FROM "${table}"`);
      const sizes = await runtime.client.$queryRawUnsafe(
        `SELECT pg_total_relation_size('"${table}"')::bigint AS total, pg_indexes_size('"${table}"')::bigint AS indexes`
      );
      tableStats[table] = {
        count: Number(rows[0].count),
        totalBytes: Number(sizes[0].total),
        indexBytes: Number(sizes[0].indexes)
      };
    }
    const contentRows = await runtime.client.$queryRawUnsafe(`
      SELECT
        (SELECT COALESCE(SUM(octet_length("rawMarkdown")), 0) FROM "Note" WHERE "deletedAt" IS NULL)::bigint AS note_body,
        (SELECT COALESCE(SUM(octet_length("rawMarkdown")), 0) FROM "Note" WHERE "deletedAt" IS NOT NULL)::bigint AS recycled_note_body,
        (SELECT COALESCE(SUM(octet_length("content")), 0) FROM "NoteVersion")::bigint AS versions,
        (SELECT COALESCE(SUM(octet_length("quoteText")), 0) FROM "KnowledgeEvidence")::bigint AS evidence,
        (SELECT COALESCE(SUM(octet_length("quote")), 0) FROM "QuestionSource")::bigint AS question_sources
    `);
    const row = contentRows[0];
    const summary = {
      collections: Object.fromEntries(
        Object.entries(tableStats).map(([name, item]) => [name, { count: item.count, allocatedBytes: item.totalBytes }])
      ),
      content: {
        currentNoteBodyBytes: Number(row.note_body),
        recycledNoteBodyBytes: Number(row.recycled_note_body),
        noteVersionContentBytes: Number(row.versions),
        sourceQuoteBytes: Number(row.evidence) + Number(row.question_sources),
        sourceSnapshotTableBytes: [
          'KnowledgeEvidence',
          'QuestionSource',
          'AnalysisScopeSnapshot',
          'ContentAnnotation',
          'AnnotationRevision'
        ].reduce((sum, name) => sum + tableStats[name].totalBytes, 0)
      }
    };
    const database = {
      tableAllocatedBytes: Object.values(tableStats).reduce((sum, item) => sum + item.totalBytes, 0),
      indexAllocatedBytes: Object.values(tableStats).reduce((sum, item) => sum + item.indexBytes, 0),
      tables: tableStats
    };
    return commonReport('postgres', database, summary, files, {
      journalAllocatedBytes: tableStats.SyncJournal.totalBytes,
      journalRows: tableStats.SyncJournal.count
    });
  } finally {
    await runtime.disconnect();
  }
}
