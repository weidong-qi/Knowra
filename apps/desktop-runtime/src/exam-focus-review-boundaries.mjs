import { requestHash, syncKey } from '../../api/src/modules/sync/journal.ts';
import { sameEntity, syncReferencesFor, WRITABLE_COLLECTIONS } from '../../api/src/modules/sync/entity-contract.ts';
import {
  assertLearningObjectiveConfirmable,
  assertKnowledgeItemConfirmable
} from '../../api/src/modules/knowledge/application/formal-asset-validation.js';
import {
  createEmptyLocalState,
  createPersistedLocalDocument,
  validatePersistedLocalState
} from '../../api/src/infrastructure/local-data-schema.js';
import { readMeta, writeMeta } from './sync-state.mjs';

const QUEUE = 'examFocusReviewQueue';
const UPLOAD = 'examFocusReviewUpload';
const fields = (value, names) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...names].sort().join(',');
const invalid = () =>
  Object.assign(new Error('考点审阅依赖待同步记录损坏，已停止同步；请保留本地资料并导出备份。'), {
    code: 'LOCAL_EXAM_FOCUS_REVIEW_INVALID'
  });
const key = entry => `${entry.operationId}:${entry.focusId}`;
const queueValue = db => {
  const row = db.prepare('SELECT value FROM metadata WHERE key = ?').get(`sync:${QUEUE}`);
  try {
    return row ? JSON.parse(row.value) : [];
  } catch {
    throw invalid();
  }
};

/** 只接受当前本地业务事务登记的确认；不从未登记的历史 outbox 推测人工审阅。 */
export function readExamFocusReviewBoundaries(db) {
  const entries = queueValue(db);
  if (!Array.isArray(entries)) throw invalid();
  const seen = new Set();
  const result = entries.map(entry => {
    if (
      !fields(entry, ['operationId', 'sequence', 'focusId', 'datasetEpoch', 'parents', 'contextHash']) ||
      typeof entry.operationId !== 'string' ||
      !entry.operationId ||
      typeof entry.focusId !== 'string' ||
      !entry.focusId ||
      !Number.isSafeInteger(entry.sequence) ||
      entry.sequence < 1 ||
      !(entry.datasetEpoch === null || typeof entry.datasetEpoch === 'string') ||
      !Array.isArray(entry.parents) ||
      !entry.parents.length ||
      entry.parents.length > 1000 ||
      requestHash(entry.parents) !== entry.contextHash ||
      seen.has(key(entry))
    )
      throw invalid();
    seen.add(key(entry));
    const row = db
      .prepare('SELECT operation_id, state, changes FROM sync_outbox WHERE sequence = ?')
      .get(entry.sequence);
    if (!row || row.operation_id !== entry.operationId || row.state === 'acknowledged') throw invalid();
    let changes;
    try {
      changes = JSON.parse(row.changes);
    } catch {
      throw invalid();
    }
    if (!Array.isArray(changes)) throw invalid();
    const change = changes.find(item => item.collection === 'examFocuses' && item.entityId === entry.focusId);
    if (
      change?.before?.reviewStatus !== 'candidate' ||
      change?.value?.reviewStatus !== 'confirmed' ||
      change.value.deletedAt
    )
      throw invalid();
    const state = createEmptyLocalState();
    const ids = new Set();
    for (const parent of entry.parents) {
      if (
        !fields(parent, ['collection', 'id', 'baseRevision', 'value']) ||
        !WRITABLE_COLLECTIONS.includes(parent.collection) ||
        typeof parent.id !== 'string' ||
        !parent.id ||
        parent.value?.id !== parent.id ||
        !(parent.baseRevision === null || (Number.isSafeInteger(parent.baseRevision) && parent.baseRevision > 0)) ||
        ids.has(syncKey(parent.collection, parent.id))
      )
        throw invalid();
      ids.add(syncKey(parent.collection, parent.id));
      state[parent.collection].push(structuredClone(parent.value));
    }
    state.examFocuses.push(structuredClone(change.value));
    try {
      const valid = validatePersistedLocalState(createPersistedLocalDocument(state));
      const objective = valid.learningObjectives.find(item => item.id === change.value.learningObjectiveId);
      const profile = valid.examProfiles.find(item => item.id === change.value.examProfileId);
      if (
        !objective ||
        objective.deletedAt ||
        objective.reviewStatus !== 'confirmed' ||
        !profile ||
        profile.deletedAt ||
        profile.archivedAt
      )
        throw invalid();
      assertLearningObjectiveConfirmable(
        objective,
        valid.knowledgeItems.find(item => item.id === objective.knowledgeItemId)
      );
    } catch {
      throw invalid();
    }
    return { ...entry, value: change.value };
  });
  const binding = readMeta(db, UPLOAD);
  if (binding !== null) {
    const frozen = readMeta(db, 'entityUpload');
    if (
      !fields(binding, ['operationId', 'boundaries']) ||
      typeof binding.operationId !== 'string' ||
      !binding.operationId ||
      !Array.isArray(binding.boundaries) ||
      !binding.boundaries.length ||
      (frozen && frozen.operationId !== binding.operationId) ||
      new Set(binding.boundaries).size !== binding.boundaries.length ||
      binding.boundaries.some(id => !result.some(entry => key(entry) === id))
    )
      throw invalid();
  }
  return result;
}

