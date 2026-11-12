import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPersistentAppContext } from '../../../api/src/app.factory.ts';
import { createPostgresAppContext } from '../../../api/src/postgres-app.factory.ts';
import { createServer } from '../../../api/src/server.js';
import { createV4WebServer } from '../../../web/server/app.mjs';
import { createFileDataStore } from '../../../api/src/infrastructure/file-data-store.ts';
import { createOptionalAiRuntime } from '../../../api/src/modules/ai/runtime.ts';
import { startLocalRuntime } from '../../src/runtime-server.mjs';
import { createR07PostgresDatabase } from './ai-r07-postgres.mjs';

const distRoot = fileURLToPath(new URL('../../../web/dist/', import.meta.url));
const logger = { warn() {}, error() {} };
const priceProfile = {
  version: 'r07-synthetic-price-v1',
  modelId: 'deepseek-flash',
  expiresAt: '2030-01-01T00:00:00.000Z',
  inputMicrounitsPerMillion: 2_000_000,
  outputMicrounitsPerMillion: 8_000_000
};
export const syntheticCredentials = {
  credentialReference: async () => ({
    provider: 'deepseek',
    modelId: 'deepseek-flash',
    credentialRef: 'r07-synthetic-only'
  }),
  resolveCredential: async () => {
    throw new Error('R07 模拟验收禁止读取凭据');
  }
};
const response = (content, toolCalls = []) => ({
  id: 'r07-response',
  model: 'deepseek-flash',
  choices: [{ finish_reason: toolCalls.length ? 'tool_calls' : 'stop', message: { content, tool_calls: toolCalls } }],
  usage: { prompt_tokens: 10, completion_tokens: 10 }
});

export function createR07Adapter() {
  const calls = [];
  let release;
  let lateFormat;
  return {
    provider: 'mock',
    calls,
    capabilities: () => ({
      provider: 'mock',
      verified: true,
      advertised: { text: true, jsonObject: true, toolCalls: true }
    }),
    releaseLate: () =>
      release?.(
        response(
          lateFormat === 'text'
            ? '绝不能显示的迟到回答'
            : JSON.stringify({ answer: '绝不能显示的迟到回答', citations: [] })
        )
      ),
    async complete(request) {
      calls.push(structuredClone({ format: request.format, messages: request.messages, tools: request.tools }));
      const last = request.messages.at(-1).content;
      if (last.includes('等待取消')) {
        lateFormat = request.format;
        return new Promise(resolve => {
          release = resolve;
        });
      }
      if (last.includes('生成合成笔记') && request.tools.some(tool => tool.name === 'notes_create'))
        return response(null, [
          {
            id: 'p2-create',
            type: 'function',
            function: {
              name: 'notes_create',
              arguments: JSON.stringify({ title: '合成 AI 记录', rawMarkdown: '# 合成内容\n只记录一次。' })
            }
          }
        ]);
      if (request.format === 'text')
        return response(last.includes('继续') ? '合成追问：第一轮上下文仍在。' : '合成聊天：可以直接提问。');
      const payload = JSON.parse(last);
      const source = payload.sources[0];
      if (!source) return response(JSON.stringify({ answer: '授权资料未命中。', citations: [] }));
      if (!payload.question.includes('工具结果已写入') && request.tools.some(tool => tool.name === 'notes_read')) {
        return response(null, [
          {
            id: `read-${calls.length}`,
            type: 'function',
            function: {
              name: 'notes_read',
              arguments: JSON.stringify({ noteId: source.noteId, start: source.start, end: source.end })
            }
          }
        ]);
      }
      return response(
        JSON.stringify({
          answer: `合成资料回答：${source.text}`,
          citations: [{ sourceId: source.sourceId, quote: source.text }]
        })
      );
    },
    async *stream() {
      throw new Error('R07 本批不验收流式能力');
    }
  };
}

