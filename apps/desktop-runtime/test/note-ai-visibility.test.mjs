import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCreateNoteDto, buildUpdateNoteDto } from '../../api/src/modules/knowledge/application/dto/note.dto.js';
import { applyNoteOperation } from '../../api/src/modules/sync/local-provider.ts';
import { assertSyncContract, syncContract } from '../../api/src/modules/sync/protocol-contract.ts';
import { createNoteService } from '../../api/src/modules/knowledge/application/note-service.js';
import { noteContent } from '../../api/src/modules/sync/journal.ts';
import {
  applyEntityRemote,
  getEntitySyncState,
  resolveEntityConflict,
  nextEntityUpload,
  acknowledgeEntityUpload
} from '../src/entity-sync-state.mjs';
import { applyRemote, nextUpload, acknowledge, resolveConflict } from '../src/sync-state.mjs';
import { isAiReadableNote } from '../../api/src/modules/ai/note-privacy.js';
import { openWorkspace, temporaryDirectory } from './helpers.mjs';

test('普通缺省、非法值拒绝；旧PATCH及旧笔记同步缺省保留私密状态', () => {
  assert.equal(buildCreateNoteDto({ rawMarkdown: '合成正文' }).aiVisibility, 'normal');
  for (const aiVisibility of [null, '', 'public', true]) {
    assert.throws(() => buildCreateNoteDto({ rawMarkdown: '正文', aiVisibility }), {
      code: 'NOTE_AI_VISIBILITY_INVALID'
    });
    assert.throws(() => buildUpdateNoteDto({ aiVisibility }), { code: 'NOTE_AI_VISIBILITY_INVALID' });
  }
  const service = createNoteService();
  const note = service.createNote({ title: '私密合成', rawMarkdown: '正文', aiVisibility: 'private' });
  assert.equal(service.updateNote(note.id, { title: '旧端编辑' }).aiVisibility, 'private');
  const value = noteContent(service.getNote(note.id));
  delete value.aiVisibility;
  applyNoteOperation(service, { noteId: note.id, value }, service.getNote(note.id));
  assert.equal(service.getNote(note.id).aiVisibility, 'private');
  assert.equal(noteContent(service.getNote(note.id)).aiVisibility, 'private');
});

test('隐私能力门禁拒绝旧客户端；schema8伪造缺少隐私能力同样拒绝', () => {
  assert.throws(() => assertSyncContract({ ...syncContract(), entitySchemaVersion: 7 }), {
    code: 'SYNC_CLIENT_UPGRADE_REQUIRED'
  });
  assert.throws(
    () =>
      assertSyncContract({
        ...syncContract(),
        capabilities: syncContract().capabilities.filter(v => v !== 'note-ai-visibility-v1')
      }),
    { code: 'SYNC_CLIENT_UPGRADE_REQUIRED' }
  );
});

test('SQLite重启保留私密；云端私密化在本地正文冲突时立即隔离且保留正文', t => {
  for (const choice of ['local', 'copy']) {
    const directory = temporaryDirectory(t);
    let workspace = openWorkspace(directory);
    const note = workspace.knowledge.noteService.createNote({
      title: '合成冲突',
      rawMarkdown: '基线',
      spaceId: workspace.space.id
    });
    const entries = [
      { collection: 'spaces', id: workspace.space.id, revision: 1, value: { ...workspace.space } },
      { collection: 'notes', id: note.id, revision: 1, value: { ...note } }
    ];
    applyEntityRemote(workspace.store, entries, 'synthetic-cursor-1', 'synthetic-epoch');
    workspace.knowledge.noteService.updateNote(note.id, { rawMarkdown: '本地未合并正文' });
    applyEntityRemote(
      workspace.store,
      [{ ...entries[1], revision: 2, value: { ...note, aiVisibility: 'private' } }],
      'synthetic-cursor-2',
      'synthetic-epoch'
    );
    const privateLocal = workspace.knowledge.noteService.getNote(note.id);
    assert.equal(privateLocal.rawMarkdown, '本地未合并正文');
    assert.equal(privateLocal.aiVisibility, 'private');
    const conflict = getEntitySyncState(workspace.store).entityConflict;
    assert.ok(conflict);
    resolveEntityConflict(workspace.store, { conflictId: conflict.id, choice }, workspace.knowledge.noteService);
    assert.equal(workspace.knowledge.noteService.getNote(note.id).aiVisibility, 'private');
    workspace.store.close();
    workspace = openWorkspace(directory);
    t.after(() => workspace.store.close());
    assert.equal(workspace.knowledge.noteService.getNote(note.id).aiVisibility, 'private');
    assert.equal(
      workspace.knowledge.noteService.getNote(note.id).rawMarkdown,
      choice === 'copy' ? '基线' : '本地未合并正文'
    );
    assert.ok(workspace.store.state.notes.every(item => item.aiVisibility === 'private'));
  }
});

for (const protocol of ['entity', 'legacy'])
  test(`${protocol} 私密冲突回包即时隔离：不依赖后续拉取，并阻止旧基线解除私密`, t => {
    const w = openWorkspace(temporaryDirectory(t));
    t.after(() => w.store.close());
    const note = w.knowledge.noteService.createNote({
      title: '合成私密回包',
      rawMarkdown: '基线',
      spaceId: w.space.id
    });
    const entries = [
      { collection: 'spaces', id: w.space.id, revision: 1, value: { ...w.space } },
      { collection: 'notes', id: note.id, revision: 1, value: { ...note } }
    ];
    (protocol === 'entity' ? applyEntityRemote : applyRemote)(w.store, entries, 'cursor1', 'epoch1');
    const dirty = w.knowledge.noteService.updateNote(note.id, { rawMarkdown: '本地未合并正文' });
    const operation = (protocol === 'entity' ? nextEntityUpload : nextUpload)(w.store);
    const remote = { collection: 'notes', id: note.id, revision: 2, value: { ...note, aiVisibility: 'private' } };
    if (protocol === 'entity') acknowledgeEntityUpload(w.store, operation, { status: 'conflict', conflicts: [remote] });
    else acknowledge(w.store, operation, { status: 'conflict', current: remote });
    const current = w.knowledge.noteService.getNote(note.id);
    assert.equal(current.aiVisibility, 'private');
    assert.equal(current.rawMarkdown, '本地未合并正文');
    assert.equal(isAiReadableNote(current), false);
    assert.throws(
      () => w.knowledge.noteService.updateNote(note.id, { aiVisibility: 'normal', expectedUpdatedAt: dirty.updatedAt }),
      { code: 'NOTE_UPDATE_CONFLICT' }
    );
    if (protocol === 'legacy') {
      resolveConflict(
        w.store,
        { noteId: note.id, choice: 'copy', remoteRevision: 2, datasetEpoch: 'epoch1' },
        w.knowledge.noteService
      );
      assert.ok(w.store.state.notes.every(item => item.aiVisibility === 'private'));
    }
  });
