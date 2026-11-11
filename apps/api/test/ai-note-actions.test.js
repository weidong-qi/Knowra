import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFileDataStore } from '../src/infrastructure/file-data-store.ts';
import { createAppContext } from '../src/app.factory.js';
import { createAiAccessService } from '../src/modules/ai/access-service.ts';
import { createNoteActionService } from '../src/modules/ai/action-service.ts';
import { noteActionScenarios } from './fixtures/note-action-scenarios.js';
export async function withJsonActionFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-p2-json-'));
  let store,
    context,
    actions,
    access,
    time = Date.now();
  const restart = () => {
    store = createFileDataStore(path.join(root, 'data.json'));
    context = createAppContext({ dataStore: store, ownerId: 'test', storageRootDir: root });
    access = createAiAccessService({
      store: store.aiAccessStore,
      ...context.modules.knowledge.repositories,
      spaceRepository: context.modules.knowledge.repositories.knowledgeSpaceRepository,
      ownerId: 'test'
    });
    actions = createNoteActionService({
      store: store.aiActionStore,
      core: store.coreOperationStore,
      knowledge: context.modules.knowledge,
      ownerId: 'test',
      conversationStore: store.aiConversationStore,
      accessStore: store.aiAccessStore,
      access,
      now: () => new Date(time)
    });
  };
  try {
    restart();
    const space = context.http.knowledge.createDefaultKnowledgeSpace();
    await run({
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
      rawActionState: () => JSON.parse(fs.readFileSync(path.join(root, 'data.json'), 'utf8')).aiRuntime.actionLedger,
      legacy: state => {
        const file = path.join(root, 'data.json'),
          doc = JSON.parse(fs.readFileSync(file, 'utf8'));
        doc.aiRuntime.actionLedger = state;
        fs.writeFileSync(file, JSON.stringify(doc));
      },
      advance: ms => {
        time += ms;
      },
      rotate: () => store.aiRepository.rotateEpoch(),
      createFolder: input => context.modules.knowledge.folderService.createFolder({ ...input, spaceId: space.id }),
      createTag: input => context.modules.knowledge.tagService.createTag({ ...input, spaceId: space.id }),
      updateTag: (id, input) => context.modules.knowledge.tagService.updateTag(id, input),
      create: input => context.modules.knowledge.noteService.createNote({ ...input, spaceId: space.id }),
      update: (id, input) => context.modules.knowledge.noteService.updateNote(id, input),
      getNote: (id, includeDeleted = false) => context.modules.knowledge.noteService.getNote(id, { includeDeleted }),
      notes: () => context.modules.knowledge.noteService.listNotes()
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
export const aiNoteActionTests = noteActionScenarios(withJsonActionFixture);