export async function createR07Fixture(driver, { aiEnabled = true, isolatePostgres = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `knowra-r07-${driver}-`));
  const adapter = createR07Adapter();
  let app, database, local, api, web, runtime;
  const closeServer = server =>
    server
      ? new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
      : Promise.resolve();
  const close = async () => {
    adapter.releaseLate();
    try {
      if (local) await local.close();
      else {
        await runtime?.agent?.close?.();
        await runtime?.worker?.close?.();
        await closeServer(web);
        await closeServer(api);
        await app?.close?.();
      }
    } finally {
      try {
        await database?.close();
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  };
  try {
    let origin, launchUrl, store, restart;
    if (driver === 'sqlite') {
      // 模拟云端预算仍使用真实 JSON 预算服务；SQLite 会话/授权保持真实本地运行时。
      const budget = createFileDataStore(path.join(directory, 'synthetic-budget.json')).aiBudgetAuthority;
      const factory = (options, flags) => {
        runtime = createOptionalAiRuntime(
          {
            ...options,
            modelSettings: syntheticCredentials,
            providerAdapter: adapter,
            budgetAuthority: budget,
            priceProfile,
            allowExternal: true
          },
          { ...flags, enabled: flags.enabled && aiEnabled }
        );
        return runtime;
      };
      const start = () =>
        startLocalRuntime({
          dataDirectory: directory,
          distRoot,
          logger,
          syncOptions: { autoSync: false },
          credentialSource: syntheticCredentials,
          aiRuntimeFactory: factory
        });
      local = await start();
      origin = local.origin;
      launchUrl = local.launchUrl;
      store = local.store.aiConversationStore;
      restart = async () => {
        await local.close();
        local = await start();
        return local.launchUrl;
      };
    } else {
      if (driver === 'postgres') database = await createR07PostgresDatabase({ isolated: isolatePostgres });
      const start = async () => {
        if (driver === 'postgres') {
          app = await createPostgresAppContext({
            databaseUrl: database.databaseUrl,
            storageRootDir: directory,
            ownerId: 'demo'
          });
        } else app = createPersistentAppContext({ storageRootDir: directory, ownerId: 'demo' });
        const previous = app.ai;
        const repositories = app.repositories ?? app.modules.knowledge.repositories;
        runtime = createOptionalAiRuntime(
          {
            modelSettings: syntheticCredentials,
            repository: previous.repository,
            uploadsDir: path.join(directory, 'uploads'),
            accessStore: previous.accessStore,
            conversationStore: previous.conversationStore,
            actionStore: app.dataStore?.aiActionStore ?? previous.actionStore,
            coreOperationStore: app.coreOperationStore,
            knowledge: { ...app.modules.knowledge, repositories },
            asyncDomain: driver === 'postgres',
            budgetAuthority: previous.budgetAuthority,
            priceProfile,
            providerAdapter: adapter,
            allowExternal: true,
            contextSources: { ...repositories, spaceRepository: repositories.knowledgeSpaceRepository, ownerId: 'demo' }
          },
          { enabled: aiEnabled }
        );
        app.ai = runtime;
        store = runtime.conversationStore;
        api = createServer({ appContext: app, logger });
        await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
        web = createV4WebServer({ distRoot, getApiOrigin: () => `http://127.0.0.1:${api.address().port}` });
        await new Promise(resolve => web.listen(0, '127.0.0.1', resolve));
        origin = `http://127.0.0.1:${web.address().port}`;
        launchUrl = origin;
      };
      await start();
      restart = async () => {
        await runtime.attachments?.close?.();
        await runtime.agent?.close?.();
        await runtime.worker?.close?.();
        await closeServer(web);
        await closeServer(api);
        await app.close?.();
        await start();
        return launchUrl;
      };
    }
    return {
      get origin() {
        return local?.origin ?? origin;
      },
      get launchUrl() {
        return local?.launchUrl ?? launchUrl;
      },
      adapter,
      get runtime() {
        return runtime;
      },
      get store() {
        return local?.store.aiConversationStore ?? store;
      },
      // 直接读取 fixture 持久层，避开业务 actionStore.read 的首次初始化写入。
      async readActionSnapshot() {
        if (driver === 'json')
          return (
            JSON.parse(fs.readFileSync(path.join(directory, 'storage/data/knowledge-base.json'), 'utf8')).aiRuntime
              ?.actionLedger ?? { actions: [] }
          );
        if (driver === 'sqlite')
          return local.store.readSync(db => {
            const row = db.prepare('SELECT state_json FROM ai_note_action_state WHERE id = 1').get();
            return row ? JSON.parse(row.state_json) : { actions: [] };
          });
        const [row] = await app.prisma.$queryRawUnsafe(
          'SELECT state_json FROM ai_note_action_states WHERE owner_id = $1',
          'demo'
        );
        return row ? JSON.parse(row.state_json) : { actions: [] };
      },
      restart,
      close
    };
  } catch (error) {
    await close();
    throw error;
  }
}

/** 仅失败后读取合成fixture；不输出正文、工具参数、凭据或模型请求。 */
export async function inspectR07FixtureState(fixture) {
  const [turns, attempts, actionState] = await Promise.all([
    fixture.store.listTurns(),
    fixture.store.listModelAttempts(),
    fixture.readActionSnapshot()
  ]);
  const conversationIds = [...new Set(turns.map(turn => turn.conversationId))];
  const messages = (await Promise.all(conversationIds.map(id => fixture.store.listMessages(id, 0, 100)))).flat();
  return {
    turns: turns.slice(-30).map(({ turnId, conversationId, status, phase, assistantMessageId, errorCode }) => ({
      turnId,
      conversationId,
      status,
      phase,
      assistantMessageId,
      errorCode
    })),
    messages: messages
      .slice(-100)
      .map(({ messageId, turnId, sequence, role }) => ({ messageId, turnId, sequence, role })),
    actions: actionState.actions.slice(-30).map(({ actionId, status }) => ({ actionId, status })),
    attempts: attempts.slice(-30).map(({ attemptId, turnId, status }) => ({ attemptId, turnId, status })),
    modelCallCount: fixture.adapter.calls.length
  };
}
