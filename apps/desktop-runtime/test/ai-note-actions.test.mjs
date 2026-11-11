import assert from 'node:assert/strict';
import { createRuntimeBackup, inspectRuntimeBackup, restoreRuntimeBackup } from '../src/backup.mjs';
import { hashRecord } from '../../api/src/modules/ai/record-contract.ts';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSqliteDataStore } from '../src/sqlite-data-store.mjs';
import { createAppContext } from '../../api/src/app.factory.js';
import { createAiAccessService } from '../../api/src/modules/ai/access-service.ts';
import { createNoteActionService } from '../../api/src/modules/ai/action-service.ts';
import { noteActionScenarios } from '../../api/test/fixtures/note-action-scenarios.js';
async function withFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-p2-sqlite-'));
  let store,
    app,
    actions,
    access,
    time = Date.now();
  const restart = () => {
    store?.close();
    store = createSqliteDataStore(path.join(root, 'local.sqlite'));
    app = createAppContext({ dataStore: store, ownerId: 'test', storageRootDir: root });
    access = createAiAccessService({
      store: store.aiAccessStore,
      ...app.modules.knowledge.repositories,
      spaceRepository: app.modules.knowledge.repositories.knowledgeSpaceRepository,
      ownerId: 'test'
    });
    actions = createNoteActionService({
      store: store.aiActionStore,
      core: store.coreOperationStore,
      knowledge: app.modules.knowledge,
      ownerId: 'test',
      conversationStore: store.aiConversationStore,
      accessStore: store.aiAccessStore,
      access,
      now: () => new Date(time)
    });
  };
  try {
    restart();
    const space = app.http.knowledge.createDefaultKnowledgeSpace();
    await run({
      root,
      get store() {
        return store;
      },
      space,
      ownerId: 'test',
      get actions() {
        return actions;
      },
      get access() {
        return access;
      },
      get conversations() {
        return store.aiConversationStore;
      },
      get core() {
        return store.coreOperationStore;
      },
      get actionStore() {
        return store.aiActionStore;
      },
      restart,
      rawActionState: () =>
        store.readSync(db =>
          JSON.parse(db.prepare('SELECT state_json FROM ai_note_action_state WHERE id=1').get().state_json)
        ),
      legacy: state =>
        store.readSync(db =>
          db
            .prepare('UPDATE ai_note_action_state SET state_json=?,state_hash=? WHERE id=1')
            .run(JSON.stringify(state), hashRecord(state))
        ),
      advance: ms => {
        time += ms;
      },
      rotate: () => store.aiRepository.rotateEpoch(),
      createFolder: input => app.modules.knowledge.folderService.createFolder({ ...input, spaceId: space.id }),
      createTag: input => app.modules.knowledge.tagService.createTag({ ...input, spaceId: space.id }),
      updateTag: (id, input) => app.modules.knowledge.tagService.updateTag(id, input),
      create: input => app.modules.knowledge.noteService.createNote({ ...input, spaceId: space.id }),
      update: (id, input) => app.modules.knowledge.noteService.updateNote(id, input),
      getNote: (id, includeDeleted = false) => app.modules.knowledge.noteService.getNote(id, { includeDeleted }),
      notes: () => app.modules.knowledge.noteService.listNotes()
    });
  } finally {
    store?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}
for (const scenario of noteActionScenarios(withFixture)) test(`SQLite ${scenario.name}`, scenario.run);

test('SQLite P2 完整备份恢复动作、回执及草稿，旋转 epoch 阻止旧确认', () =>
  withFixture(async f => {
    const applied = await f.actions.plan({
      spaceId: f.space.id,
      requestId: 'backup-applied',
      toolName: 'notes_create',
      arguments: { title: '备份记录', rawMarkdown: '合成' }
    });
    await f.actions.approve(applied.actionId, { planHash: applied.plan.planHash });
    const committed = await f.actions.apply(applied.actionId);
    const pending = await f.actions.plan({
      spaceId: f.space.id,
      requestId: 'backup-pending',
      toolName: 'notes_append',
      arguments: { noteId: applied.plan.items[0].after.id, rawMarkdown: '旧追加' }
    });
    await f.actions.approve(pending.actionId, { planHash: pending.plan.planHash });
    await f.actions.draft({ noteId: applied.plan.items[0].after.id, clientId: 'backup-draft', dirty: true });
    const backup = createRuntimeBackup(f.store, f.root);
    assert.equal(inspectRuntimeBackup(backup).valid, true);
    const destination = path.join(f.root, 'restored');
    restoreRuntimeBackup(backup, destination);
    const restored = createSqliteDataStore(path.join(destination, 'local.sqlite'));
    try {
      const app = createAppContext({ dataStore: restored, ownerId: 'test', storageRootDir: destination }),
        actions = createNoteActionService({
          store: restored.aiActionStore,
          core: restored.coreOperationStore,
          knowledge: app.modules.knowledge,
          ownerId: 'test'
        });
      assert.equal(restored.aiActionStore.read().drafts.length, 1);
      assert.deepEqual((await actions.get(applied.actionId)).receipt, committed.receipt);
      restored.aiRepository.rotateEpoch();
      await assert.rejects(actions.apply(pending.actionId), { code: 'AI_DATASET_STALE' });
      assert.deepEqual((await actions.apply(applied.actionId)).receipt, committed.receipt);
      assert.equal(app.modules.knowledge.noteService.getNote(applied.plan.items[0].after.id).rawMarkdown, '合成');
    } finally {
      restored.close();
    }
  }));
