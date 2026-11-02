import fs from 'node:fs';
import path from 'node:path';

export function readRuntimePorts(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (error) {
    return {};
  }
}

export function writeRuntimePort(filePath, service, port) {
  const nextState = {
    ...readRuntimePorts(filePath),
    [service]: port
  };

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(nextState, null, 2));
  return nextState;
}

export function clearRuntimePort(filePath, service) {
  const current = readRuntimePorts(filePath);
  if (!(service in current)) {
    return current;
  }
  const nextState = { ...current };
  delete nextState[service];
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(nextState, null, 2));
  return nextState;
}

/** @param {{envApiPort?: string | number, runtimePorts?: {api?: string | number}, webPort?: number, fallbackPort?: number}} options */
export function resolveApiPort({ envApiPort, runtimePorts = {}, webPort, fallbackPort = 3001 }) {
  const envPort = normalizePort(envApiPort);
  if (envPort) {
    return envPort;
  }

  const runtimeApiPort = normalizePort(runtimePorts.api);
  if (runtimeApiPort && runtimeApiPort !== webPort) {
    return runtimeApiPort;
  }

  if (fallbackPort !== webPort) {
    return fallbackPort;
  }

  return fallbackPort + 1;
}

function normalizePort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 ? port : null;
}
