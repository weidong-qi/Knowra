import { observeRemoteDeletionFacts } from './sqlite-deletion-facts.mjs';
import { compactAcknowledgedOutbox } from './outbox-retention.mjs';
import { randomUUID } from 'node:crypto';
import { noteContent, syncKey } from '../../api/src/modules/sync/journal.ts';
import { LOCAL_DATA_COLLECTIONS } from '../../api/src/infrastructure/local-data-schema.js';

export const equivalent = (a, b) => JSON.stringify(noteContent(a)) === JSON.stringify(noteContent(b));
export const readMeta = (db, key) =>
  JSON.parse(db.prepare('SELECT value FROM metadata WHERE key = ?').get(`sync:${key}`)?.value ?? 'null');
export const writeMeta = (db, key, value) =>
  db
    .prepare(
      'INSERT INTO metadata VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE value IS NOT excluded.value'
    )
    .run(`sync:${key}`, JSON.stringify(value));
const baseFor = (db, id) => {
  const row = db.prepare("SELECT * FROM sync_base WHERE collection = 'notes' AND id = ?").get(id);
  return row ? { revision: row.server_revision, value: JSON.parse(row.payload) } : { revision: null, value: null };
};
const setBase = (db, entry) =>
  db
    .prepare('INSERT OR REPLACE INTO sync_base VALUES (?, ?, ?, ?)')
    .run(entry.collection, entry.id, entry.revision, JSON.stringify(entry.value));
const replace = (state, entry) => {
  const index = state[entry.collection].findIndex(item => item.id === entry.id);
  if (index >= 0) state[entry.collection].splice(index, 1);
  if (entry.value) state[entry.collection].push(structuredClone(entry.value));
};
const conflictFor = (db, id) =>
  JSON.parse(db.prepare('SELECT payload FROM sync_conflicts WHERE note_id = ?').get(id)?.payload ?? 'null');

function confirmNote(db, id, revision) {
  const confirmed = readMeta(db, 'confirmed') ?? {};
  confirmed[id] = Math.max(confirmed[id] ?? 0, revision ?? 0);
  writeMeta(db, 'confirmed', confirmed);
}

function settleOutbox(db, state) {
  for (const note of state.notes) {
    if (equivalent(note, baseFor(db, note.id).value)) {
      const conflict = conflictFor(db, note.id);
      if (conflict) {
        db.prepare('INSERT INTO sync_recovery VALUES (?, ?)').run(
          randomUUID(),
          JSON.stringify({
            ...conflict,
            matchedLocal: note,
            choice: 'equivalent',
            resolvedAt: new Date().toISOString()
          })
        );
        db.prepare('DELETE FROM sync_conflicts WHERE note_id = ?').run(note.id);
      }
      confirmNote(
        db,
        note.id,
        db.prepare("SELECT revision FROM local_revisions WHERE collection = 'notes' AND id = ?").get(note.id)?.revision
      );
    }
  }
  const confirmed = readMeta(db, 'confirmed') ?? {};
  for (const row of db.prepare("SELECT operation_id, changes FROM sync_outbox WHERE state != 'acknowledged'").all()) {
    const changes = JSON.parse(row.changes);
    const notes = changes.filter(change => change.collection === 'notes');
    const contextWrites = changes.some(change =>
      ['folders', 'tags', 'tagGroups', 'spaces', 'attachments'].includes(change.collection)
    );
    let status = 'pending';
    if (!notes.length || contextWrites) status = 'blocked_dependency';
    else if (notes.every(change => (confirmed[change.entityId] ?? 0) >= change.localRevision)) status = 'acknowledged';
    else if (notes.some(change => conflictFor(db, change.entityId))) status = 'conflict';
    else if (
      notes.some(change => db.prepare('SELECT note_id FROM sync_uploads WHERE note_id = ?').get(change.entityId))
    )
      status = 'sending';
    db.prepare('UPDATE sync_outbox SET state = ? WHERE operation_id = ?').run(status, row.operation_id);
  }
  compactAcknowledgedOutbox(db);
}