export function recordExamFocusReviewBoundaries(db, changes, operationId, origin, state) {
  if (origin !== 'local-business') return;
  const confirmed = changes.filter(
    change =>
      change.collection === 'examFocuses' &&
      change.before?.reviewStatus === 'candidate' &&
      change.value?.reviewStatus === 'confirmed' &&
      !change.value.deletedAt
  );
  if (!confirmed.length) return;
  const row = db.prepare('SELECT sequence FROM sync_outbox WHERE operation_id = ?').get(operationId);
  if (!row) throw invalid();
  const binding = readMeta(db, UPLOAD);
  const previous = readExamFocusReviewBoundaries(db).filter(
    entry => binding?.boundaries?.includes(key(entry)) || !confirmed.some(change => change.entityId === entry.focusId)
  );
  const entries = confirmed.map(change => {
    const pending = [
      { collection: 'learningObjectives', id: change.value.learningObjectiveId },
      { collection: 'examProfiles', id: change.value.examProfileId }
    ];
    const parents = new Map();
    for (let index = 0; index < pending.length; index++) {
      const ref = pending[index];
      const id = syncKey(ref.collection, ref.id);
      if (parents.has(id)) continue;
      const value = state[ref.collection]?.find(item => item.id === ref.id);
      if (!value) throw invalid();
      const base = db
        .prepare('SELECT server_revision FROM sync_base WHERE collection = ? AND id = ?')
        .get(ref.collection, ref.id);
      parents.set(id, { ...ref, baseRevision: base?.server_revision ?? null, value: structuredClone(value) });
      pending.push(...syncReferencesFor(ref.collection, value, state));
      if (parents.size > 1000) throw invalid();
    }
    const values = [...parents.values()];
    return {
      operationId,
      sequence: row.sequence,
      focusId: change.entityId,
      datasetEpoch: readMeta(db, 'epoch'),
      parents: values,
      contextHash: requestHash(values)
    };
  });
  writeMeta(db, QUEUE, [...previous.map(({ value, ...entry }) => entry), ...entries]);
  readExamFocusReviewBoundaries(db);
}

export function discardExamFocusReviewBoundaries(db, focusIds) {
  const entries = readExamFocusReviewBoundaries(db).filter(entry => !focusIds.has(entry.focusId));
  writeMeta(db, UPLOAD, null);
  writeMeta(
    db,
    QUEUE,
    entries.map(({ value, ...entry }) => entry)
  );
}
export function bindExamFocusReviewUpload(db, operationId, entries) {
  writeMeta(db, UPLOAD, entries.length ? { operationId, boundaries: entries.map(key) } : null);
}
export function acknowledgeExamFocusReviewUpload(db, operation, result) {
  const entries = readExamFocusReviewBoundaries(db);
  const binding = readMeta(db, UPLOAD);
  if (binding && binding.operationId !== operation.operationId) throw invalid();
  const accepted = result.status === 'accepted';
  if (accepted && binding) {
    const frozen = readMeta(db, 'entityUpload');
    if (!frozen || requestHash(frozen) !== requestHash(operation)) throw invalid();
    const reviewed = entries.filter(entry => binding.boundaries.includes(key(entry)));
    // 仅权威接纳本机更早审阅前像，才推进同一旧基线上的后继审阅期待版本。
    for (const entry of entries.filter(entry => !binding.boundaries.includes(key(entry)))) {
      for (const parent of entry.parents) {
        const submitted = operation.changes.find(
          change => change.collection === parent.collection && change.id === parent.id
        );
        const acknowledged = result.entries?.find(
          change => change.collection === parent.collection && change.id === parent.id
        );
        if (
          !submitted ||
          !acknowledged ||
          !Number.isSafeInteger(acknowledged.revision) ||
          acknowledged.revision < 1 ||
          submitted.baseRevision !== parent.baseRevision ||
          !sameEntity(parent.collection, submitted.value, acknowledged.value)
        )
          continue;
        const causal = reviewed.some(
          previous =>
            previous.sequence < entry.sequence &&
            (previous.datasetEpoch === entry.datasetEpoch ||
              (previous.datasetEpoch === null && entry.datasetEpoch === operation.datasetEpoch)) &&
            previous.parents.some(
              old =>
                old.collection === parent.collection &&
                old.id === parent.id &&
                old.baseRevision === parent.baseRevision &&
                sameEntity(parent.collection, old.value, submitted.value)
            )
        );
        if (causal) parent.baseRevision = acknowledged.revision;
      }
      entry.contextHash = requestHash(entry.parents);
    }
  }
  writeMeta(db, UPLOAD, null);
  if (accepted && binding)
    writeMeta(
      db,
      QUEUE,
      entries.filter(entry => !binding.boundaries.includes(key(entry))).map(({ value, ...entry }) => entry)
    );
}
export const clearExamFocusReviewUpload = db => writeMeta(db, UPLOAD, null);

