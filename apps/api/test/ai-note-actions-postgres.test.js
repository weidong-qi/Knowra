import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPostgresAppContext } from '../src/postgres-app.factory.ts';
import { createPostgresTestDatabase } from '../../../scripts/test-support/postgres-test-database.mjs';
import { hashRecord } from '../src/modules/ai/record-contract.ts';
import { createPostgresAiAccessStore } from '../src/modules/ai/postgres-access-store.ts';
import { createPostgresActionStore } from '../src/modules/ai/postgres-action-store.ts';
import { createNoteActionService } from '../src/modules/ai/action-service.ts';
import { noteActionScenarios } from './fixtures/note-action-scenarios.js';
async function withFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-p2-pg-')),
    ownerId = `p2-${randomUUID()}`;
  let database,
    app,
    actions,
    actionStore,
    time = Date.now();
  const restart = async () => {
    await app?.close();
    app = await createPostgresAppContext({ databaseUrl: database.databaseUrl, ownerId, storageRootDir: root });
    actionStore = createPostgresActionStore({ client: app.prisma, repository: app.ai.repository, ownerId });
    actions = createNoteActionService({
      store: actionStore,
      core: app.coreOperationStore,
      knowledge: { ...app.modules.knowledge, repositories: app.repositories },
      ownerId,
      asyncDomain: true,
      conversationStore: app.ai.conversationStore,
      accessStore: app.ai.accessStore,
      access: app.ai.access,
      now: () => new Date(time)
    });
  };
  try {
    database = await createPostgresTestDatabase();
    await restart();
    const space = await app.http.knowledge.createDefaultKnowledgeSpace();
    await run({
      databaseUrl: database.databaseUrl,
      root,
      get app() {
        return app;
      },
      space,
      ownerId,
      get actions() {
        return actions;
      },
      get access() {
        return app.ai.access;
      },
      get conversations() {
        return app.ai.conversationStore;
      },
      get core() {
        return app.coreOperationStore;
      },
      get actionStore() {
        return actionStore;
      },
      restart,
      rawActionState: async () =>
        JSON.parse(
          (
            await app.prisma.$queryRawUnsafe('SELECT state_json FROM ai_note_action_states WHERE owner_id=$1', ownerId)
          )[0].state_json
        ),
      legacy: state =>
        app.prisma.$executeRawUnsafe(
          'UPDATE ai_note_action_states SET state_json=$1,state_hash=$2 WHERE owner_id=$3',
          JSON.stringify(state),
          hashRecord(state),
          ownerId
        ),
      advance: ms => {
        time += ms;
      },
      rotate: () => app.ai.repository.rotateEpoch(),
      createFolder: input => app.modules.knowledge.folderService.createFolder({ ...input, spaceId: space.id }),
      createTag: input => app.modules.knowledge.tagService.createTag({ ...input, spaceId: space.id }),
      updateTag: (id, input) => app.modules.knowledge.tagService.updateTag(id, input),
      create: input => app.modules.knowledge.noteService.createNote({ ...input, spaceId: space.id }),
      update: (id, input) => app.modules.knowledge.noteService.updateNote(id, input),
      getNote: (id, includeDeleted = false) => app.modules.knowledge.noteService.getNote(id, { includeDeleted }),
      notes: () => app.modules.knowledge.noteService.listNotes()
    });
  } finally {
    await app?.close();
    await database?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}
const lockTests = [
  {
    name: 'PostgreSQL P2 授权撤销与核心提交共享事务锁，不可插入校验后窗口',
    run: () =>
      withFixture(async f => {
        const note = await f.create({ title: '同锁授权', rawMarkdown: '合成正文' }),
          policy = await f.app.ai.access.createPolicy({
            spaceId: f.space.id,
            scope: { kind: 'fixed', noteIds: [note.id] },
            excludedNoteIds: [],
            includeAttachments: false,
            read: true,
            egress: true,
            recipients: ['deepseek'],
            expiresAt: new Date(Date.now() + 86400000).toISOString()
          });
        const conversations = f.app.ai.conversationStore,
          conversation = await conversations.createConversation({
            ownerId: f.ownerId,
            actorId: f.ownerId,
            spaceId: f.space.id
          });
        const submitted = await conversations.submitTurn({
            ownerId: f.ownerId,
            conversationId: conversation.conversationId,
            content: '追加合成正文',
            idempotencyKey: 'pg-policy-lock',
            requestedPolicyId: policy.policyId,
            writeIntent: { toolName: 'notes_append', noteId: note.id }
          }),
          turn = await conversations.claimTurn(submitted.turnId);
        const action = await f.actions.planForTurn(turn, turn.writeIntent, {
          name: 'notes_append',
          arguments: { noteId: note.id, rawMarkdown: '\n一次追加' }
        });
        await conversations.completeTurn(turn.turnId, turn.leaseGeneration, { content: '合成计划', sourceFree: true });
        await f.actions.approve(action.actionId, { planHash: action.plan.planHash });
        const contender = await createPostgresAppContext({
          databaseUrl: f.databaseUrl,
          ownerId: f.ownerId,
          storageRootDir: path.join(f.root, 'contender')
        });
        let enter, release;
        const entered = new Promise(resolve => {
            enter = resolve;
          }),
          held = new Promise(resolve => {
            release = resolve;
          }),
          peek = f.app.ai.accessStore.peek;
        f.app.ai.accessStore.peek = async (...args) => {
          const value = await peek(...args);
          enter();
          await held;
          return value;
        };
        const apply = f.actions.apply(action.actionId);
        apply.catch(() => {});
        let revoke;
        try {
          await entered;
          const revokeStore = createPostgresAiAccessStore({
            client: contender.prisma,
            ownerId: f.ownerId,
            repository: { identity: () => ({ datasetId: policy.datasetId, datasetEpoch: policy.datasetEpoch }) }
          });
          revoke = revokeStore.replacePolicy(
            { ...policy, revision: 2, revokedAt: new Date().toISOString() },
            hashRecord(policy)
          );
          revoke.catch(() => {});
          let blocked = false;
          for (let i = 0; i < 200; i++) {
            const rows = await contender.prisma.$queryRawUnsafe(
              "SELECT count(*)::integer AS count FROM pg_locks WHERE locktype = 'advisory' AND classid = 1266775634 AND objid = 32 AND NOT granted"
            );
            if (rows[0].count > 0) {
              blocked = true;
              break;
            }
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          assert.equal(blocked, true, '撤销必须等待核心事务锁');
          release();
          assert.equal((await apply).status, 'applied');
          await revoke;
          assert.equal((await f.getNote(note.id)).rawMarkdown, '合成正文\n一次追加');
        } finally {
          release();
          await Promise.allSettled([apply, revoke]);
          f.app.ai.accessStore.peek = peek;
          await contender.close();
        }
      })
  }
];
export const aiNoteActionPostgresTests =
  process.env.KNOWRA_SYNC_TEST_DATABASE_URL && process.env.KNOWRA_SYNC_TEST_ALLOW_WRITES === '1'
    ? [...noteActionScenarios(withFixture), ...lockTests].map(row => ({ ...row, name: `PostgreSQL ${row.name}` }))
    : [];
