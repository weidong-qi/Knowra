import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { calculateContentHash } from '@study-accelerator/content-anchor';
import { createEmptyAiState } from '../../api/src/modules/ai/record-state.ts';
import { validatePersonalTodoHistory } from '../../api/src/modules/personal-todos/history-contract.ts';
import { readAnnotationToolHistory } from '../../api/src/modules/ai/annotation-history.ts';
import { readPersonalTodoHistory } from '../src/personal-todos/history-reader.mjs';
import { encodeSyncHistory, readSyncHistory, assertNotHistoryOperation } from '../src/sync-history.mjs';
import { createSqliteDataStore } from '../src/sqlite-data-store.mjs';
import { createRuntimeBackup, inspectRuntimeBackup, restoreRuntimeBackup } from '../src/backup.mjs';
import { prepareRestoredDirectory, readActiveDirectory } from '../src/restore-directory.mjs';
import { temporaryDirectory } from './helpers.mjs';
import { copyBackup, treeHashes } from './fixtures/extraction-backup.fixture.mjs';
import {
  readRetirementInspection,
  inspectAnnotationRetirement
} from '../../../scripts/inspect-inline-annotation-retirement.mjs';

const digest = text => createHash('sha256').update(text).digest('hex');
const now = '2026-11-06T00:00:00.000Z';
const todo = () => ({
  id: 'todo',
  parentId: null,
  kind: 'main',
  title: '历史待办',
  description: '描述',
  goal: '目标',
  completionCriteria: '标准',
  plannedDate: null,
  dueDate: '2026-11-08',
  starred: false,
  order: 0,
  status: 'active',
  pauseReason: '',
  completedAt: null,
  completionHistory: [],
  archivedAt: null,
  createdAt: now,
  updatedAt: now,
  reminder: {
    kind: 'relative',
    daysBefore: 1,
    time: '09:00',
    timeZone: 'Asia/Shanghai',
    dueAt: '2026-11-07T01:00:00.000Z',
    state: 'pending'
  }
});
const todos = () => ({
  version: 1,
  owners: [
    {
      ownerId: 'demo',
      revision: 1,
      todos: [todo()],
      receipts: [{ requestId: 'r', fingerprint: 'a'.repeat(64) }],
      undo: null
    }
  ]
});
function putTodos(db, value = todos()) {
  db.exec(
    "CREATE TABLE personal_todos_state(id INTEGER PRIMARY KEY CHECK(id=1),record_json TEXT NOT NULL,record_hash TEXT NOT NULL); INSERT INTO metadata VALUES('personalTodosVersion','1')"
  );
  const text = JSON.stringify(value);
  db.prepare('INSERT INTO personal_todos_state VALUES(1,?,?)').run(text, digest(text));
}
function fixture(t) {
  const root = temporaryDirectory(t),
    file = path.join(root, 'local.sqlite');
  const store = createSqliteDataStore(file);
  t.after(() => store.close());
  return { root, file, store };
}

test('个人待办 v1 非空数据与提醒、归档撤销契约可只读校验，进入完整覆盖并原样备份恢复', async t => {
  const f = fixture(t);
  f.store.metadataTransaction(db => putTodos(db));
  const original = f.store.readSync(db => db.prepare('SELECT record_json FROM personal_todos_state').get().record_json);
  assert.deepEqual(f.store.readSync(readPersonalTodoHistory), todos());
  const inspection = await readRetirementInspection('sqlite', f.file);
  assert.equal(
    inspectAnnotationRetirement(inspection.state, Date.now(), inspection).coverage.privateRecords,
    'checked'
  );
  const backup = createRuntimeBackup(f.store, f.root);
  assert.equal(inspectRuntimeBackup(backup).valid, true);
  const before = treeHashes(backup),
    destination = prepareRestoredDirectory(f.root, backup);
  assert.equal(readActiveDirectory(f.root), f.root, '预备候选不能自动激活');
  const db = new DatabaseSync(path.join(destination, 'local.sqlite'), { readOnly: true });
  try {
    assert.equal(db.prepare('SELECT record_json FROM personal_todos_state').get().record_json, original);
    assert.deepEqual(readPersonalTodoHistory(db), todos());
  } finally {
    db.close();
  }
  assert.deepEqual(treeHashes(backup), before);
});
for (const [name, mutate] of [
  [
    '未来版本',
    value => {
      value.version = 999;
    }
  ],
  [
    '未知字段',
    value => {
      value.owners[0].todos[0].futureField = true;
    }
  ],
  [
    '断裂层级',
    value => {
      value.owners[0].todos[0].parentId = 'missing';
      value.owners[0].todos[0].kind = 'task';
    }
  ],
  [
    '提醒时间不一致',
    value => {
      value.owners[0].todos[0].reminder.dueAt = now;
    }
  ],
  [
    '归档被撤销覆盖',
    value => {
      const owner = value.owners[0];
      Object.assign(owner.todos[0], { status: 'completed', completedAt: now, archivedAt: now, reminder: null });
      owner.undo = { token: 'u', revision: 1, todos: [{ ...owner.todos[0], title: '覆盖' }] };
    }
  ],
  [
    '重复身份',
    value => {
      value.owners[0].todos.push(todo());
    }
  ]
])
  test(`个人待办 ${name} 被拒绝且原对象不变`, () => {
    const value = todos();
    mutate(value);
    const before = structuredClone(value);
    assert.throws(() => validatePersonalTodoHistory(value));
    assert.deepEqual(value, before);
  });