/** 前像只用于一次合规交付；任何已变化的权威依赖先进入可恢复冲突。 */
export function prepareExamFocusReviewChanges(entries, changes, state, base, epoch) {
  const selected = [];
  const parents = new Map();
  const blocked = new Set();
  for (const entry of new Map(entries.map(entry => [entry.focusId, entry])).values()) {
    const current = state.examFocuses.find(item => item.id === entry.focusId);
    if (
      !current ||
      current.deletedAt ||
      current.reviewStatus !== 'confirmed' ||
      base.get(syncKey('examFocuses', entry.focusId))?.value?.reviewStatus === 'confirmed'
    )
      continue;
    for (const parent of entry.parents) {
      const remote = base.get(syncKey(parent.collection, parent.id));
      if (
        (entry.datasetEpoch && entry.datasetEpoch !== epoch) ||
        ((remote?.revision ?? null) !== parent.baseRevision &&
          !sameEntity(parent.collection, remote?.value, parent.value))
      )
        return { conflict: entry };
    }
    const objective = state.learningObjectives.find(item => item.id === current.learningObjectiveId);
    const profile = state.examProfiles.find(item => item.id === current.examProfileId);
    let currentlyConfirmable = false;
    if (
      objective &&
      !objective.deletedAt &&
      objective.reviewStatus === 'confirmed' &&
      profile &&
      !profile.deletedAt &&
      !profile.archivedAt
    )
      try {
        const knowledge = state.knowledgeItems.find(item => item.id === objective.knowledgeItemId);
        assertLearningObjectiveConfirmable(objective, knowledge);
        assertKnowledgeItemConfirmable(
          knowledge,
          state.knowledgeEvidence.filter(evidence => evidence.knowledgeItemId === knowledge.id)
        );
        currentlyConfirmable = true;
      } catch {
        /* 只能通过登记的合规依赖前像继续。 */
      }
    if (currentlyConfirmable) {
      selected.push(entry);
      continue;
    }
    if (
      entry.parents.some(
        parent =>
          parents.has(syncKey(parent.collection, parent.id)) &&
          !sameEntity(parent.collection, parents.get(syncKey(parent.collection, parent.id)).value, parent.value)
      )
    ) {
      blocked.add(syncKey('examFocuses', entry.focusId));
      continue;
    }
    selected.push(entry);
    for (const parent of entry.parents) parents.set(syncKey(parent.collection, parent.id), parent);
  }
  const staged = new Map(
    changes
      .filter(change => !blocked.has(syncKey(change.collection, change.id)))
      .map(change => [syncKey(change.collection, change.id), change])
  );
  const temporary = new Set();
  for (const [id, parent] of parents) {
    const current = state[parent.collection].find(item => item.id === parent.id);
    if (sameEntity(parent.collection, current, parent.value)) continue;
    temporary.add(id);
    const remote = base.get(id);
    if (sameEntity(parent.collection, remote?.value, parent.value)) staged.delete(id);
    else
      staged.set(id, {
        collection: parent.collection,
        id: parent.id,
        baseRevision: remote?.revision ?? null,
        value: structuredClone(parent.value)
      });
  }
  // 候选投影只推进基线；用户之后已重新确认的本地题目不能被临时父前像吞掉。
  if (temporary.size)
    for (const question of state.questions) {
      if (!syncReferencesFor('questions', question, state).some(ref => temporary.has(syncKey(ref.collection, ref.id))))
        continue;
      const id = syncKey('questions', question.id);
      const value =
        question.reviewStatus === 'confirmed' && !question.deletedAt
          ? { ...question, reviewStatus: 'candidate' }
          : structuredClone(question);
      staged.set(id, { collection: 'questions', id: question.id, baseRevision: base.get(id)?.revision ?? null, value });
    }
  return { changes: [...staged.values()], selected };
}