export function applyRemote(store, entries, cursor, epoch, { reset = false } = {}) {
  store.syncTransaction((db, state) => {
    observeRemoteDeletionFacts(db, entries, { epoch });
    const previousEpoch = readMeta(db, 'epoch');
    const changedEpoch = previousEpoch && previousEpoch !== epoch;
    if (reset) {
      const keys = new Set(entries.map(entry => syncKey(entry.collection, entry.id)));
      for (const row of db.prepare('SELECT * FROM sync_base').all()) {
        if (!keys.has(syncKey(row.collection, row.id)))
          entries.push({ collection: row.collection, id: row.id, revision: null, value: null });
      }
      if (changedEpoch) {
        const noteIds = new Set(entries.filter(entry => entry.collection === 'notes').map(entry => entry.id));
        for (const note of state.notes)
          if (!noteIds.has(note.id)) entries.push({ collection: 'notes', id: note.id, revision: null, value: null });
      }
    }
    for (const entry of entries) {
      if (!LOCAL_DATA_COLLECTIONS.includes(entry.collection)) throw new Error('同步实体类型不兼容，请升级客户端。');
      if (entry.collection !== 'notes') continue;
      const local = state.notes.find(note => note.id === entry.id) ?? null;
      if (local && entry.value?.aiVisibility === 'private' && local.aiVisibility !== 'private') {
        local.aiVisibility = 'private';
        local.updatedAt = new Date(Math.max(Date.now(), Date.parse(local.updatedAt) + 1 || 0)).toISOString();
      }
      const base = baseFor(db, entry.id);
      const existing = conflictFor(db, entry.id);
      if (
        existing ||
        (!equivalent(local, base.value) &&
          !equivalent(local, entry.value) &&
          (changedEpoch || base.revision !== entry.revision || !previousEpoch))
      ) {
        db.prepare('INSERT OR REPLACE INTO sync_conflicts VALUES (?, ?)').run(
          entry.id,
          JSON.stringify({
            noteId: entry.id,
            kind: !entry.value || entry.value.deleted || local?.deleted ? 'delete' : 'edit',
            base: existing?.base ?? base.value,
            local,
            remote: entry.value,
            remoteRevision: entry.revision,
            datasetEpoch: epoch,
            changedAt: new Date().toISOString()
          })
        );
      } else if (equivalent(local, base.value) || equivalent(local, entry.value)) replace(state, entry);
      setBase(db, entry);
    }
    // 来源版本保持不可变；本地未同步正文生成的版本仍是可恢复的引用依据。
    for (const entry of entries.filter(item => item.collection !== 'notes')) {
      const previous = db
        .prepare('SELECT payload FROM sync_base WHERE collection = ? AND id = ?')
        .get(entry.collection, entry.id);
      const local = state[entry.collection].find(item => item.id === entry.id);
      const locallyChanged =
        local &&
        previous &&
        ['folders', 'tags', 'tagGroups', 'spaces'].includes(entry.collection) &&
        JSON.stringify(local) !== previous.payload;
      const branch =
        local?.noteId &&
        state.notes.some(
          note =>
            note.id === local.noteId && (conflictFor(db, note.id) || !equivalent(note, baseFor(db, note.id).value))
        );
      const referencedContext =
        (!entry.value &&
          state.notes.some(
            note =>
              (entry.collection === 'folders' && note.folderId === entry.id) ||
              (entry.collection === 'tags' && note.tagIds.includes(entry.id)) ||
              (entry.collection === 'spaces' && note.spaceId === entry.id)
          )) ||
        (!entry.value &&
          entry.collection === 'folders' &&
          state.folders.some(folder => folder.parentId === entry.id)) ||
        (!entry.value && entry.collection === 'tagGroups' && state.tags.some(tag => tag.groupId === entry.id));
      if (!locallyChanged && !branch && !referencedContext) replace(state, entry);
      setBase(db, entry);
    }
    // 本机创建的历史版本不在云端删除日志中，也不能让它们复活已删除的干净笔记。
    const noteIds = new Set(state.notes.map(note => note.id));
    for (const collection of ['noteVersions', 'attachments', 'contentAnnotations']) {
      state[collection].splice(
        0,
        state[collection].length,
        ...state[collection].filter(item => noteIds.has(item.noteId))
      );
    }
    if (changedEpoch) db.prepare('DELETE FROM sync_uploads').run();
    writeMeta(db, 'cursor', cursor);
    writeMeta(db, 'epoch', epoch);
    writeMeta(db, 'bootstrap', null);
    settleOutbox(db, state);
  });
}

