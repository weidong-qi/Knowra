import fs from 'node:fs';
import path from 'node:path';
import { isDirectExecution } from './cli-entry.mjs';
import {
  ANNOTATION_RETENTION_REFERENCE_COLLECTIONS,
  DELETED_ANNOTATION_RETENTION_MS,
  referencedAnnotationRevisions
} from '../apps/api/src/modules/knowledge/domain/history-retention.ts';
import { createNoteVersionReferenceIndex } from '../apps/api/src/modules/knowledge/domain/note-version-references.ts';
import { LOCAL_DATA_SCHEMA_VERSION, LOCAL_SNAPSHOT_VERSION } from '../apps/api/src/infrastructure/local-data-schema.js';
import { LOCAL_DATABASE_VERSION } from '../apps/desktop-runtime/src/sqlite-schema.mjs';

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('源数据不是有效 JSON，未生成核对结论。');
  }
}

function assertBusinessSchema(version) {
  if (version !== undefined && (!Number.isInteger(version) || version < 1 || version > LOCAL_DATA_SCHEMA_VERSION))
    throw new Error('业务存储 schema 版本不受支持，未生成核对结论。');
}

function assertJsonVersion(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('JSON 存储文档格式无效。');
  if (document.version !== undefined && ![LOCAL_SNAPSHOT_VERSION, 'v2-local-json'].includes(document.version))
    throw new Error('JSON 快照版本不受支持，未生成核对结论。');
  assertBusinessSchema(document.schemaVersion);
}

/** 只统计核心实体，不加载普通存储，避免触发迁移、自动回收或写回。 */
export async function readRetirementSource(driver, source) {
  if (driver === 'local-json') {
    const parsed = parseJson(fs.readFileSync(source, 'utf8'));
    assertJsonVersion(parsed);
    if (!Object.hasOwn(parsed, 'data')) return parsed;
    assertJsonVersion(parsed.data);
    return parsed.data;
  }
  if (driver !== 'sqlite') throw new Error('driver 只支持 local-json 或 sqlite。');
  const { DatabaseSync } = await import('node:sqlite');
  const database = new DatabaseSync(source, { readOnly: true });
  try {
    database.exec('BEGIN');
    const version = database.prepare('PRAGMA user_version').get().user_version;
    if (!Number.isInteger(version) || version < 1 || version > LOCAL_DATABASE_VERSION)
      throw new Error('SQLite 数据库版本不受支持，未生成核对结论。');
    const marker = database.prepare("SELECT value FROM metadata WHERE key = 'localDataSchemaVersion'").get()?.value;
    if (marker !== undefined && (typeof marker !== 'string' || !/^[1-9][0-9]*$/.test(marker)))
      throw new Error('SQLite 业务 schema 标记无效，未生成核对结论。');
    // 与桌面存储读取规则一致：没有业务 schema 标记的历史库按 schema6 解释，不写回标记。
    const schemaVersion = marker === undefined ? 6 : Number(marker);
    assertBusinessSchema(schemaVersion);
    const state = Object.assign(Object.create(null), { schemaVersion, notes: [], contentAnnotations: [] });
    for (const row of database.prepare('SELECT collection, payload FROM entities').all()) {
      if (typeof row.collection !== 'string' || typeof row.payload !== 'string')
        throw new Error('SQLite 核心实体格式无效。');
      if (!Object.hasOwn(state, row.collection)) state[row.collection] = [];
      state[row.collection].push(parseJson(row.payload));
    }
    return state;
  } finally {
    database.close();
  }
}

const counts = values => {
  const result = Object.create(null);
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return result;
};

