import { compactAcknowledgedOutbox } from './outbox-retention.mjs';
import { cloneJsonData } from '../../api/src/infrastructure/json-clone.js';
import { observeRemoteDeletionFacts } from './sqlite-deletion-facts.mjs';
import { assertNoKnowledgeArtifactProvenanceDowngrade } from '../../api/src/modules/knowledge/domain/knowledge-artifact-provenance-state.js';
import { selectEntityBatch } from './entity-batches.mjs';
import { syncContract } from '../../api/src/modules/sync/protocol-contract.ts';
import { reconcileSyncedSourceStates } from '../../api/src/infrastructure/local-data-relations.js';
import { randomUUID } from 'node:crypto';
import {
  WRITABLE_COLLECTIONS,
  sameEntity,
  syncReferencesFor,
  changeReferencesFor,
  KNOWLEDGE_COLLECTIONS,
  TRAINING_COLLECTIONS
} from '../../api/src/modules/sync/entity-contract.ts';
import { syncKey } from '../../api/src/modules/sync/journal.ts';
import {
  LOCAL_DATA_COLLECTIONS,
  createEmptyLocalState,
  validatePersistedLocalState,
  createPersistedLocalDocument
} from '../../api/src/infrastructure/local-data-schema.js';
import { readMeta, writeMeta } from './sync-state.mjs';
import { preserveLocalHistoryCopies } from './history-sync-retention.mjs';
import { createEntityConflictCopy } from './entity-conflict-copy.mjs';
import {
  readKnowledgeLifecycleBoundaries,
  firstKnowledgeLifecycleBoundaries,
  consumeKnowledgeLifecycleBoundaries,
  bindKnowledgeLifecycleUpload,
  acknowledgeKnowledgeLifecycleUpload,
  clearKnowledgeLifecycleUpload,
  discardKnowledgeLifecycleBoundaries,
  preserveKnowledgeLifecycleInvalidations,
  lifecycleEntityKey
} from './knowledge-lifecycle-boundaries.mjs';
import {
  readExamFocusReviewBoundaries,
  prepareExamFocusReviewChanges,
  bindExamFocusReviewUpload,
  acknowledgeExamFocusReviewUpload,
  discardExamFocusReviewBoundaries,
  clearExamFocusReviewUpload
} from './exam-focus-review-boundaries.mjs';

