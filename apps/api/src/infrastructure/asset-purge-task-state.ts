import { AI_RECORD_KINDS, validateAiRecord, hashRecord, manifestHash } from '../modules/ai/record-contract.ts';
import { AI_SQL_DEFINITIONS, decodeAiRow } from '../modules/ai/record-sql-map.ts';
import {
  EXTRACTION_MOCK_PROFILE,
  taskKey,
  validateExtractionTask
} from '../modules/ai/knowledge-extraction-task-contract.ts';
import {
  knowledgeExtractionCommitKey,
  validateKnowledgeExtractionCommit
} from '../modules/ai/knowledge-extraction-commit-contract.ts';
import type { QuerySqlPort } from './core-operation-types.ts';
import type {
  LocalPurgeTaskDataStore,
  PurgeAiCollection,
  PurgeAiCollections,
  PurgeAiId,
  PurgeAiKind,
  PurgeAiRecord,
  PurgeComparable,
  PurgeComparisonField,
  PurgeExtension,
  PurgeExtensionKind,
  PurgeExtractionReceipt,
  PurgeSqlDefinition,
  PurgeTaskState,
  RawPurgeSqlRow
} from './purge-task-types.ts';

const boundary: PurgeComparisonField[] = ['ownerId', 'datasetId', 'datasetEpoch', 'spaceId'];
const same = <Left extends PurgeComparable>(
  left: Left | null | undefined,
  right: PurgeComparable | null | undefined,
  fields: readonly PurgeComparisonField[] = boundary
): left is Left => !!left && !!right && fields.every(key => left[key] === right[key]);
const invalid: () => never = () => {
  throw new Error('持久化任务引用或历史绑定无法核实。');
};
const empty = (): PurgeTaskState => ({
  ai: Object.fromEntries<PurgeAiRecord[]>(
    Object.values(AI_RECORD_KINDS).map(value => [value.collection, []])
  ) as PurgeAiCollections,
  tasks: [],
  receipts: []
});

function decodeExtension(row: RawPurgeSqlRow, kind: PurgeExtensionKind): PurgeExtension {
  const receipt = kind === 'receipts';
  const record: PurgeExtension = receipt
    ? validateKnowledgeExtractionCommit(JSON.parse(row.receipt_json as string))
    : validateExtractionTask(JSON.parse(row.descriptor_json as string));
  const key = receipt ? knowledgeExtractionCommitKey : taskKey;
  if (
    key(record) !== key({ ownerId: row.owner_id, datasetId: row.dataset_id, jobId: row.job_id }) ||
    (receipt &&
      Object.hasOwn(row, 'receipt_hash') &&
      row.receipt_hash !== (record as PurgeExtractionReceipt).receiptHash)
  )
    invalid();
  return record;
}

export function createLocalPurgeTaskReader(
  dataStore: LocalPurgeTaskDataStore | null | undefined
): () => PurgeTaskState {
  if (!dataStore) return empty;
  if (typeof dataStore.getPurgeTaskState === 'function') return () => dataStore.getPurgeTaskState!();
  if (typeof dataStore.readSync !== 'function') return invalid;
  return () => {
    if (
      dataStore.aiRuntimeError ||
      dataStore.knowledgeExtractionTaskStoreError ||
      dataStore.knowledgeExtractionCommitStoreError
    )
      invalid();
    return dataStore.readSync!(db => {
      const result = empty();
      for (const [kind, definition] of Object.entries(AI_SQL_DEFINITIONS) as [PurgeAiKind, PurgeSqlDefinition][]) {
        (result.ai as Record<PurgeAiCollection, PurgeAiRecord[]>)[
          AI_RECORD_KINDS[kind].collection as PurgeAiCollection
        ] = db
          .prepare(`SELECT * FROM ${definition.table}`)
          .all()
          .map(row => decodeAiRow(kind, row) as PurgeAiRecord);
      }
      for (const [kind, table, metadata] of [
        ['tasks', 'ai_knowledge_extraction_tasks', 'aiKnowledgeExtractionTasksVersion'],
        ['receipts', 'knowledge_extraction_commits', 'knowledgeExtractionCommitsVersion']
      ] as const) {
        if (db.prepare('SELECT value FROM metadata WHERE key = ?').get(metadata)?.value !== '1') invalid();
        (result as Record<PurgeExtensionKind, PurgeExtension[]>)[kind] = db
          .prepare(`SELECT * FROM ${table}`)
          .all()
          .map(row => decodeExtension(row, kind));
      }
      return result;
    });
  };
}

