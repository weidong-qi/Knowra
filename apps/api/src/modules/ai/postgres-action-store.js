import { createActionStore, emptyActionState, validateActionState } from './action-state.js';
import { hashRecord } from './record-contract.ts';

export function createPostgresActionStore({ client, repository, ownerId }) {
  async function load() {
    const [row] = await client.$queryRawUnsafe(
      'SELECT state_json, state_hash FROM ai_note_action_states WHERE owner_id = $1',
      ownerId
    );
    if (!row) return emptyActionState();
    const raw = JSON.parse(row.state_json);
    if (hashRecord(raw) !== row.state_hash) throw new Error('动作账本索引与正文不一致。');
    return validateActionState(raw);
  }
  return createActionStore({
    transaction: operation =>
      client.$transaction(async () => {
        await client.$queryRawUnsafe('SELECT pg_advisory_xact_lock(1266775634, 32)::text');
        return operation();
      }),
    identity: () => repository.identity(),
    read: load,
    write: operation =>
      client.$transaction(async () => {
        await client.$queryRawUnsafe('SELECT pg_advisory_xact_lock(1266775634, 32)::text');
        const output = operation(await load(), await repository.identity());
        await client.$executeRawUnsafe(
          `INSERT INTO ai_note_action_states (owner_id, state_json, state_hash)
        VALUES ($1, $2, $3) ON CONFLICT (owner_id) DO UPDATE SET state_json = EXCLUDED.state_json, state_hash = EXCLUDED.state_hash`,
          ownerId,
          JSON.stringify(output.state),
          hashRecord(output.state)
        );
        return output.result;
      })
  });
}
