import { createSyncService } from './service.js';
import { createBatchSyncService } from './batch-service.js';
import { thenResult } from './journal.ts';
import { compactSnapshotEntries, readCompactSnapshot } from './compact-snapshot.ts';

export function applyNoteOperation(service, operation, current) {
  const { deleted, ...fields } = operation.value;
  if (!current)
    return thenResult(service.createNote({ id: operation.noteId, ...fields }), () =>
      deleted ? service.deleteNote(operation.noteId) : undefined
    );
  const restore = current.deleted && !deleted ? service.restoreNote(operation.noteId) : undefined;
  return thenResult(restore, () =>
    thenResult(service.updateNote(operation.noteId, { ...fields }), () =>
      deleted && !current.deleted ? service.deleteNote(operation.noteId) : undefined
    )
  );
}

export function createLocalSyncService(dataStore, noteService, ownerId, transfer) {
  if (!dataStore.getSyncJournal) return null;
  const provider = {
    historyReferences: () => (dataStore.getHistoryRetentionReferences ? dataStore.getHistoryRetentionReferences() : []),
    snapshotEntries: compactSnapshotEntries,
    readSnapshotEntries: readCompactSnapshot,
    mutateJournal: callback =>
      dataStore.runSyncJournalTransaction
        ? dataStore.runSyncJournalTransaction(() => callback(dataStore.state, dataStore.getSyncJournal()))
        : dataStore.runSyncTransaction(() => callback(dataStore.state, dataStore.getSyncJournal())),
    read: callback => callback(dataStore.state, dataStore.getSyncJournal()),
    mutate: callback => dataStore.runSyncTransaction(() => callback(dataStore.state, dataStore.getSyncJournal())),
    mutateBatch: callback =>
      (dataStore.runSyncBatchTransaction ?? dataStore.runSyncTransaction)(() =>
        callback(dataStore.state, dataStore.getSyncJournal())
      ),
    preview: () => ({ state: dataStore.state, journal: dataStore.previewSyncJournal() }),
    applyState: next => {
      for (const [collection, items] of Object.entries(next))
        dataStore.state[collection].splice(0, dataStore.state[collection].length, ...items);
    },
    applyNote: (operation, current) => applyNoteOperation(noteService, operation, current)
  };
  return { ...createSyncService(provider, ownerId), ...createBatchSyncService(provider, ownerId, transfer) };
}
