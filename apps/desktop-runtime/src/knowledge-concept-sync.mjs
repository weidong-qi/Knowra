import { KNOWLEDGE_CONCEPT_COLLECTIONS, sameEntity } from '../../api/src/modules/sync/entity-contract.ts';
import { syncKey } from '../../api/src/modules/sync/journal.ts';
/** 本机冲突选择保留领域版本单调性；命令回执并集防止丢失已成功操作的幂等信息。 */
export function reconcileLocalConceptChoice(merged, chosen, remote) {
  for (const entry of chosen) {
    if (!KNOWLEDGE_CONCEPT_COLLECTIONS.includes(entry.collection) || !entry.value) continue;
    const authoritative = remote.get(syncKey(entry.collection, entry.id))?.value;
    const row = merged[entry.collection].find(row => row.id === entry.id);
    if (!row || !authoritative || sameEntity(entry.collection, row, authoritative)) continue;
    row.revision = Math.max(row.revision, authoritative.revision) + 1;
    row.updatedAt = new Date().toISOString();
    if (entry.collection === 'knowledgeConcepts') {
      const receipts = new Map(authoritative.operations.map(receipt => [receipt.id, receipt]));
      for (const receipt of row.operations) {
        if (receipts.has(receipt.id) && receipts.get(receipt.id).hash !== receipt.hash)
          throw new Error('概念命令回执冲突，请采用云端并保留本地恢复记录。');
        receipts.set(receipt.id, receipt);
      }
      row.operations = [...receipts.values()];
    }
  }
}