test('待办空表缺列、重签的损坏记录及未知版本阻止候选恢复，原备份和活动目录均保留', t => {
  const f = fixture(t);
  f.store.metadataTransaction(db => putTodos(db));
  const backup = createRuntimeBackup(f.store, f.root);
  for (const [name, mutate] of [
    ['empty', db => db.exec('DELETE FROM personal_todos_state')],
    ['schema', db => db.exec('DROP TABLE personal_todos_state; CREATE TABLE personal_todos_state(record_json TEXT)')],
    [
      'future',
      db => {
        const v = { ...todos(), version: 999 },
          text = JSON.stringify(v);
        db.prepare('UPDATE personal_todos_state SET record_json=?,record_hash=?').run(text, digest(text));
      }
    ],
    ['hash', db => db.exec("UPDATE personal_todos_state SET record_hash='bad'")]
  ]) {
    const directory = copyBackup({ ...f, backup }, name, mutate),
      before = treeHashes(directory);
    assert.throws(() => prepareRestoredDirectory(f.root, directory), /个人待办|私有资料/);
    assert.deepEqual(treeHashes(directory), before);
    assert.equal(readActiveDirectory(f.root), f.root);
  }
});

test('旧恢复记录只读投影、新记录版本封装保留正文与旧偏移，损坏或未来版本不能激活', t => {
  const f = fixture(t);
  const legacy = {
    kind: 'entity-conflict',
    choice: 'remote',
    local: {
      contentAnnotations: [
        {
          id: 'v1',
          noteId: 'trash',
          schemaVersion: 1,
          quoteText: '摘录',
          fromPosition: 1,
          toPosition: 3,
          anchor: null,
          originSnapshot: null
        }
      ]
    },
    base: [],
    remote: [],
    resolvedAt: now
  };
  const raw = JSON.stringify(legacy, null, 2),
    wrapped = encodeSyncHistory(legacy);
  f.store.metadataTransaction(db => {
    db.prepare('INSERT INTO sync_recovery VALUES(?,?)').run('old', raw);
    db.prepare('INSERT INTO sync_recovery VALUES(?,?)').run('new', wrapped);
  });
  for (const value of [raw, wrapped]) {
    const history = readSyncHistory(value);
    assert.deepEqual(history.local, legacy.local);
    assert.equal(history.history.readOnly, true);
    assert.throws(() => assertNotHistoryOperation(history), { code: 'SYNC_HISTORY_READ_ONLY' });
  }
  const backup = createRuntimeBackup(f.store, f.root),
    before = treeHashes(backup);
  const destination = path.join(f.root, 'raw-copy');
  restoreRuntimeBackup(backup, destination);
  const db = new DatabaseSync(path.join(destination, 'local.sqlite'), { readOnly: true });
  try {
    assert.deepEqual(
      db
        .prepare('SELECT payload FROM sync_recovery ORDER BY id')
        .all()
        .map(row => row.payload),
      [wrapped, raw]
    );
  } finally {
    db.close();
  }
  assert.deepEqual(treeHashes(backup), before);
  for (const [name, change] of [
    [
      'future',
      v => {
        v.version = 999;
      }
    ],
    [
      'hash',
      v => {
        v.payloadHash = 'bad';
      }
    ],
    [
      'payload',
      v => {
        v.payloadJson = '{}';
      }
    ]
  ]) {
    const value = JSON.parse(wrapped);
    change(value);
    const directory = copyBackup({ ...f, backup }, name, db =>
      db.prepare('UPDATE sync_recovery SET payload=?').run(JSON.stringify(value))
    );
    const bytes = treeHashes(directory);
    assert.throws(() => prepareRestoredDirectory(f.root, directory), /历史|私有资料/);
    assert.deepEqual(treeHashes(directory), bytes);
    assert.equal(readActiveDirectory(f.root), f.root);
  }
});

