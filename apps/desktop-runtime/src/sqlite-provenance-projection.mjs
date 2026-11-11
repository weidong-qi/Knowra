import { backfillKnowledgeArtifactProvenance } from '../../api/src/infrastructure/migration/knowledge-artifact-provenance-backfill.ts';
import { knowledgeExtractionCommitKey } from '../../api/src/modules/ai/knowledge-extraction-commit-contract.ts';

/** 启动与只读恢复预检共享的投影；只修改调用者提供的内存 state。 */
export function projectSqliteProvenance(db, state, { hasFact = () => false, initialState = state } = {}) {
  const receiptVersion = db
    .prepare("SELECT value FROM metadata WHERE key = 'knowledgeExtractionCommitsVersion'")
    .get()?.value;
  const receiptTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'knowledge_extraction_commits'")
    .get();
  let receipts = [];
  if (receiptVersion === '1' && receiptTable) {
    try {
      receipts = db
        .prepare('SELECT * FROM knowledge_extraction_commits')
        .all()
        .map(row => {
          try {
            const record = JSON.parse(row.receipt_json);
            return knowledgeExtractionCommitKey(record) ===
              knowledgeExtractionCommitKey({ ownerId: row.owner_id, datasetId: row.dataset_id, jobId: row.job_id })
              ? record
              : null;
          } catch {
            return null;
          }
        });
    } catch {
      /* 可选旧 receipt 扩展独立隔离。 */
    }
  }
  const deleted = new Set();
  for (const row of db.prepare("SELECT collection, id, server_revision FROM sync_base WHERE payload = 'null'").all()) {
    // 无绑定旧基线仍保守阻止来源回填；它本身不构成可信的持久删除事实。
    if (row.server_revision === null) continue;
    if (!Number.isSafeInteger(row.server_revision) || row.server_revision < 1)
      throw new Error('同步基线删除修订无效，已停止来源回填。');
    deleted.add(JSON.stringify([row.collection, row.id]));
  }
  const migration = backfillKnowledgeArtifactProvenance(state, {
    receipts,
    getTombstone: (collection, id) => deleted.has(JSON.stringify([collection, id])) || hasFact(collection, id)
  });
  if (
    state.knowledgeArtifactProvenance.some(
      record =>
        !initialState.knowledgeArtifactProvenance.some(old => old.id === record.id) &&
        deleted.has(JSON.stringify(['knowledgeArtifactProvenance', record.id]))
    )
  ) {
    throw new Error('已永久删除的来源记录不能通过迁移重建。');
  }
  return { migration, deleted };
}
