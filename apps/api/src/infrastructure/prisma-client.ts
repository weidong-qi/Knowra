import type { Prisma, PrismaClient } from '@prisma/client';
import { createAppError } from '../errors/app-error.ts';

interface PrismaConnection {
  $connect(): void | Promise<void>;
  $disconnect?: () => void | Promise<void>;
}
interface RuntimeOptions<Client extends PrismaConnection> {
  client?: Client | null;
  databaseUrl?: string;
  clientFactory?: ((options: { databaseUrl: string; log: Prisma.LogLevel[] }) => Client | Promise<Client>) | null;
  log?: Prisma.LogLevel[];
}
interface PrismaRuntime<Client extends PrismaConnection> {
  client: Client;
  connect(): Promise<Client>;
  disconnect(): Promise<void>;
}
export function createPrismaRuntime<Client extends PrismaConnection>(
  options: RuntimeOptions<Client> & { client: Client }
): PrismaRuntime<Client>;
export function createPrismaRuntime<Client extends PrismaConnection>(
  options: Omit<RuntimeOptions<Client>, 'client'> & {
    client?: null;
    clientFactory: NonNullable<RuntimeOptions<Client>['clientFactory']>;
  }
): Promise<PrismaRuntime<Client>>;
export function createPrismaRuntime(
  options?: Pick<RuntimeOptions<PrismaClient>, 'databaseUrl' | 'log'> & { client?: null; clientFactory?: null }
): Promise<PrismaRuntime<PrismaClient>>;
export function createPrismaRuntime<Client extends PrismaConnection>(
  options: RuntimeOptions<Client>
): PrismaRuntime<Client> | Promise<PrismaRuntime<Client | PrismaClient>>;
export function createPrismaRuntime(options: RuntimeOptions<PrismaConnection> = {}) {
  if (options.client) {
    return buildRuntime(options.client);
  }
  return createRuntimeFromGeneratedClient(options);
}

async function createRuntimeFromGeneratedClient({
  databaseUrl = process.env.DATABASE_URL,
  clientFactory = null,
  log = ['error']
}: RuntimeOptions<PrismaConnection> = {}) {
  if (!String(databaseUrl ?? '').trim()) {
    throw createAppError(
      'DATABASE_URL_REQUIRED',
      'DATABASE_URL is required when PostgreSQL persistence is enabled',
      500
    );
  }

  let prisma;
  if (clientFactory) {
    prisma = await clientFactory({ databaseUrl: databaseUrl!, log });
  } else {
    const { PrismaClient } = await import('@prisma/client');
    prisma = new PrismaClient({
      log,
      datasources: { db: { url: databaseUrl } }
    });
  }
  return buildRuntime(prisma);
}

function buildRuntime<Client extends PrismaConnection>(prisma: Client): PrismaRuntime<Client> {
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
      await prisma.$disconnect!();
      connected = false;
    }
  };
}