/** 这是旧行存量检查，不是删除计划，也不代表存储迁移已可部署。 */
export function inspectAnnotationRetirement(state, now = Date.now()) {
  assertJsonVersion(state);
  if (!Array.isArray(state?.notes) || !Array.isArray(state?.contentAnnotations) || !Number.isFinite(now))
    throw new Error('核对需要 notes、contentAnnotations 集合及有效时间。');
  const schemas = new Set([1, 2, 3]);
  const lifecycle = row => row.lifecycleStatus ?? (row.status === 'archived' ? 'archived' : 'active');
  const annotationIds = new Set();
  for (const row of state.contentAnnotations) {
    if (
      !row ||
      typeof row.id !== 'string' ||
      !row.id ||
      annotationIds.has(row.id) ||
      !schemas.has(row.schemaVersion ?? 1) ||
      !['active', 'archived', 'deleted'].includes(lifecycle(row))
    )
      throw new Error('重点身份或格式版本无效，未生成核对结论。');
    annotationIds.add(row.id);
  }
  const legacy = state.contentAnnotations.filter(row => (row.schemaVersion ?? 1) !== 3);
  const ids = new Set(legacy.map(row => row.id));
  const childRecords = (collection, parentKey) => {
    const records = state[collection] ?? [];
    if (!Array.isArray(records)) throw new Error('重点关联集合格式无效。');
    const children = records.filter(row => row && ids.has(row[parentKey]));
    if (children.some(row => typeof row.id !== 'string' || !row.id))
      throw new Error('重点关联记录缺少有效身份，未生成核对结论。');
    return children;
  };
  const revisions = childRecords('annotationRevisions', 'annotationId');
  const exclusions = childRecords('annotationExclusions', 'parentAnnotationId');
  const revisionIds = new Set(revisions.map(row => row.id));
  const targets = [...new Map([...legacy, ...revisions, ...exclusions].map(row => [row.id, row])).values()];
  const referencesByCollection = Object.create(null);
  for (const collection of ANNOTATION_RETENTION_REFERENCE_COLLECTIONS) {
    const records = state[collection] ?? [];
    if (!Array.isArray(records)) throw new Error('重点引用集合格式无效。');
    // 与回收规划共用 token 索引；子记录被引用也会保护其父重点。
    // 每个集合统计它提及的不同关联记录数，不重复计算同一目标的多次引用。
    const referenced = createNoteVersionReferenceIndex({ [collection]: records });
    // 只给该外部集合建索引，不让重点自己的当前修订成为外部保留根。
    const revisionReferenced = referencedAnnotationRevisions({ annotationRevisions: revisions }, records);
    const total = targets.filter(row => referenced(row) || (revisionIds.has(row.id) && revisionReferenced(row))).length;
    if (total) referencesByCollection[collection] = total;
  }
  const retentionEnds = [];
  let invalidDeletedAt = 0;
  for (const row of legacy.filter(row => lifecycle(row) === 'deleted')) {
    const deletedAt = typeof row.deletedAt === 'string' ? Date.parse(row.deletedAt) : NaN;
    if (!Number.isFinite(deletedAt)) invalidDeletedAt++;
    else retentionEnds.push(deletedAt + DELETED_ANNOTATION_RETENTION_MS);
  }
  const notes = new Map(state.notes.map(note => [note.id, note]));
  return {
    scope: 'core-entities-only',
    status: legacy.length ? 'legacy-rows-remain' : 'no-legacy-rows',
    generatedAt: new Date(now).toISOString(),
    schemas: counts(state.contentAnnotations.map(row => String(row.schemaVersion ?? 1))),
    legacy: {
      total: legacy.length,
      lifecycle: counts(legacy.map(lifecycle)),
      inDeletedNotes: legacy.filter(row => notes.get(row.noteId)?.deleted === true).length,
      missingParentNotes: legacy.filter(row => !notes.has(row.noteId)).length,
      revisions: revisions.length,
      exclusions: exclusions.length,
      referencesByCollection,
      retentionNotDue: retentionEnds.filter(at => at > now).length,
      retentionElapsed: retentionEnds.filter(at => at <= now).length,
      invalidDeletedAt,
      latestRetentionEnd: retentionEnds.length
        ? new Date(retentionEnds.reduce((a, b) => Math.max(a, b))).toISOString()
        : null
    }
  };
}

async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    console.log(
      '用法：node scripts/inspect-inline-annotation-retirement.mjs --driver=local-json|sqlite --source=文件\n只读核对核心实体，不输出正文、标题、对象 ID 或执行删除；旧行仍在时退出码为 2。即使留存期已过也不会假定旧行已回收。私有任务、待同步请求和旧备份的兼容性须另行核对。'
    );
    return;
  }
  const options = {};
  for (const argument of args) {
    const match = /^--(driver|source)=(.+)$/.exec(argument);
    if (!match || options[match[1]]) throw new Error('参数无效，请使用 --help 查看用法。');
    options[match[1]] = match[2];
  }
  if (!options.driver || !options.source) throw new Error('必须明确指定 --driver 和 --source。');
  const state = await readRetirementSource(options.driver, path.resolve(options.source));
  const report = inspectAnnotationRetirement(state);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.legacy.total ? 2 : 0;
}

if (isDirectExecution(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
