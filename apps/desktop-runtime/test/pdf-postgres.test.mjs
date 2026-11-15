import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { test } from 'node:test';
import { createPostgresTestDatabase } from '../../../scripts/test-support/postgres-test-database.mjs';
import { createPostgresAppContext } from '../../api/src/postgres-app.factory.ts';
import { temporaryDirectory } from './helpers.mjs';
import { syntheticPdf } from '../../../scripts/test-support/pdf-fixtures.mjs';
const enabled = Boolean(process.env.KNOWRA_SYNC_TEST_DATABASE_URL && process.env.KNOWRA_SYNC_TEST_ALLOW_WRITES === '1');
test('PDF 真实 PostgreSQL：导入事务、CAS、快照、ZIP 恢复与永久删除', { skip: !enabled, timeout: 60000 }, async t => {
  const database = await createPostgresTestDatabase();
  t.after(() => database.close());
  const root = temporaryDirectory(t);
  const context = await createPostgresAppContext({
    databaseUrl: database.databaseUrl,
    storageRootDir: root,
    uploadsDir: path.join(root, 'uploads')
  });
  t.after(() => context.close());
  const knowledge = context.modules.knowledge,
    space = await knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
  const pdf = context.http.pdf,
    bytes = syntheticPdf();
  const note = await pdf.importPdf(
    { operationId: 'postgres', spaceId: space.id, fileName: 'PG.pdf' },
    Readable.from([bytes])
  );
  assert.equal(note.contentKind, 'pdf');
  assert.equal((await knowledge.noteService.getNote(note.id)).pdfSource.sha256, note.pdfSource.sha256);
  const initialDate = new Date(Date.now() + 60000).toISOString();
  await context.prisma.note.update({ where: { id: note.id }, data: { updatedAt: new Date(initialDate) } });
  const date = async () => (await knowledge.noteService.getNote(note.id)).updatedAt;
  const create = {
    expectedRevision: 0,
    operationId: 'initial',
    type: 'region',
    segments: [{ pageIndex: 0, rect: [10, 20, 30, 40] }]
  };
  const created = await pdf.mutate(note.id, 'pg-mark', create);
  assert.ok((await date()) > initialDate);
  assert.equal(await date(), created.updatedAt);
  await pdf.mutate(note.id, 'pg-mark', create);
  assert.equal(await date(), created.updatedAt);
  const attempts = await Promise.allSettled(
    ['a', 'b'].map(operationId =>
      pdf.mutate(note.id, 'pg-mark', { expectedRevision: 1, operationId, comment: operationId })
    )
  );
  assert.equal(attempts.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal((await pdf.list(note.id))[0].revision, 2);
  const editedDate = await date();
  assert.ok(editedDate > created.updatedAt);
  const beforeFailure = structuredClone(await pdf.list(note.id));
  await assert.rejects(pdf.mutate(note.id, 'pg-mark', { expectedRevision: 1, operationId: 'stale' }), {
    code: 'PDF_ANNOTATION_CONFLICT'
  });
  assert.equal(await date(), editedDate);
  assert.deepEqual(await pdf.list(note.id), beforeFailure);
  await pdf.mutate(note.id, 'pg-note', {
    expectedRevision: 0,
    operationId: 'note-initial',
    type: 'note',
    title: 'PG 便签标题',
    segments: [{ pageIndex: 0, rect: [50, 60, 68, 78] }]
  });
  await pdf.mutate(note.id, 'pg-note', {
    expectedRevision: 1,
    operationId: 'note-rename',
    title: '修改后的便签标题'
  });
  const snapshot = await context.http.storage.exportKnowledgeBase();
  assert.equal(snapshot.data.pdfAnnotations.length, 2);
  assert.equal(snapshot.data.pdfAnnotations.find(item => item.id === 'pg-note').title, '修改后的便签标题');
  const chunks = [];
  await pdf.archive.export(
    new Writable({
      write(chunk, _, done) {
        chunks.push(chunk);
        done();
      }
    })
  );
  const preview = await pdf.archive.inspect(Readable.from(chunks));
  const restored = await pdf.archive.restore(preview.token);
  assert.equal(restored.restored, true);
  assert.equal((await pdf.list(note.id)).length, 2);
  assert.equal((await pdf.list(note.id)).find(item => item.id === 'pg-note').title, '修改后的便签标题');
  const beforeDelete = await date();
  const removal = { operationId: 'pg-delete', expectedRevision: 2 };
  const deleted = await pdf.mutate(note.id, 'pg-note', removal, true);
  assert.ok((await date()) > beforeDelete);
  assert.equal(await date(), deleted.updatedAt);
  await pdf.mutate(note.id, 'pg-note', removal, true);
  assert.equal(await date(), deleted.updatedAt);
  const createdAt = (await knowledge.noteService.getNote(note.id)).createdAt;
  assert.equal(createdAt, note.createdAt);
  const separate = await Promise.all(
    ['left', 'right'].map(id =>
      pdf.mutate(note.id, `pg-${id}`, {
        ...create,
        operationId: `create-${id}`
      })
    )
  );
  assert.notEqual(separate[0].updatedAt, separate[1].updatedAt);
  assert.equal(
    await date(),
    separate
      .map(item => item.updatedAt)
      .sort()
      .at(-1)
  );
  await knowledge.noteService.deleteNote(note.id);
  await context.http.knowledge.permanentlyDeleteNote({ id: note.id });
  assert.equal(await context.prisma.pdfAnnotation.count(), 0);
  assert.equal(fs.existsSync(path.join(root, 'uploads', `attachment-pdf-postgres-PG.pdf`)), false);
});