const replace = (state, entry) => {
  const index = state[entry.collection].findIndex(item => item.id === entry.id);
  if (index >= 0) state[entry.collection].splice(index, 1);
  if (entry.value) state[entry.collection].push(cloneJsonData(entry.value));
};
function bases(db) {
  const result = new Map();
  for (const row of db.prepare('SELECT * FROM sync_base').iterate()) {
    result.set(syncKey(row.collection, row.id), {
      collection: row.collection,
      id: row.id,
      revision: row.server_revision,
      value: JSON.parse(row.payload)
    });
  }
  return result;
}
const snapshots = new WeakMap();
const reconciledConflicts = new WeakMap();
function snapshot(store) {
  const key = store.getEntityCacheKey();
  const previous = snapshots.get(store);
  if (key !== null && previous?.key === key) return previous;
  const value = store.readSync((db, state) => {
    const base = bases(db);
    const conflict = readMeta(db, 'entityConflict');
    const boundaries = readKnowledgeLifecycleBoundaries(db);
    const reviews = readExamFocusReviewBoundaries(db);
    return {
      key,
      base,
      boundaries,
      reviews,
      dirty: cloneJsonData(dirtyEntries(db, state, base, boundaries, reviews)),
      epoch: readMeta(db, 'epoch'),
      conflict,
      remote: conflict ? new Map(conflict.remote.map(entry => [syncKey(entry.collection, entry.id), entry])) : base
    };
  });
  if (key !== null) snapshots.set(store, value);
  return value;
}
function retiredNoteVersionIds(db) {
  return new Set(
    Array.from(
      db.prepare("SELECT entity_id FROM deletion_facts WHERE collection='noteVersions'").iterate(),
      row => row.entity_id
    )
  );
}
function dirtyEntries(db, state, base, boundaries = [], reviews = []) {
  const changes = [];
  const retiredVersions = retiredNoteVersionIds(db);
  const retiredRevisions = new Set(
    Array.from(
      db.prepare("SELECT entity_id FROM deletion_facts WHERE collection='annotationRevisions'").iterate(),
      row => row.entity_id
    )
  );
  const versionHashes = new Set(
    [...base.values()]
      .filter(entry => entry.collection === 'noteVersions' && entry.value)
      .map(entry => `${entry.value.noteId}:${entry.value.contentHash}`)
  );
  for (const collection of WRITABLE_COLLECTIONS) {
    const current = new Map(state[collection].map(item => [item.id, item]));
    const ids = new Set([
      ...current.keys(),
      ...[...base.values()].filter(entry => entry.collection === collection).map(entry => entry.id)
    ]);
    for (const id of ids) {
      const previous = base.get(syncKey(collection, id));
      const value = current.get(id) ?? null;
      // 云端版本去重后的本地历史副本仅供恢复，不再上传。
      if (collection === 'noteVersions' && value && versionHashes.has(`${value.noteId}:${value.contentHash}`)) continue;
      // 云端按保留策略清理过的版本：仍被本机引用而保留的副本只供恢复，不能再作为新建上传。
      if (collection === 'noteVersions' && value && (previous?.value === null || retiredVersions.has(id))) continue;
      if (collection === 'annotationRevisions' && value && (previous?.value === null || retiredRevisions.has(id)))
        continue;
      if (!sameEntity(collection, value, previous?.value)) {
        const old = previous?.value;
        const lifecycleAction =
          [
            'knowledgeItems',
            'analysisScopeSnapshots',
            'folders',
            'learningObjectives',
            'examProfiles',
            'examFocuses',
            'questions'
          ].includes(collection) &&
          old &&
          value
            ? !old.deletedAt && value.deletedAt
              ? 'trash'
              : old.deletedAt && !value.deletedAt
                ? 'restore'
                : undefined
            : collection === 'knowledgeEvidence' &&
                old &&
                value &&
                old.applicabilityStatus !== value.applicabilityStatus
              ? value.applicabilityStatus === 'withdrawn'
                ? 'withdraw'
                : value.applicabilityStatus === 'active'
                  ? 'readopt'
                  : undefined
              : undefined;
        changes.push({
          collection,
          id,
          baseRevision: previous?.revision ?? null,
          value,
          ...(lifecycleAction ? { lifecycleAction } : {})
        });
      }
    }
  }
  // 生命周期不能因当前业务终态净零而消失；拉取时仍保留用户当前值。
  for (const boundary of firstKnowledgeLifecycleBoundaries(boundaries).values()) {
    const { collection, entityId: id } = boundary;
    if (!changes.some(entry => entry.collection === collection && entry.id === id)) {
      changes.push({
        collection,
        id,
        baseRevision: base.get(syncKey(collection, id))?.revision ?? null,
        value: state[collection].find(item => item.id === id) ?? null
      });
    }
  }
  // 已登记回收事务中实际失效的下游，即使随后人工重新确认净零也必须保留终态。
  for (const boundary of boundaries)
    for (const change of boundary.changes) {
      const value = state[change.collection]?.find(item => item.id === change.entityId) ?? null;
      if (
        !['learningObjectives', 'questions'].includes(change.collection) ||
        sameEntity(change.collection, change.before, change.value) ||
        value?.reviewStatus !== 'confirmed' ||
        changes.some(entry => entry.collection === change.collection && entry.id === change.entityId)
      )
        continue;
      changes.push({
        collection: change.collection,
        id: change.entityId,
        baseRevision: base.get(syncKey(change.collection, change.entityId))?.revision ?? null,
        value
      });
    }
  for (const review of reviews)
    if (!changes.some(entry => entry.collection === 'examFocuses' && entry.id === review.focusId)) {
      changes.push({
        collection: 'examFocuses',
        id: review.focusId,
        baseRevision: base.get(syncKey('examFocuses', review.focusId))?.revision ?? null,
        value: state.examFocuses.find(item => item.id === review.focusId) ?? null
      });
    }
  return changes;
}
function stateFromBase(base) {
  const state = createEmptyLocalState();
  for (const entry of base.values()) if (entry.value) state[entry.collection].push(cloneJsonData(entry.value));
  return state;
}
function setState(target, next) {
  for (const collection of LOCAL_DATA_COLLECTIONS)
    target[collection].splice(0, target[collection].length, ...next[collection]);
}
function preserveAttachmentHealth(next, previous) {
  const local = new Map(previous.attachments.map(item => [item.id, item]));
  for (const attachment of next.attachments) {
    const before = local.get(attachment.id);
    if (
      before &&
      before.sha256 === attachment.sha256 &&
      before.size === attachment.size &&
      before.fileName === attachment.fileName
    ) {
      Object.assign(attachment, {
        status: before.status,
        verifiedAt: before.verifiedAt,
        storagePath: before.storagePath
      });
    }
  }
}
function persistBases(db, base, previous) {
  const remove = db.prepare('DELETE FROM sync_base WHERE collection = ? AND id = ?');
  for (const [key, entry] of previous) if (!base.has(key)) remove.run(entry.collection, entry.id);
  const insert = db.prepare(
    'INSERT INTO sync_base VALUES (?, ?, ?, ?) ON CONFLICT(collection, id) DO UPDATE SET server_revision = excluded.server_revision, payload = excluded.payload WHERE server_revision IS NOT excluded.server_revision OR payload IS NOT excluded.payload'
  );
  for (const [key, entry] of base) {
    if (previous.get(key) === entry) continue;
    insert.run(entry.collection, entry.id, entry.revision, JSON.stringify(entry.value));
  }
}
function canonicalizeVersions(state, base) {
  const aliases = new Map();
  const remoteVersions = new Map(
    [...base.values()]
      .filter(entry => entry.collection === 'noteVersions' && entry.value)
      .map(entry => [`${entry.value.noteId}:${entry.value.contentHash}`, entry])
  );
  for (const version of state.noteVersions) {
    const remote = remoteVersions.get(`${version.noteId}:${version.contentHash}`);
    if (remote && remote.id !== version.id) aliases.set(version.id, remote.id);
  }
  function remap(value) {
    if (Array.isArray(value)) return value.map(remap);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        (key === 'noteVersionId' || (key === 'sourceId' && value.sourceType === 'noteVersion')) && aliases.has(child)
          ? aliases.get(child)
          : remap(child)
      ])
    );
  }
  for (const collection of [
    'contentAnnotations',
    'annotationExclusions',
    'annotationRevisions',
    'knowledgeEvidence',
    'questionSources'
  ])
    state[collection].splice(0, state[collection].length, ...state[collection].map(remap));
}