test('AI 历史视图在没有当前重点和版本行时仍使用当时引文，跨备份恢复且不改写原记录', async t => {
  const f = fixture(t),
    store = f.store.aiConversationStore;
  const conversation = await store.createConversation({ ownerId: 'demo', actorId: 'demo', spaceId: 'history-space' });
  const turn = await store.submitTurn({
    ownerId: 'demo',
    conversationId: conversation.conversationId,
    content: '历史问答',
    idempotencyKey: 'history-request'
  });
  const claimed = await store.claimTurn(turn.turnId);
  await store.appendToolCall(turn.turnId, claimed.leaseGeneration, {
    callId: 'old-annotations',
    toolName: 'annotations_list',
    argumentsJson: { noteId: 'old-note' }
  });
  const quote = '历史摘录😀',
    source = {
      noteId: 'old-note',
      noteVersionId: 'old-version',
      contentHash: 'a'.repeat(64),
      start: 2,
      end: 2 + quote.length,
      quoteHash: calculateContentHash(quote)
    };
  await store.settleToolCall(turn.turnId, claimed.leaseGeneration, 'old-annotations', {
    resultJson: {
      noteId: source.noteId,
      noteVersionId: source.noteVersionId,
      annotations: [
        { annotationId: 'old-annotation', start: source.start, end: source.end, text: quote, truncated: true }
      ]
    },
    sourceRefs: [source]
  });
  const original = f.store.readSync(
    db =>
      db.prepare("SELECT record_json FROM ai_conversation_records WHERE record_id='old-annotations'").get().record_json
  );
  const [view] = await store.listAnnotationHistory(turn.turnId);
  assert.equal(view.readOnly, true);
  assert.equal(view.entries[0].quoteText, quote);
  assert.deepEqual(view.entries[0].source, source);
  assert.equal(view.entries[0].truncated, true);
  assert.equal(f.store.state.contentAnnotations.length, 0);
  assert.equal(f.store.state.noteVersions.length, 0);
  const backup = createRuntimeBackup(f.store, f.root),
    destination = prepareRestoredDirectory(f.root, backup);
  const restored = createSqliteDataStore(path.join(destination, 'local.sqlite'));
  try {
    assert.deepEqual(await restored.aiConversationStore.listAnnotationHistory(turn.turnId), [view]);
    assert.equal(
      restored.readSync(
        db =>
          db.prepare("SELECT record_json FROM ai_conversation_records WHERE record_id='old-annotations'").get()
            .record_json
      ),
      original
    );
  } finally {
    restored.close();
  }
  const bad = JSON.parse(original);
  bad.resultJson.annotations[0].text = '伪造';
  assert.throws(() => readAnnotationToolHistory(bad), { code: 'AI_ANNOTATION_HISTORY_INVALID' });
});

test('旧 JSON 的个人待办扩展为可选 v1 契约，有值时必须校验且不影响无扩展旧文档', async t => {
  const root = temporaryDirectory(t),
    source = path.join(root, 'cloud.json');
  const document = {
    schemaVersion: 8,
    notes: [],
    contentAnnotations: [],
    aiRuntime: createEmptyAiState(),
    taskWorkspaces: {
      version: 1,
      datasetId: 'd',
      datasetEpoch: 'e',
      workspaces: [],
      documents: [],
      tasks: [],
      attempts: [],
      receipts: []
    },
    coreOperations: { version: 1, receipts: [] },
    knowledgeExtractionCommits: { version: 1, receipts: [] },
    aiKnowledgeExtractionTasks: { version: 1, tasks: [] }
  };
  for (const personalTodos of [undefined, todos()]) {
    fs.writeFileSync(source, JSON.stringify({ ...document, personalTodos }));
    const bytes = fs.readFileSync(source),
      inspection = await readRetirementInspection('local-json', source);
    assert.equal(inspection.coverage.privateRecords, 'checked');
    assert.deepEqual(fs.readFileSync(source), bytes);
  }
  fs.writeFileSync(source, JSON.stringify({ ...document, personalTodos: { version: 999, owners: [] } }));
  const bytes = fs.readFileSync(source);
  await assert.rejects(readRetirementInspection('local-json', source));
  assert.deepEqual(fs.readFileSync(source), bytes);
});
