import { createPersistentAppContext } from '../../src/app.factory.js';
import { createOptionalAiRuntime } from '../../src/modules/ai/runtime.ts';

const [root, phase, driver = 'json'] = process.argv.slice(2);
function crashingRuntime(options: Parameters<typeof createOptionalAiRuntime>[0]) {
  const authority = options.budgetAuthority!;
  return createOptionalAiRuntime({
    ...options,
    modelSettings: {
      credentialReference: async () => ({ modelId: 'deepseek-flash', credentialRef: 'synthetic' }),
      resolveCredential: async () => {
        throw new Error('不应读取真实凭据');
      }
    },
    providerAdapter: {
      provider: 'mock',
      capabilities: () => ({ provider: 'mock' }),
      async *stream() {},
      async complete() {
        if (phase === 'sent') process.exit(0);
        return {
          choices: [{ finish_reason: 'stop', message: { content: '合成译文' } }],
          usage: { prompt_tokens: 40, completion_tokens: 20 }
        };
      }
    },
    budgetAuthority: {
      ...authority,
      async reserve(input) {
        if (phase === 'before-reserve') process.exit(0);
        const result = await authority.reserve(input);
        if (phase === 'reserved') process.exit(0);
        return result;
      },
      async settle(input) {
        const result = await authority.settle(input);
        if (phase === 'settled') process.exit(0);
        return result;
      }
    },
    priceProfile: {
      version: 'translation-synthetic-v1',
      modelId: 'deepseek-flash',
      expiresAt: '2030-01-01T00:00:00Z',
      inputMicrounitsPerMillion: 2000000,
      outputMicrounitsPerMillion: 8000000
    }
  });
}
let runtime: ReturnType<typeof createOptionalAiRuntime> | undefined;
if (driver === 'desktop') {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { startLocalRuntime } = await import('../../../desktop-runtime/src/runtime-server.mjs');
  const distRoot = path.join(root, 'dist');
  fs.mkdirSync(distRoot);
  fs.writeFileSync(path.join(distRoot, 'index.html'), '<html><head></head></html>');
  await startLocalRuntime({
    dataDirectory: path.join(root, 'data'),
    distRoot,
    logger: { warn() {}, error() {} },
    syncOptions: { autoSync: false },
    aiRuntimeFactory(options) {
      runtime = crashingRuntime(options);
      return runtime;
    }
  });
} else {
  const app = createPersistentAppContext({ storageRootDir: root, ownerId: 'test' });
  runtime = crashingRuntime({
    repository: app.dataStore.aiRepository,
    budgetAuthority: app.dataStore.aiBudgetAuthority
  });
}
await runtime!.translation!.translate({ text: 'Synthetic private PDF selection.' });
throw new Error('未到达预期退出点');
