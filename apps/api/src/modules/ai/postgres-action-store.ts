import type { PrivateStoreOptions, ActionState } from './private-store-types.ts';
import type { DatasetIdentity } from '../task-workspaces/repository-port.ts';
import { createActionStore, emptyActionState, validateActionState } from './action-state.ts';
import { hashRecord } from './record-contract.ts';

export function createPostgresActionStore({ client, repository, ownerId }: PrivateStoreOptions) {
  async function load(): Promise<ActionState> {
    const [row] = await client.$queryRawUnsafe<{ state_json: string; state_hash: string }[]>(
      'SELECT state_json, state_hash FROM ai_note_action_states WHERE owner_id = $1',
      ownerId
    );
    if (!row) return emptyActionState();
    const raw = JSON.parse(row.state_json);
    if (hashRecord(raw) !== row.state_hash) throw new Error('动作账本索引与正文不一致。');
    return validateActionState(raw);
  }
  return createActionStore({
    transaction: <Result>(operation: () => Result | Promise<Result>) =>
      client.$transaction(async () => {
        await client.$queryRawUnsafe('SELECT pg_advisory_xact_lock(1266775634, 32)::text');
        return operation();
      }),
    identity: () => repository.identity(),
    read: load,
    write: <Result>(
      operation: (state: ActionState, identity: DatasetIdentity) => { state: ActionState; result: Result }
    ) =>
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