export function applyEntityRemote(store, entries, cursor, epoch, { reset = false } = {}) {
  const cached = snapshot(store);
  const { epoch: previousEpoch, conflict: previousConflict } = cached;
  const unchanged = entries.every(entry => {
    const previous = cached.remote.get(syncKey(entry.collection, entry.id));
    return (
      previous && previous.revision === entry.revision && sameEntity(entry.collection, previous.value, entry.value)
    );
  });
  // 本地新修改仍需经过版本别名规范化及关联校验，稳定空闲才复用合并结果。
  const reconciled = reconciledConflicts.get(store) === cached.key;
  if (!reset && previousEpoch === epoch && unchanged && (reconciled || (!previousConflict && !cached.dirty.length))) {
    const unseenDelete = entries.some(
      entry =>
        entry.value === null &&
        Number.isSafeInteger(entry.revision) &&
        entry.revision > 0 &&
        !store.deletionFacts.has(entry.collection, entry.id)
    );
    if (unseenDelete || (!previousConflict && store.readSync(db => readMeta(db, 'cursor')) !== cursor))
      store.metadataTransaction(db => {
        observeRemoteDeletionFacts(db, entries, { epoch, versions: store.state.noteVersions });
        if (!previousConflict) writeMeta(db, 'cursor', cursor);
      });
    if (previousConflict) reconciledConflicts.set(store, store.getEntityCacheKey());
    return !previousConflict;
  }
  const result = store.syncTransaction((db, state) => {
    observeRemoteDeletionFacts(db, entries, { epoch, versions: store.state.noteVersions });
    const base = bases(db);
    const previousEpoch = readMeta(db, 'epoch');
    const changedEpoch = previousEpoch && previousEpoch !== epoch;
    const previousConflict = readMeta(db, 'entityConflict');
    const remote = reset
      ? new Map()
      : previousConflict?.epoch === epoch
        ? new Map(previousConflict.remote.map(entry => [syncKey(entry.collection, entry.id), entry]))
        : new Map(base);
    for (const entry of entries) {
      if (!LOCAL_DATA_COLLECTIONS.includes(entry.collection)) throw new Error('同步实体类型不兼容，请升级应用。');
      const key = syncKey(entry.collection, entry.id);
      if (reset || !remote.has(key) || (remote.get(key).revision ?? 0) <= (entry.revision ?? 0)) remote.set(key, entry);
    }
    // 规范化本地版本引用后再比较，避免相同正文版本造成虚假冲突。
    const local = cloneJsonData(state);
    canonicalizeVersions(local, base);
    canonicalizeVersions(local, remote);
    const boundaries = readKnowledgeLifecycleBoundaries(db);
    const dirty = dirtyEntries(db, local, base, boundaries);
    const firstBoundaries = firstKnowledgeLifecycleBoundaries(boundaries);
    const conflicts = dirty.filter(entry => {
      const old = base.get(syncKey(entry.collection, entry.id));
      const next = remote.get(syncKey(entry.collection, entry.id));
      // 已收到自己的最早边界时，保留后继本地值并确认该权威基线。
      const boundary = firstBoundaries.get(syncKey(entry.collection, entry.id));
      if (!changedEpoch && boundary && sameEntity(entry.collection, boundary.value, next?.value)) return false;
      // 已登记回收实际失效的题目旧来源只变化派生健康状态时，采用新健康基线而保留本地解除。
      if (
        !changedEpoch &&
        entry.collection === 'questionSources' &&
        old?.value &&
        next?.value &&
        sameEntity(entry.collection, old.value, next.value) &&
        boundaries.some(item =>
          item.changes.some(
            change =>
              change.collection === 'questions' &&
              change.entityId === old.value.questionId &&
              !sameEntity('questions', change.before, change.value)
          )
        )
      )
        return false;
      return (
        !sameEntity(entry.collection, entry.value, next?.value) &&
        (changedEpoch || (!previousEpoch && next?.value) || (old?.revision ?? null) !== (next?.revision ?? null))
      );
    });
    const merged = stateFromBase(remote);
    for (const entry of dirty) replace(merged, entry);
    // 云端私密化立即隔离本地待合并正文；冲突审阅不自动恢复 AI 可读性。
    preserveRemoteNotePrivacy(merged, remote);
    preserveKnowledgeLifecycleInvalidations(merged, local, boundaries);
    preserveAttachmentHealth(merged, state);
    preserveLocalHistoryCopies(db, local, merged, remote);
    let valid;
    try {
      valid = validatePersistedLocalState(createPersistedLocalDocument(reconcileSyncedSourceStates(merged)));
      assertNoKnowledgeArtifactProvenanceDowngrade(state, valid);
    } catch (error) {
      valid = undefined;
      conflicts.push({ collection: 'dependencies', id: 'references', message: error.message });
    }
    if (conflicts.length) {
      const existing = readMeta(db, 'entityConflict');
      const blocked = new Set(conflicts.map(entry => syncKey(entry.collection, entry.id)));
      const dirtyKeys = new Set(dirty.map(entry => syncKey(entry.collection, entry.id)));
      if (!valid) for (const key of dirtyKeys) blocked.add(key);
      let expanded = true;
      while (expanded) {
        expanded = false;
        for (const entry of dirty) {
          const key = syncKey(entry.collection, entry.id);
          const refs = changeReferencesFor(entry, stateFromBase(base), local)
            .map(ref => syncKey(ref.collection, ref.id))
            .filter(ref => dirtyKeys.has(ref));
          if (blocked.has(key) || refs.some(ref => blocked.has(ref)))
            for (const ref of [key, ...refs])
              if (!blocked.has(ref)) {
                blocked.add(ref);
                expanded = true;
              }
        }
      }
      writeMeta(db, 'entityConflict', {
        id: existing?.cursor === cursor && existing?.epoch === epoch ? existing.id : randomUUID(),
        epoch,
        cursor,
        remote: [...remote.values()],
        blocked: [...blocked],
        conflicts,
        changedEpoch: Boolean(changedEpoch),
        changedAt: new Date().toISOString()
      });
      writeMeta(db, 'bootstrap', null);
      if (valid) {
        setState(state, valid);
        const acceptedBase = new Map(remote);
        for (const key of blocked) {
          if (base.has(key)) acceptedBase.set(key, base.get(key));
          else acceptedBase.delete(key);
        }
        persistBases(db, acceptedBase, base);
        writeMeta(db, 'epoch', epoch);
        writeMeta(db, 'cursor', cursor);
        if (changedEpoch) {
          writeMeta(db, 'entityUpload', null);
          clearKnowledgeLifecycleUpload(db);
          clearExamFocusReviewUpload(db);
        }
      }
      return false;
    }
    setState(state, valid);
    persistBases(db, remote, base);
    writeMeta(db, 'epoch', epoch);
    writeMeta(db, 'cursor', cursor);
    writeMeta(db, 'bootstrap', null);
    writeMeta(db, 'entityConflict', null);
    if (changedEpoch) {
      writeMeta(db, 'entityUpload', null);
      clearKnowledgeLifecycleUpload(db);
      clearExamFocusReviewUpload(db);
    }
    settle(db, state);
    return true;
  });
  reconciledConflicts.set(store, store.getEntityCacheKey());
  return result;
}

