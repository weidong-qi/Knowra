import type { Server } from 'node:net';

export interface ConfiguredPortOptions {
  allowPortFallback?: boolean;
  host?: string;
  maxAttempts?: number;
}
export function listenOnConfiguredPort(
  server: Server,
  configuredPort: number,
  options?: ConfiguredPortOptions
): Promise<number>;
