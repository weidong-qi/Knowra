import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { test } from 'node:test';
import { createPostgresTestDatabase } from '../../../scripts/test-support/postgres-test-database.mjs';
import { createPostgresAppContext } from '../../api/src/postgres-app.factory.js';
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
  await pdf.mutate(note.id, 'pg-mark', {
    expectedRevision: 0,
    operationId: 'initial',
    type: 'region',
    segments: [{ pageIndex: 0, rect: [10, 20, 30, 40] }]
  });
  const attempts = await Promise.allSettled(
    ['a', 'b'].map(operationId =>
      pdf.mutate(note.id, 'pg-mark', { expectedRevision: 1, operationId, comment: operationId })
    )
  );
  assert.equal(attempts.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal((await pdf.list(note.id))[0].revision, 2);
  const snapshot = await context.http.storage.exportKnowledgeBase();
  assert.equal(snapshot.data.pdfAnnotations.length, 1);
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
  assert.equal((await pdf.list(note.id)).length, 1);
  await knowledge.noteService.deleteNote(note.id);
  await context.http.knowledge.permanentlyDeleteNote({ id: note.id });
  assert.equal(await context.prisma.pdfAnnotation.count(), 0);
  assert.equal(fs.existsSync(path.join(root, 'uploads', `attachment-pdf-postgres-PG.pdf`)), false);
});