function acknowledgeOutbox(db) {
  db.prepare("UPDATE sync_outbox SET state = 'acknowledged' WHERE state != 'acknowledged'").run();
  compactAcknowledgedOutbox(db);
}

function settle(db, state) {
  if (
    !dirtyEntries(db, state, bases(db), readKnowledgeLifecycleBoundaries(db), readExamFocusReviewBoundaries(db))
      .length &&
    !readMeta(db, 'entityUpload')
  )
    acknowledgeOutbox(db);
}

export function nextEntityUpload(store, { knowledgeSupported = true } = {}) {
  const frozen = store.readSync(db => {
    readKnowledgeLifecycleBoundaries(db);
    readExamFocusReviewBoundaries(db);
    return readMeta(db, 'entityUpload');
  });
  if (frozen) return frozen;
  let cached = snapshot(store);
  // 权威基线已包含该边界时不用重复提交，但必须可靠消费后再选后继动作。
  while (true) {
    const reflected = [...firstKnowledgeLifecycleBoundaries(cached.boundaries).values()].filter(
      boundary =>
        !cached.conflict?.blocked?.includes(lifecycleEntityKey(boundary)) &&
        sameEntity(boundary.collection, boundary.value, cached.base.get(lifecycleEntityKey(boundary))?.value)
    );
    if (!reflected.length) break;
    store.metadataTransaction(db => {
      clearKnowledgeLifecycleUpload(db);
      consumeKnowledgeLifecycleBoundaries(db, reflected);
    });
    // 此次只有私有队列变化；实体缓存键刻意不随普通同步 metadata 变化。
    snapshots.delete(store);
    cached = snapshot(store);
  }
  const reflectedReviews = cached.reviews.filter(review => {
    const local = store.state.examFocuses.find(item => item.id === review.focusId);
    return (
      !cached.conflict?.blocked?.includes(syncKey('examFocuses', review.focusId)) &&
      (!local ||
        local.deletedAt ||
        local.reviewStatus !== 'confirmed' ||
        cached.base.get(syncKey('examFocuses', review.focusId))?.value?.reviewStatus === 'confirmed')
    );
  });
  if (reflectedReviews.length) {
    store.metadataTransaction(db =>
      discardExamFocusReviewBoundaries(db, new Set(reflectedReviews.map(review => review.focusId)))
    );
    snapshots.delete(store);
    cached = snapshot(store);
  }
  const { base, dirty, conflict, boundaries, reviews } = cached;
  const firstBoundaries = firstKnowledgeLifecycleBoundaries(boundaries);
  const blocked = new Set(conflict?.blocked ?? []);
  const allowed = entry => knowledgeSupported || !KNOWLEDGE_COLLECTIONS.includes(entry.collection);
  // 知识原有直接回收交付保持不变；只有新训练依赖要求父知识可用时先发布创建前像。
  const needsActiveKnowledge = id =>
    dirty.some(entry => {
      if (!entry.value || blocked.has(syncKey(entry.collection, entry.id))) return false;
      const previous = base.get(syncKey(entry.collection, entry.id))?.value;
      return (
        (entry.collection === 'learningObjectives' &&
          entry.value.knowledgeItemId === id &&
          (!previous || (previous.deletedAt && !entry.value.deletedAt))) ||
        (entry.collection === 'questionSources' &&
          entry.value.sourceType === 'knowledgeItem' &&
          entry.value.sourceId === id &&
          (!previous || previous.sourceType !== entry.value.sourceType || previous.sourceId !== entry.value.sourceId))
      );
    });
  let eligible = dirty
    .filter(allowed)
    .filter(entry => !blocked.has(syncKey(entry.collection, entry.id)))
    .map(entry => {
      const boundary = firstBoundaries.get(syncKey(entry.collection, entry.id));
      if (!boundary || !entry.value) return entry;
      // 正文和审核仍合并为最新业务终态，仅删除状态按用户事务顺序发送。
      const previous = base.get(syncKey(entry.collection, entry.id))?.value;
      // 新建后离线回收时先发布合法创建前像，不能让新关联绑定到临时回收站父对象。
      const createBeforeTrash =
        !previous &&
        boundary.action === 'trash' &&
        (TRAINING_COLLECTIONS.includes(entry.collection) || needsActiveKnowledge(entry.id));
      const value = createBeforeTrash
        ? cloneJsonData(boundary.before)
        : { ...entry.value, deletedAt: boundary.value.deletedAt };
      if (!previous && boundary.action === 'trash' && entry.collection === 'questions') value.reviewStatus = 'draft';
      if (!previous && boundary.action === 'trash' && entry.collection === 'examFocuses')
        value.reviewStatus = 'candidate';
      const lifecycleAction =
        previous &&
        (!previous.deletedAt && value.deletedAt ? 'trash' : previous.deletedAt && !value.deletedAt ? 'restore' : null);
      return {
        collection: entry.collection,
        id: entry.id,
        baseRevision: entry.baseRevision,
        value,
        ...(lifecycleAction ? { lifecycleAction } : {})
      };
    });
  // 回收前像只推进基线；正式确认留待所有回收父项恢复后的普通终态批次。
  const trashedParents = new Set(
    eligible
      .filter(entry => ['knowledgeItems', 'learningObjectives'].includes(entry.collection) && entry.value?.deletedAt)
      .map(entry => syncKey(entry.collection, entry.id))
  );
  const deferredQuestions = new Set();
  for (const entry of eligible) {
    const previous = base.get(syncKey(entry.collection, entry.id))?.value;
    if (
      entry.collection === 'questionObjectives' &&
      entry.value &&
      !previous &&
      trashedParents.has(syncKey('learningObjectives', entry.value.learningObjectiveId))
    )
      deferredQuestions.add(entry.value.questionId);
    if (
      entry.collection === 'questionSources' &&
      entry.value &&
      (!previous || previous.sourceType !== entry.value.sourceType || previous.sourceId !== entry.value.sourceId)
    ) {
      const collection = { knowledgeItem: 'knowledgeItems', learningObjective: 'learningObjectives' }[
        entry.value.sourceType
      ];
      if (collection && trashedParents.has(syncKey(collection, entry.value.sourceId)))
        deferredQuestions.add(entry.value.questionId);
    }
  }
  const deferBindings = changes =>
    changes.flatMap(entry => {
      if (
        ['questionObjectives', 'questionSources'].includes(entry.collection) &&
        deferredQuestions.has(
          entry.value?.questionId ?? base.get(syncKey(entry.collection, entry.id))?.value?.questionId
        )
      )
        return [];
      if (entry.collection !== 'questions' || !deferredQuestions.has(entry.id)) return [entry];
      const previous = base.get(syncKey('questions', entry.id));
      return previous?.value
        ? [
            {
              collection: entry.collection,
              id: entry.id,
              baseRevision: previous.revision,
              value: {
                ...previous.value,
                reviewStatus: previous.value.deletedAt ? previous.value.reviewStatus : 'candidate'
              }
            }
          ]
        : [];
    });
  eligible = deferBindings(eligible);
  if (trashedParents.size) {
    for (const entry of eligible)
      if (
        entry.collection === 'learningObjectives' &&
        entry.value?.reviewStatus === 'confirmed' &&
        trashedParents.has(syncKey('knowledgeItems', entry.value.knowledgeItemId))
      )
        entry.value = { ...entry.value, reviewStatus: 'candidate' };
    const projection = cloneJsonData(store.state);
    for (const entry of eligible) replace(projection, entry);
    for (const entry of eligible)
      if (
        entry.collection === 'questions' &&
        entry.value?.reviewStatus === 'confirmed' &&
        (syncReferencesFor('questions', entry.value, projection).some(ref =>
          trashedParents.has(syncKey(ref.collection, ref.id))
        ) ||
          projection.questionObjectives.some(
            link =>
              link.questionId === entry.id &&
              projection.learningObjectives.find(goal => goal.id === link.learningObjectiveId)?.reviewStatus !==
                'confirmed'
          ))
      ) {
        entry.value = { ...entry.value, reviewStatus: 'candidate' };
      }
  }
  const reviewPlan = prepareExamFocusReviewChanges(
    reviews.filter(review => !blocked.has(syncKey('examFocuses', review.focusId))),
    eligible,
    store.state,
    base,
    cached.epoch
  );
  if (reviewPlan.conflict) {
    const id = reviewPlan.conflict.focusId;
    store.metadataTransaction(db =>
      writeMeta(db, 'entityConflict', {
        id: randomUUID(),
        epoch: cached.epoch,
        cursor: readMeta(db, 'cursor'),
        remote: [...base.values()],
        blocked: [syncKey('examFocuses', id)],
        conflicts: [
          { collection: 'examFocuses', id, message: '考点确认时的依赖已变化，请采用云端后重新核对学习目标和考试配置。' }
        ],
        changedEpoch: false,
        changedAt: new Date().toISOString()
      })
    );
    snapshots.delete(store);
    return null;
  }
  eligible = deferBindings(reviewPlan.changes);
  if (!eligible.length) {
    if (!dirty.length && store.getStatus().pendingOperations) store.metadataTransaction(db => acknowledgeOutbox(db));
    return null;
  }
  const envelope = store.readSync(db => ({
    protocolVersion: 2,
    ...syncContract(),
    datasetEpoch: readMeta(db, 'epoch'),
    deviceId: store.getStatus().deviceId,
    operationId: randomUUID(),
    sequence: (readMeta(db, 'entitySequence') ?? 0) + 1
  }));
  // 本地恢复副本可保留原版本 ID；传输依赖使用基线中已经确认的同正文版本。
  const canonicalVersions = new Map(
    [...base.values()]
      .filter(entry => entry.collection === 'noteVersions' && entry.value)
      .map(entry => [`${entry.value.noteId}:${entry.value.contentHash}`, entry.value])
  );
  const retiredVersions = store.readSync(retiredNoteVersionIds);
  for (const version of store.state.noteVersions) {
    const key = `${version.noteId}:${version.contentHash}`;
    if (canonicalVersions.has(key)) continue;
    // 已清理的恢复副本不能抢占同正文新版本的传输依赖；删除 ID 批量读取，不逐版本查询 SQLite。
    if (base.get(syncKey('noteVersions', version.id))?.value === null || retiredVersions.has(version.id)) continue;
    canonicalVersions.set(key, version);
  }
  const referenceState = cloneJsonData({ ...store.state, noteVersions: [...canonicalVersions.values()] });
  for (const entry of eligible) replace(referenceState, entry);
  // 临时旧题目投影使用同一旧子图，不能把尚未交付的新关系误当作依赖。
  for (const collection of ['questionObjectives', 'questionSources']) {
    referenceState[collection] = referenceState[collection].filter(child => !deferredQuestions.has(child.questionId));
    referenceState[collection].push(
      ...[...base.values()]
        .filter(
          entry => entry.collection === collection && entry.value && deferredQuestions.has(entry.value.questionId)
        )
        .map(entry => cloneJsonData(entry.value))
    );
  }
  const before = stateFromBase(base);
  const makeOperation = changes => {
    const own = new Set(changes.map(entry => syncKey(entry.collection, entry.id)));
    const dependencies = new Map();
    for (const entry of changes)
      for (const ref of changeReferencesFor(entry, before, referenceState)) {
        const key = syncKey(ref.collection, ref.id);
        if (!own.has(key)) dependencies.set(key, { ...ref, baseRevision: base.get(key)?.revision ?? null });
      }
    return { ...envelope, changes, dependencies: [...dependencies.values()] };
  };
  const changes = eligible.length
    ? selectEntityBatch(eligible, referenceState, base, {
        measureBytes: entries => Buffer.byteLength(JSON.stringify(makeOperation(entries)))
      })
    : [];
  if (!changes.length) {
    if (!dirty.length && store.getStatus().pendingOperations) store.metadataTransaction(db => acknowledgeOutbox(db));
    return null;
  }
  return store.metadataTransaction(db => {
    const operation = makeOperation(changes);
    writeMeta(db, 'entitySequence', operation.sequence);
    writeMeta(db, 'entityUpload', operation);
    bindKnowledgeLifecycleUpload(
      db,
      operation.operationId,
      changes.flatMap(entry => {
        const boundary = firstBoundaries.get(syncKey(entry.collection, entry.id));
        return boundary && entry.value?.deletedAt === boundary.value.deletedAt ? [boundary] : [];
      })
    );
    bindExamFocusReviewUpload(
      db,
      operation.operationId,
      reviewPlan.selected.filter(review =>
        changes.some(entry => entry.collection === 'examFocuses' && entry.id === review.focusId)
      )
    );
    return operation;
  });
}

