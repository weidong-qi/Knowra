import fs from 'node:fs';
import { createActionStore, emptyActionState, validateActionState } from '../../api/src/modules/ai/action-state.ts';
import { hashRecord } from '../../api/src/modules/ai/record-contract.ts';

export function createSqliteActionStore(db, filePath, transaction) {
  const version = db.prepare("SELECT value FROM metadata WHERE key = 'aiNoteActionsVersion'").get()?.value;
  if (version === undefined) {
    const backup = `${filePath}.before-ai-note-actions-${Date.now()}.bak`;
    db.prepare('VACUUM INTO ?').run(backup);
    fs.chmodSync(backup, 0o600);
    db.exec(`BEGIN IMMEDIATE; CREATE TABLE ai_note_action_state (id INTEGER PRIMARY KEY CHECK(id = 1), state_json TEXT NOT NULL, state_hash TEXT NOT NULL);
      INSERT INTO metadata VALUES ('aiNoteActionsVersion', '1'); COMMIT;`);
  } else if (version !== '1') throw new Error('动作账本版本无效，原数据库保留。');
  const identity = () => ({
    datasetId: db.prepare("SELECT value FROM metadata WHERE key = 'datasetId'").get().value,
    datasetEpoch: db.prepare("SELECT value FROM metadata WHERE key = 'aiRuntimeEpoch'").get().value
  });
  const read = () => validateSqliteActionRows(db);
  read();
  return createActionStore({
    transaction,
    identity,
    read,
    write: operation =>
      transaction(() => {
        const output = operation(read(), identity());
        db.prepare(
          `INSERT INTO ai_note_action_state VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE
      SET state_json = excluded.state_json, state_hash = excluded.state_hash`
        ).run(JSON.stringify(output.state), hashRecord(output.state));
        return output.result;
      })
  });
}

export function validateSqliteActionRows(db) {
  const version = db.prepare("SELECT value FROM metadata WHERE key = 'aiNoteActionsVersion'").get()?.value;
  if (version === undefined) return emptyActionState();
  if (version !== '1') throw new Error('动作账本版本无效。');
  const row = db.prepare('SELECT * FROM ai_note_action_state WHERE id = 1').get();
  if (!row) return emptyActionState();
  const raw = JSON.parse(row.state_json);
  if (hashRecord(raw) !== row.state_hash) throw new Error('动作账本索引与正文不一致。');
  return validateActionState(raw);
}
