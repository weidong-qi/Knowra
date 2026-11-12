import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPostgresTestDatabase } from '../../../scripts/test-support/postgres-test-database.mjs';
import { createPostgresAppContext } from '../src/postgres-app.factory.ts';
import {
  assertCommandRoute,
  BODY_QUERY,
  COMMAND_OWNER,
  searchRequest,
  seedCommandNotes,
  withCommandServer
} from './command-search-http.test.js';

export const commandSearchPostgresTests =
  process.env.KNOWRA_SYNC_TEST_DATABASE_URL && process.env.KNOWRA_SYNC_TEST_ALLOW_WRITES === '1'
    ? [
        {
          name: '真实 PostgreSQL 命令正文搜索 HTTP：异步路由、有界投影、当前空间和 owner 隔离',
          async run() {
            const database = await createPostgresTestDatabase();
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-command-pg-'));
            let app;
            try {
              app = await createPostgresAppContext({
                databaseUrl: database.databaseUrl,
                storageRootDir: root,
                ownerId: COMMAND_OWNER
              });
              const fixture = await seedCommandNotes(app.http.knowledge);
              await withCommandServer(app, async baseUrl => {
                await assertCommandRoute(baseUrl, fixture);
                // 只在独立合成 schema 注入第二个 owner，验证 handler 不能依赖启动时的单 owner 检查。
                await app.prisma.user.create({ data: { id: 'foreign-command-owner' } });
                const foreign = await app.prisma.knowledgeSpace.create({
                  data: { id: 'foreign-command-space', userId: 'foreign-command-owner', name: '跨 owner 合成空间' }
                });
                const rejected = await searchRequest(baseUrl, {
                  result: 'command',
                  spaceId: foreign.id,
                  query: BODY_QUERY,
                  ownerId: foreign.userId,
                  userId: foreign.userId
                });
                assert.equal(rejected.status, 404);
                assert.equal(rejected.payload.error.code, 'KNOWLEDGE_SPACE_NOT_FOUND');
                assert.equal('data' in rejected.payload, false);
              });
            } finally {
              try {
                await app?.close();
              } finally {
                try {
                  await database.close();
                } finally {
                  fs.rmSync(root, { recursive: true, force: true });
                }
              }
            }
          }
        }
      ]
    : [];