export function acknowledgeEntityUpload(store, operation, result) {
  store.syncTransaction((db, state) => {
    observeRemoteDeletionFacts(
      db,
      [...(result.entries ?? []), ...(result.conflicts ?? []), ...(result.current ? [result.current] : [])],
      { epoch: operation.datasetEpoch, versions: state.noteVersions }
    );
    if (result.status === 'accepted') {
      const previous = cloneJsonData(state);
      const base = bases(db);
      const previousBase = new Map(base);
      const pending = new Set(
        dirtyEntries(db, state, base, readKnowledgeLifecycleBoundaries(db), readExamFocusReviewBoundaries(db)).map(
          entry => syncKey(entry.collection, entry.id)
        )
      );
      for (const entry of result.entries) {
        const submitted = operation.changes.find(
          item =>
            item.collection === entry.collection && (item.id === entry.id || result.aliases?.[item.id] === entry.id)
        );
        const local = state[entry.collection].find(item => item.id === (submitted?.id ?? entry.id)) ?? null;
        if (
          submitted
            ? sameEntity(entry.collection, local, submitted.value)
            : !pending.has(syncKey(entry.collection, entry.id)) &&
              sameEntity(entry.collection, local, previousBase.get(syncKey(entry.collection, entry.id))?.value)
        )
          replace(state, entry);
        base.set(syncKey(entry.collection, entry.id), entry);
      }
      canonicalizeVersions(state, base);
      preserveLocalHistoryCopies(db, previous, state, base);
      assertNoKnowledgeArtifactProvenanceDowngrade(previous, state);
      persistBases(db, base, previousBase);
    }
    preserveRemoteNotePrivacy(
      state,
      new Map(
        [...(result.entries ?? []), ...(result.conflicts ?? []), ...(result.current ? [result.current] : [])].map(
          entry => [syncKey(entry.collection, entry.id), entry]
        )
      )
    );
    acknowledgeKnowledgeLifecycleUpload(db, operation.operationId, result.status === 'accepted');
    acknowledgeExamFocusReviewUpload(db, operation, result);
    // 冲突结果先解除冻结，下一次拉取会保存包含完整远端事务的冲突。
    writeMeta(db, 'entityUpload', null);
    settle(db, state);
  });
}

