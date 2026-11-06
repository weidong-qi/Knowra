import fs from 'node:fs';
import {
  LOCAL_DATA_COLLECTIONS,
  LOCAL_DATA_SCHEMA_VERSION,
  LOCAL_SNAPSHOT_VERSION
} from '../apps/api/src/infrastructure/local-data-schema.js';
import { LOCAL_DATABASE_VERSION } from '../apps/desktop-runtime/src/sqlite-schema.mjs';
import { inspectJsonPrivateSource, inspectSqlitePrivateSource } from './inline-annotation-retirement-private.mjs';

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

/** 同一原始文档/只读事务中读取；不经过普通存储加载、迁移或写回。 */
async function readSource(driver, source, includePrivate) {
  if (driver === 'local-json') {
    const parsed = parseJson(fs.readFileSync(source, 'utf8'));
    assertJsonVersion(parsed);
    const state = Object.hasOwn(parsed, 'data') ? parsed.data : parsed;
    assertJsonVersion(state);
    return includePrivate ? inspectJsonPrivateSource(parsed, state) : state;
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
      if (
        typeof row.collection !== 'string' ||
        typeof row.payload !== 'string' ||
        (includePrivate && !LOCAL_DATA_COLLECTIONS.includes(row.collection))
      )
        throw new Error('SQLite 核心实体格式无效。');
      if (!Object.hasOwn(state, row.collection)) state[row.collection] = [];
      state[row.collection].push(parseJson(row.payload));
    }
    return includePrivate ? { state, ...inspectSqlitePrivateSource(database, version) } : state;
  } finally {
    database.close();
  }
}

export const readRetirementSource = (driver, source) => readSource(driver, source, false);
export const readRetirementInspection = (driver, source) => readSource(driver, source, true);
export { assertJsonVersion };
