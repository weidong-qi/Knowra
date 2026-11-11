import { createHash } from 'node:crypto';
import { LOCAL_DATA_COLLECTIONS } from '../../api/src/infrastructure/local-data-schema.ts';

export const DELETION_FACTS_VERSION = '1';
export const DELETION_FACTS_DDL = `CREATE TABLE deletion_facts (collection TEXT NOT NULL, entity_id TEXT NOT NULL,
  record_hash TEXT NOT NULL, record_json TEXT NOT NULL, PRIMARY KEY(collection,entity_id))`;
export const FACT_METADATA_KEYS = ['deletionFactsVersion', 'deletionFactsScope', 'deletionFactsCoverage'];
export function invalidFacts(message = '本地删除事实格式不兼容或已损坏，已停止写入。') {
  return Object.assign(new Error(message), { code: 'LOCAL_DELETION_FACT_INVALID' });
}
const check = value => {
  if (!value) throw invalidFacts();
};
const text = value => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 2048;
// 实体 ID 沿用 local-data-schema 的非空字符串域；校验时不改写原始身份。
const entityId = value => typeof value === 'string' && value.trim().length > 0;
const instant = value =>
  typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const keys = (value, expected) =>
  check(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join(',') === [...expected].sort().join(',')
  );
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, canonical(value[key])])
    );
  return value;
}
export const factHash = value =>
  createHash('sha256')
    .update('knowra-deletion-fact-v1\n')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
export function serverOrigin(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.origin === value && !url.username && !url.password
      ? value
      : null;
  } catch {
    return null;
  }
}
export function validateFact(record, scope) {
  keys(record, [
    'schemaVersion',
    'collection',
    'entityId',
    'scopeId',
    'ownerId',
    'observationId',
    'observedAt',
    'deletedAt',
    'source'
  ]);
  check(record.schemaVersion === 1 && LOCAL_DATA_COLLECTIONS.includes(record.collection) && entityId(record.entityId));
  check(record.scopeId === scope.scopeId && record.ownerId === scope.ownerId && instant(record.observedAt));
  const source = record.source;
  if (source?.kind === 'local-commit') {
    keys(source, ['kind', 'datasetId', 'operationId']);
    check(text(source.datasetId) && text(source.operationId) && record.deletedAt === record.observedAt);
  } else {
    const alias = source.kind === 'remote-version-alias';
    keys(source, [
      'kind',
      'serverOrigin',
      'ownerId',
      'epoch',
      'revision',
      ...(alias ? ['canonicalVersionId', 'noteId', 'contentHash'] : [])
    ]);
    check(
      ['remote-delete', 'remote-version-alias', 'legacy-remote-base', 'legacy-remote-conflict'].includes(source.kind)
    );
    if (alias)
      check(
        record.collection === 'noteVersions' &&
          entityId(source.canonicalVersionId) &&
          source.canonicalVersionId !== record.entityId &&
          entityId(source.noteId) &&
          typeof source.contentHash === 'string' &&
          /^[a-f0-9]{64}$/.test(source.contentHash)
      );
    check(
      serverOrigin(source.serverOrigin) &&
        text(source.ownerId) &&
        Number.isSafeInteger(source.revision) &&
        source.revision > 0
    );
    check(
      (source.epoch === null || text(source.epoch)) &&
        (!['remote-delete', 'remote-version-alias'].includes(source.kind) || source.epoch !== null) &&
        record.deletedAt === null
    );
  }
  check(record.observationId === factHash([record.scopeId, record.collection, record.entityId, source]));
  return record;
}
export function validateSqliteDeletionFacts(db) {
  const table = db.prepare("SELECT type,sql FROM sqlite_master WHERE name='deletion_facts'").get();
  const hasMetadata = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='metadata'").get();
  const metadata = hasMetadata
    ? db.prepare("SELECT key,value FROM metadata WHERE key LIKE 'deletionFacts%'").all()
    : [];
  if (!table && !metadata.length) return null;
  check(
    table?.type === 'table' && metadata.length === 3 && metadata.every(row => FACT_METADATA_KEYS.includes(row.key))
  );
  // xinfo 不显示 CHECK/外键/冲突策略；额外约束可能丢弃事实或改变精确 ID 语义。
  const normalizedSql = sql =>
    sql
      .trim()
      .replace(/;$/, '')
      .replace(/\s+/g, ' ')
      .replace(/\s*([(),])\s*/g, '$1')
      .toUpperCase();
  check(normalizedSql(table.sql) === normalizedSql(DELETION_FACTS_DDL));
  const map = Object.fromEntries(metadata.map(row => [row.key, row.value]));
  check(map.deletionFactsVersion === DELETION_FACTS_VERSION);
  let scope, coverage;
  try {
    scope = JSON.parse(map.deletionFactsScope);
    coverage = JSON.parse(map.deletionFactsCoverage);
  } catch {
    throw invalidFacts();
  }
  keys(scope, ['schemaVersion', 'scopeId', 'ownerId']);
  check(scope.schemaVersion === 1 && text(scope.scopeId) && scope.ownerId === 'demo');
  keys(coverage, ['schemaVersion', 'recordedSince', 'legacyHistory']);
  check(
    coverage.schemaVersion === 1 &&
      instant(coverage.recordedSince) &&
      ['incomplete', 'none-new-store'].includes(coverage.legacyHistory)
  );
  const expected = [
    ['collection', 1],
    ['entity_id', 2],
    ['record_hash', 0],
    ['record_json', 0]
  ];
  const columns = db.prepare('PRAGMA table_xinfo(deletion_facts)').all();
  check(
    columns.length === expected.length &&
      expected.every(([name, pk], i) => {
        const col = columns[i];
        return (
          col.name === name &&
          col.type.toUpperCase() === 'TEXT' &&
          col.notnull === 1 &&
          col.pk === pk &&
          col.dflt_value === null &&
          col.hidden === 0
        );
      })
  );
  const indexes = db.prepare('PRAGMA index_list(deletion_facts)').all();
  check(indexes.length === 1 && indexes[0].origin === 'pk' && indexes[0].unique === 1 && indexes[0].partial === 0);
  check(
    db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='deletion_facts'").all().length === 0
  );
  const indexColumns = db.prepare(`PRAGMA index_info('${indexes[0].name.replaceAll("'", "''")}')`).all();
  check(indexColumns.map(col => col.name).join(',') === 'collection,entity_id');
  for (const row of db.prepare('SELECT * FROM deletion_facts').all()) {
    let record;
    try {
      record = JSON.parse(row.record_json);
    } catch {
      throw invalidFacts();
    }
    validateFact(record, scope);
    if (record.source.kind !== 'local-commit') {
      let origin, owner;
      try {
        origin = JSON.parse(db.prepare("SELECT value FROM metadata WHERE key='sync:serverUrl'").get()?.value ?? 'null');
        owner = JSON.parse(db.prepare("SELECT value FROM metadata WHERE key='sync:ownerId'").get()?.value ?? 'null');
      } catch {
        throw invalidFacts();
      }
      check(record.source.serverOrigin === origin && record.source.ownerId === owner);
    }
    check(
      record.collection === row.collection && record.entityId === row.entity_id && factHash(record) === row.record_hash
    );
  }
  return { scope, coverage };
}