export function getEntitySyncState(store) {
  const cached = snapshot(store);
  if (cached.status) return cached.status;
  const { base, dirty, conflict } = cached;
  cached.status = {
    pendingEntities: dirty.length,
    pendingKnowledgeEntities: dirty.filter(entry => KNOWLEDGE_COLLECTIONS.includes(entry.collection)).length,
    pendingTrainingEntities: dirty.filter(entry => TRAINING_COLLECTIONS.includes(entry.collection)).length,
    pendingAttachments: dirty.filter(entry => entry.collection === 'attachments').length,
    entityConflict: conflict
      ? {
          id: conflict.id,
          changedEpoch: conflict.changedEpoch,
          items: dirty
            .filter(entry => !conflict.blocked || conflict.blocked.includes(syncKey(entry.collection, entry.id)))
            .map(entry => ({
              collection: entry.collection,
              id: entry.id,
              local: entry.value,
              base: base.get(syncKey(entry.collection, entry.id))?.value ?? null,
              remote:
                conflict.remote.find(item => item.collection === entry.collection && item.id === entry.id)?.value ??
                null
            })),
          reasons: conflict.conflicts.map(entry => ({
            collection: entry.collection,
            id: entry.id,
            message: entry.message
          }))
        }
      : null
  };
  return cached.status;
}

