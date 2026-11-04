import fs from 'node:fs';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { parseBody } from '../../../api/src/http/request.ts';
import { McpError } from './mcp-error.mjs';
import { prepareSocketDirectory, removeStaleSocket } from './socket-path.mjs';
import { createHttpShutdown } from '../http-shutdown.mjs';

export const serverProof = (verifier, pairingId, nonce) =>
  createHmac('sha256', verifier).update(`knowra-mcp-v1|${pairingId}|${nonce}`).digest('hex');

function send(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}
const fail = (response, error) =>
  send(response, error.status ?? 500, {
    error: {
      code: error.code,
      message: error.message,
      ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {})
    }
  });

/** 只在本机 Unix socket 上服务；不监听 TCP，不读取浏览器会话 cookie，也不提供任何普通 API。 */
export async function startMcpSocketServer({ socketPath, pairings, gate, logger = console }) {
  prepareSocketDirectory(socketPath);
  removeStaleSocket(socketPath);
  const activeRequests = new Set();
  let closing;
  const server = http.createServer(async (request, response) => {
    let finishRequest;
    const requestDone = new Promise(resolve => {
      finishRequest = resolve;
    });
    activeRequests.add(requestDone);
    try {
      if (closing) throw new McpError('MCP_CLOSING', '本地服务正在关闭。', { status: 503 });
      if (request.method !== 'POST' || request.headers.origin)
        throw new McpError('MCP_REQUEST_INVALID', '请求无效。', { status: 400 });
      if (request.url === '/mcp/v1/handshake') {
        const body = await parseBody(request, { limitBytes: 1024 });
        const verifier = typeof body.pairingId === 'string' ? pairings.verifierOf(body.pairingId) : null;
        if (!verifier || typeof body.nonce !== 'string' || !/^[0-9a-f]{32,64}$/.test(body.nonce))
          throw new McpError('MCP_TOKEN_INVALID', '配对无效。', { status: 401 });
        return send(response, 200, { data: { proof: serverProof(verifier, body.pairingId, body.nonce) } });
      }
      if (request.url === '/mcp/v1/tools') {
        const match = /^Bearer (\S+)$/.exec(request.headers.authorization ?? '');
        await parseBody(request, { limitBytes: 1024 });
        return send(response, 200, { data: { tools: gate.describeTools({ token: match?.[1] }) } });
      }
      if (request.url === '/mcp/v1/call') {
        const match = /^Bearer (\S+)$/.exec(request.headers.authorization ?? '');
        const body = await parseBody(request, { limitBytes: 2 * 1024 * 1024 });
        const result = await gate.call({ token: match?.[1], tool: body.tool, input: body.input ?? {} });
        gate.assertResult?.(result);
        return send(response, 200, { data: result });
      }
      throw new McpError('MCP_REQUEST_INVALID', '路径不存在。', { status: 404 });
    } catch (error) {
      if (!(error instanceof McpError)) {
        const status =
          Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 500
            ? error.statusCode
            : 500;
        if (status === 500) logger.warn?.('MCP request failed', { code: error?.code ?? 'MCP_INTERNAL' });
        return fail(
          response,
          new McpError(
            status === 500 ? 'MCP_INTERNAL' : 'MCP_REQUEST_INVALID',
            status === 500 ? '外部调用失败。' : '请求无效。',
            { status }
          )
        );
      }
      fail(response, error);
    } finally {
      activeRequests.delete(requestDone);
      finishRequest();
    }
  });
  const closeHttp = createHttpShutdown(server, activeRequests);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  fs.chmodSync(socketPath, 0o600);
  return {
    socketPath,
    close() {
      if (!closing)
        closing = (async () => {
          await closeHttp();
          try {
            fs.rmSync(socketPath, { force: true });
          } catch {
            /* 目录将随运行端退出重建 */
          }
        })();
      return closing;
    }
  };
}