export function nextUpload(store) {
  return store.syncTransaction((db, state) => {
    const frozen = db.prepare('SELECT request FROM sync_uploads LIMIT 1').get();
    if (frozen) return JSON.parse(frozen.request);
    const epoch = readMeta(db, 'epoch');
    if (!epoch) return null;
    for (const note of state.notes) {
      const base = baseFor(db, note.id);
      if (equivalent(note, base.value) || conflictFor(db, note.id)) continue;
      if (readMeta(db, 'blocked')?.[note.id]?.value === JSON.stringify(noteContent(note))) continue;
      const request = {
        protocolVersion: 1,
        datasetEpoch: epoch,
        deviceId: store.getStatus().deviceId,
        operationId: randomUUID(),
        noteId: note.id,
        baseRevision: base.revision,
        value: noteContent(note)
      };
      const revision =
        db.prepare("SELECT revision FROM local_revisions WHERE collection = 'notes' AND id = ?").get(note.id)
          ?.revision ?? 0;
      db.prepare('INSERT INTO sync_uploads VALUES (?, ?, ?)').run(note.id, JSON.stringify(request), revision);
      settleOutbox(db, state);
      return request;
    }
    return null;
  });
}

export function acknowledge(store, operation, result) {
  store.syncTransaction((db, state) => {
    const entry = result.current;
    observeRemoteDeletionFacts(db, [entry], { epoch: operation.datasetEpoch });
    const local = state.notes.find(note => note.id === operation.noteId);
    if (result.status === 'conflict' && !equivalent(local, entry.value)) {
      db.prepare('INSERT OR REPLACE INTO sync_conflicts VALUES (?, ?)').run(
        operation.noteId,
        JSON.stringify({
          noteId: operation.noteId,
          kind: !entry.value || entry.value.deleted || local?.deleted ? 'delete' : 'edit',
          base: baseFor(db, operation.noteId).value,
          local,
          remote: entry.value,
          remoteRevision: entry.revision,
          datasetEpoch: operation.datasetEpoch,
          changedAt: new Date().toISOString()
        })
      );
    } else if (equivalent(local, operation.value) || equivalent(local, entry.value)) replace(state, entry);
    if (entry.value?.aiVisibility === 'private') {
      const retained = state.notes.find(note => note.id === operation.noteId);
      if (retained && retained.aiVisibility !== 'private') {
        retained.aiVisibility = 'private';
        retained.updatedAt = new Date(Math.max(Date.now(), Date.parse(retained.updatedAt) + 1 || 0)).toISOString();
      }
    }
    setBase(db, entry);
    if (result.status === 'accepted')
      confirmNote(
        db,
        operation.noteId,
        db.prepare('SELECT local_revision FROM sync_uploads WHERE note_id = ?').get(operation.noteId)?.local_revision
      );
    const blocked = readMeta(db, 'blocked') ?? {};
    delete blocked[operation.noteId];
    writeMeta(db, 'blocked', blocked);
    db.prepare('DELETE FROM sync_uploads WHERE note_id = ?').run(operation.noteId);
    settleOutbox(db, state);
  });
}

