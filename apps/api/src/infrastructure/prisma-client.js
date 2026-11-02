import { createAppError } from '../errors/app-error.js';

export function createPrismaRuntime(options = {}) {
  if (options.client) {
    return buildRuntime(options.client);
  }
  return createRuntimeFromGeneratedClient(options);
}

async function createRuntimeFromGeneratedClient({
  databaseUrl = process.env.DATABASE_URL,
  clientFactory = null,
  log = /** @type {import('@prisma/client').Prisma.LogLevel[]} */ (['error'])
} = {}) {
  if (!String(databaseUrl ?? '').trim()) {
    throw createAppError(
      'DATABASE_URL_REQUIRED',
      'DATABASE_URL is required when PostgreSQL persistence is enabled',
      500
    );
  }

  let prisma;
  if (clientFactory) {
    prisma = await clientFactory({ databaseUrl, log });
  } else {
    const { PrismaClient } = await import('@prisma/client');
    prisma = new PrismaClient({
      log,
      datasources: { db: { url: databaseUrl } }
    });
  }
  return buildRuntime(prisma);
}

function buildRuntime(prisma) {
  let connected = false;

  return {
    client: prisma,
    async connect() {
      if (connected) {
        return prisma;
      }
      try {
        await prisma.$connect();
        connected = true;
        return prisma;
      } catch (error) {
        throw createAppError('DATABASE_CONNECT_FAILED', 'Failed to connect to PostgreSQL', 503, { cause: error });
      }
    },
    async disconnect() {
      if (!connected && typeof prisma.$disconnect !== 'function') {
        return;
      }
      await prisma.$disconnect();
      connected = false;
    }
  };
}