/** The supplied client is the existing owner-scoped transaction proxy, not another connection. */
export function createPostgresPurgeTaskReader(client: QuerySqlPort, ownerId: string) {
  return async () => {
    const result = empty();
    const sqlColumn = (field: string) =>
      (
        ({ allowedTools: 'allowed_tools_json', actionKinds: 'action_kinds_json', resultJson: 'result_json' }) as Record<
          string,
          string | undefined
        >
      )[field] ?? field.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    const requiredTables: [string, string[]][] = (Object.values(AI_SQL_DEFINITIONS) as PurgeSqlDefinition[]).map(
      value => [
        value.table,
        [
          ...value.fields.map(sqlColumn),
          ...(value.document ? [value.document] : []),
          ...(value.table === 'ai_context_manifests' ? ['manifest_hash'] : [])
        ]
      ]
    );
    requiredTables.push(
      ['ai_knowledge_extraction_tasks', ['owner_id', 'dataset_id', 'job_id', 'descriptor_json']],
      ['knowledge_extraction_commits', ['owner_id', 'dataset_id', 'job_id', 'receipt_json', 'receipt_hash']]
    );
    // Detect missing/unmigrated structures without a failing query that would abort the transaction.
    for (const [table, required] of requiredTables) {
      const rows = await client.$queryRawUnsafe(
        `SELECT c.relkind::text AS relkind, a.attname::text AS attname FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid
        WHERE c.oid = to_regclass($1) AND a.attnum > 0 AND NOT a.attisdropped`,
        table
      );
      if (
        !rows.length ||
        rows.some(row => row.relkind !== 'r') ||
        required.some(column => !rows.some(row => row.attname === column))
      )
        invalid();
    }
    for (const [kind, definition] of Object.entries(AI_SQL_DEFINITIONS) as [PurgeAiKind, PurgeSqlDefinition][]) {
      // Orphans have no recoverable owner boundary and must not silently disappear through an inner join.
      const selection = ['aiJobAttempt', 'aiUsageRecord'].includes(kind)
        ? `SELECT r.* FROM ${definition.table} r LEFT JOIN ai_jobs j ON j.job_id = r.job_id WHERE j.owner_id = $1 OR j.job_id IS NULL`
        : `SELECT * FROM ${definition.table} WHERE owner_id = $1`;
      (result.ai as Record<PurgeAiCollection, PurgeAiRecord[]>)[AI_RECORD_KINDS[kind].collection as PurgeAiCollection] =
        (await client.$queryRawUnsafe(selection, ownerId)).map(row => decodeAiRow(kind, row) as PurgeAiRecord);
    }
    for (const [kind, table] of [
      ['tasks', 'ai_knowledge_extraction_tasks'],
      ['receipts', 'knowledge_extraction_commits']
    ] as const) {
      (result as Record<PurgeExtensionKind, PurgeExtension[]>)[kind] = (
        await client.$queryRawUnsafe(`SELECT * FROM ${table} WHERE owner_id = $1`, ownerId)
      ).map(row => decodeExtension(row, kind));
    }
    return result;
  };
}