const statusCache = new WeakMap();
const pendingNotesCache = new WeakMap();
export function getSyncState(store) {
  const key = store.getSyncCacheKey();
  const cached = statusCache.get(store);
  if (key !== null && cached?.key === key) return cached.value;
  const entityKey = store.getEntityCacheKey();
  let pending = pendingNotesCache.get(store);
  if (entityKey === null || pending?.key !== entityKey) {
    pending = {
      key: entityKey,
      count: store.readSync(
        (db, state) => state.notes.filter(note => !equivalent(note, baseFor(db, note.id).value)).length
      )
    };
    if (entityKey !== null) pendingNotesCache.set(store, pending);
  }
  const value = store.readSync((db, state) => ({
    serverUrl: readMeta(db, 'serverUrl'),
    ownerId: readMeta(db, 'ownerId'),
    generation: readMeta(db, 'generation') ?? 0,
    lastSyncedAt: readMeta(db, 'lastSyncedAt'),
    conflicts: db
      .prepare('SELECT payload FROM sync_conflicts')
      .all()
      .map(row => {
        const item = JSON.parse(row.payload);
        return { ...item, local: structuredClone(state.notes.find(note => note.id === item.noteId) ?? item.local) };
      }),
    pendingNotes: pending.count,
    blockedNotes: Object.values(readMeta(db, 'blocked') ?? {}).filter(item =>
      state.notes.some(note => note.id === item.noteId && JSON.stringify(noteContent(note)) === item.value)
    )
  }));
  if (key !== null) statusCache.set(store, { key, value });
  return value;
}

export function resolveConflict(store, { noteId, choice, rawMarkdown, remoteRevision, datasetEpoch }, noteService) {
  store.syncTransaction(
    (db, state) => {
      const conflict = conflictFor(db, noteId);
      if (!conflict || conflict.remoteRevision !== remoteRevision || conflict.datasetEpoch !== datasetEpoch)
        throw new Error('云端版本已变化，请重新查看冲突。');
      if (!['remote', 'local', 'copy', 'manual'].includes(choice)) throw new Error('请选择有效的冲突处理方式。');
      const local = state.notes.find(note => note.id === noteId) ?? conflict.local;
      if (local && conflict.remote?.aiVisibility === 'private') local.aiVisibility = 'private';
      db.prepare('INSERT INTO sync_recovery VALUES (?, ?)').run(
        randomUUID(),
        JSON.stringify({ ...conflict, local, choice, resolvedAt: new Date().toISOString() })
      );
      if (choice === 'remote' || choice === 'copy' || !conflict.remote)
        replace(state, { collection: 'notes', id: noteId, value: conflict.remote });
      if (choice === 'copy' || (!conflict.remote && choice !== 'remote')) {
        if (!local) throw new Error('没有可保留的本地正文。');
        if (!noteService) throw new Error('缺少笔记业务服务，无法创建恢复副本。');
        noteService.createNote({
          ...noteContent(local),
          id: randomUUID(),
          title: `${local.title}（本地副本 ${randomUUID().slice(0, 4)}）`,
          deleted: false,
          ...(choice === 'manual' ? { rawMarkdown: String(rawMarkdown ?? '') } : {})
        });
      } else if (choice === 'manual') {
        if (typeof rawMarkdown !== 'string') throw new Error('请填写合并后的正文。');
        if (!noteService) throw new Error('缺少笔记业务服务，无法合并正文。');
        if (local?.deleted) noteService.restoreNote(noteId);
        noteService.updateNote(noteId, { rawMarkdown });
      }
      if (!conflict.remote) {
        confirmNote(
          db,
          noteId,
          (db.prepare("SELECT revision FROM local_revisions WHERE collection = 'notes' AND id = ?").get(noteId)
            ?.revision ?? 0) + 1
        );
        const removedAnnotations = new Set(
          state.contentAnnotations.filter(item => item.noteId === noteId).map(item => item.id)
        );
        for (const collection of ['noteVersions', 'attachments', 'contentAnnotations'])
          state[collection].splice(
            0,
            state[collection].length,
            ...state[collection].filter(item => item.noteId !== noteId)
          );
        for (const collection of ['annotationExclusions', 'annotationRevisions'])
          state[collection].splice(
            0,
            state[collection].length,
            ...state[collection].filter(item => !removedAnnotations.has(item.annotationId ?? item.parentAnnotationId))
          );
      }
      db.prepare('DELETE FROM sync_conflicts WHERE note_id = ?').run(noteId);
      db.prepare('DELETE FROM sync_uploads WHERE note_id = ?').run(noteId);
    },
    { local: true, origin: 'sync-resolution' }
  );
}