export function resolveEntityConflict(store, { conflictId, choice, rawMarkdown }, noteService, entityTransfer) {
  const preparedCopies = [];
  const resolve = (db, state) => {
    const conflict = readMeta(db, 'entityConflict');
    if (!conflict || conflict.id !== conflictId) throw new Error('冲突已变化，请重新查看。');
    if (!['remote', 'local', 'manual', 'copy'].includes(choice)) throw new Error('请选择有效的冲突处理方式。');
    const boundaries = readKnowledgeLifecycleBoundaries(db);
    const allDirty = dirtyEntries(db, state, bases(db), boundaries, readExamFocusReviewBoundaries(db));
    const blocked = new Set(conflict.blocked ?? allDirty.map(entry => syncKey(entry.collection, entry.id)));
    const dirty = allDirty.filter(entry => blocked.has(syncKey(entry.collection, entry.id)));
    if (
      ['copy', 'manual'].includes(choice) &&
      dirty.some(
        entry => KNOWLEDGE_COLLECTIONS.includes(entry.collection) || TRAINING_COLLECTIONS.includes(entry.collection)
      )
    ) {
      throw new Error('包含知识或来源、训练资产的关联冲突请采用本地或云端；正文合并与保留两篇不能安全处理关联来源。');
    }
    db.prepare('INSERT INTO sync_recovery VALUES (?, ?)').run(
      randomUUID(),
      JSON.stringify({
        kind: 'entity-conflict',
        choice,
        local: cloneJsonData(state),
        base: [...bases(db).values()],
        remote: conflict.remote,
        resolvedAt: new Date().toISOString()
      })
    );
    const remote = new Map(conflict.remote.map(entry => [syncKey(entry.collection, entry.id), entry]));
    // 只保留冲突形成后已确认的更新；失败合并时旧基线不能覆盖远端墓碑。
    for (const [key, entry] of bases(db))
      if (
        !blocked.has(key) &&
        readMeta(db, 'epoch') === conflict.epoch &&
        (!remote.has(key) || (entry.revision ?? 0) > (remote.get(key).revision ?? 0))
      )
        remote.set(key, entry);
    const merged = stateFromBase(remote);
    for (const entry of allDirty) if (!blocked.has(syncKey(entry.collection, entry.id))) replace(merged, entry);
    if (choice === 'remote' || choice === 'copy') {
      discardKnowledgeLifecycleBoundaries(db, new Set(dirty.map(entry => syncKey(entry.collection, entry.id))));
      discardExamFocusReviewBoundaries(
        db,
        new Set(dirty.filter(entry => entry.collection === 'examFocuses').map(entry => entry.id))
      );
      const noteIds = new Set(merged.notes.map(note => note.id));
      merged.noteVersions = merged.noteVersions.filter(version => noteIds.has(version.noteId));
    }
    if (choice !== 'remote' && choice !== 'copy') {
      const reviewPlan = prepareExamFocusReviewChanges(
        readExamFocusReviewBoundaries(db).filter(review => blocked.has(syncKey('examFocuses', review.focusId))),
        dirty,
        state,
        remote,
        conflict.epoch
      );
      if (reviewPlan.conflict)
        throw Object.assign(new Error('考点审阅依赖已变化，请采用云端后重新核对学习目标和考试配置。'), {
          code: 'SYNC_REVIEW_REQUIRED'
        });
      for (const entry of dirty) {
        const current = remote.get(syncKey(entry.collection, entry.id));
        if (entry.value && !current?.value && (entry.baseRevision !== null || conflict.changedEpoch))
          throw new Error('云端已永久删除相关对象。请先导出恢复记录，再采用云端版本；原内容保存在恢复记录中。');
        // 旧编辑不能因冲突选择变成恢复；共同基线已在回收站的显式恢复仍可继续。
        if (
          entry.collection === 'knowledgeItems' &&
          current?.value?.deletedAt &&
          entry.value &&
          !entry.value.deletedAt &&
          entry.lifecycleAction !== 'restore'
        ) {
          throw Object.assign(
            new Error('云端知识已移入回收站。请先采用云端版本，再从回收站显式恢复；本地修改会保存在恢复记录中。'),
            { code: 'SYNC_RESTORE_REQUIRED' }
          );
        }
        if (
          TRAINING_COLLECTIONS.includes(entry.collection) &&
          entry.value &&
          !entry.value.deletedAt &&
          current?.value?.deletedAt &&
          entry.lifecycleAction !== 'restore'
        )
          throw Object.assign(new Error('云端已删除训练对象，旧编辑不能恢复；请采用云端后通过回收站显式恢复。'), {
            code: 'SYNC_RESTORE_REQUIRED'
          });
        if (entry.collection === 'questions' && entry.value && current?.value) {
          const content = question =>
            Object.fromEntries(
              Object.entries(question).filter(
                ([field]) => !['reviewStatus', 'deletedAt', 'createdAt', 'updatedAt', 'version'].includes(field)
              )
            );
          const changedRelations = dirty.some(
            child =>
              ['questionObjectives', 'questionSources'].includes(child.collection) &&
              (child.value?.questionId ?? bases(db).get(syncKey(child.collection, child.id))?.value?.questionId) ===
                entry.id
          );
          const edited = !sameEntity('questions', content(entry.value), content(current.value)) || changedRelations;
          entry.value = {
            ...entry.value,
            version: Math.max(entry.value.version, current.value.version + (edited ? 1 : 0))
          };
        }
        replace(merged, entry);
      }
    }
    preserveRemoteNotePrivacy(merged, remote);
    const localAttachments = state.attachments.map(attachment => ({ ...attachment }));
    preserveAttachmentHealth(merged, state);
    assertNoKnowledgeArtifactProvenanceDowngrade(state, merged);
    setState(state, reconcileSyncedSourceStates(merged));
    if (choice === 'copy') {
      const notes = dirty.filter(entry => entry.collection === 'notes' && entry.value);
      if (notes.length !== 1) throw new Error('保留两篇仅适用于一篇笔记的冲突。');
      createEntityConflictCopy({
        original: {
          ...notes[0].value,
          ...(remote.get(syncKey('notes', notes[0].id))?.value?.aiVisibility === 'private'
            ? { aiVisibility: 'private' }
            : {})
        },
        localAttachments,
        state,
        noteService,
        entityTransfer,
        preparedCopies
      });
    }
    if (choice === 'manual') {
      const notes = dirty.filter(entry => entry.collection === 'notes' && entry.value);
      if (notes.length !== 1 || typeof rawMarkdown !== 'string') throw new Error('手动合并需要且只能包含一篇笔记。');
      if (notes[0].value.deleted) noteService.restoreNote(notes[0].id);
      noteService.updateNote(notes[0].id, { rawMarkdown });
    }
    persistBases(db, remote, bases(db));
    writeMeta(db, 'epoch', conflict.epoch);
    writeMeta(db, 'cursor', conflict.cursor);
    writeMeta(db, 'entityConflict', null);
    writeMeta(db, 'entityUpload', null);
    clearKnowledgeLifecycleUpload(db);
    clearExamFocusReviewUpload(db);
    settle(db, state);
  };
  try {
    store.syncTransaction(resolve, { local: true, origin: 'sync-resolution' });
  } catch (error) {
    // SQLite 已回滚正文、元数据、基线及恢复记录；只清理本次新建的文件。
    for (const prepared of preparedCopies.reverse()) {
      try {
        prepared.rollback();
      } catch (rollbackError) {
        (error.rollbackErrors ??= []).push(rollbackError);
      }
    }
    throw error;
  }
}

function preserveRemoteNotePrivacy(state, remote) {
  for (const note of state.notes) {
    if (remote.get(syncKey('notes', note.id))?.value?.aiVisibility === 'private' && note.aiVisibility !== 'private') {
      note.aiVisibility = 'private';
      note.updatedAt = new Date(Math.max(Date.now(), Date.parse(note.updatedAt) + 1 || 0)).toISOString();
    }
  }
}