/** 识别笔记来源和无知识库来源的翻译；未支持的资产范围或任务仍无法证明不存在引用。 */
export function verifyPurgeTaskState({ ai, tasks, receipts }: PurgeTaskState) {
  const maps = {} as { [C in PurgeAiCollection]: Map<string, PurgeAiCollections[C][number]> };
  for (const [kind, { collection, id }] of Object.entries(AI_RECORD_KINDS) as [
    PurgeAiKind,
    { collection: PurgeAiCollection; id: PurgeAiId }
  ][]) {
    if (!Array.isArray(ai?.[collection])) invalid();
    (maps as Record<PurgeAiCollection, Map<string, PurgeAiRecord>>)[collection] = new Map(
      ai[collection].map(record => {
        validateAiRecord(kind, record);
        return [(record as Partial<Record<PurgeAiId, string>>)[id]!, record] as const;
      })
    );
    if (maps[collection].size !== ai[collection].length) invalid();
  }
  for (const scope of maps.scopeSnapshots.values()) if (scope.scopeKind === 'knowledgeItems') invalid();
  for (const manifest of maps.contextManifests.values()) {
    const scope = maps.scopeSnapshots.get(manifest.scopeSnapshotId);
    if (
      !same(scope, manifest) ||
      manifest.scopeHash !== scope.scopeHash ||
      manifest.scopeKind !== scope.scopeKind ||
      manifest.sources.some(
        source =>
          scope.excludedSourceIds.includes(source.sourceId) ||
          !scope.allowedSources.some(allowed => hashRecord(source) === hashRecord(allowed))
      )
    )
      invalid();
  }
  for (const grant of maps.grants.values()) {
    const scope = maps.scopeSnapshots.get(grant.scopeSnapshotId);
    if (!same(scope, grant) || grant.scopeHash !== scope.scopeHash) invalid();
  }
  for (const job of maps.jobs.values()) {
    const manifest = maps.contextManifests.get(job.manifestId),
      grant = maps.grants.get(job.grantId);
    if (
      !['answer', 'translation', 'knowledgeExtraction', 'noteActionPlan'].includes(job.jobKind) ||
      !same(manifest, job) ||
      !same(grant, job) ||
      manifest.scopeSnapshotId !== grant.scopeSnapshotId ||
      manifestHash(manifest) !== job.manifestHash ||
      manifest.recipient !== job.provider ||
      (job.parentJobId && !same(maps.jobs.get(job.parentJobId), job))
    )
      invalid();
    if (job.jobKind === 'translation') {
      const scope = maps.scopeSnapshots.get(manifest.scopeSnapshotId);
      // 翻译只保存选区摘要，不能把携带知识库范围或工具授权的记录当作无资产引用。
      if (
        !scope ||
        scope.scopeKind !== 'empty' ||
        scope.allowedSources.length ||
        scope.allowedFolderIds.length ||
        scope.excludedSourceIds.length ||
        manifest.sources.length ||
        manifest.excludedSourceIds.length ||
        grant.allowedTools.length ||
        grant.actionKinds.length ||
        grant.maxTargets !== 0
      )
        invalid();
    }
    if (job.acceptedAttemptId) {
      const attempt = maps.attempts.get(job.acceptedAttemptId);
      if (!attempt || attempt.jobId !== job.jobId) invalid();
    }
  }
  const ordinals = new Set<string>(),
    generations = new Set<string>(),
    usageAttempts = new Set<string>();
  for (const attempt of maps.attempts.values()) {
    const ordinal = JSON.stringify([attempt.jobId, attempt.ordinal]),
      generation = JSON.stringify([attempt.jobId, attempt.leaseGeneration]);
    if (!maps.jobs.has(attempt.jobId) || ordinals.has(ordinal) || generations.has(generation)) invalid();
    ordinals.add(ordinal);
    generations.add(generation);
  }
  for (const usage of maps.usageRecords.values()) {
    if (
      !maps.jobs.has(usage.jobId) ||
      maps.attempts.get(usage.attemptId)?.jobId !== usage.jobId ||
      usageAttempts.has(usage.attemptId)
    )
      invalid();
    usageAttempts.add(usage.attemptId);
  }
  if (!Array.isArray(tasks) || !Array.isArray(receipts)) invalid();
  const receiptsByKey = new Map(
    receipts.map(
      receipt => [knowledgeExtractionCommitKey(validateKnowledgeExtractionCommit(receipt)), receipt] as const
    )
  );
  if (receiptsByKey.size !== receipts.length || new Set(tasks.map(taskKey)).size !== tasks.length) invalid();
  for (const task of tasks) {
    validateExtractionTask(task);
    const job = maps.jobs.get(task.jobId),
      receipt = receiptsByKey.get(taskKey(task));
    if (
      !same(job, task, [...boundary, 'jobId', 'inputHash', 'createdAt']) ||
      job.jobKind !== 'knowledgeExtraction' ||
      job.promptVersion !== 'knowledge-extraction-v1' ||
      job.resultSchemaVersion !== 'knowledge-extraction-v1' ||
      job.modelId !== EXTRACTION_MOCK_PROFILE.modelId ||
      job.credentialRef !== EXTRACTION_MOCK_PROFILE.credentialRef ||
      job.provider !== 'deepseek' ||
      job.resultJson ||
      (job.status === 'succeeded' && !receipt) ||
      (receipt && !same(receipt, task, [...boundary, 'scopeId', 'inputHash', 'executionMode']))
    )
      invalid();
  }
  for (const receipt of receipts) {
    const job = maps.jobs.get(receipt.jobId);
    // A completed core receipt is independent history; private jobs may have legitimately been retired.
    if (!job) continue;
    if (
      !same(receipt, job, [
        ...boundary,
        'requestId',
        'inputHash',
        'outputHash',
        'modelId',
        'promptVersion',
        'resultSchemaVersion'
      ]) ||
      job.jobKind !== 'knowledgeExtraction' ||
      job.status !== 'succeeded' ||
      job.phase !== 'finished' ||
      job.acceptedAttemptId !== receipt.attemptId ||
      job.resultJson
    )
      invalid();
  }
}
