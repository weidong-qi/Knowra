import assert from 'node:assert/strict';
import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { Agent, get } from 'node:http';

async function nextMessage(child: ChildProcess, phase: string) {
  const abort = new AbortController();
  const deadline = setTimeout(() => abort.abort(), 15_000);
  try {
    const [message]: unknown[] = await Promise.race([
      once(child, 'message', { signal: abort.signal }),
      once(child, 'exit', { signal: abort.signal }).then(([code, signal]) => {
        throw new Error(`HTTP 子进程提前退出：${code ?? signal}`);
      })
    ]);
    assert.ok(message && typeof message === 'object');
    const record = message as Record<string, unknown>;
    assert.equal(record.phase, phase);
    return record;
  } finally {
    clearTimeout(deadline);
    abort.abort();
  }
}

interface Reply {
  status: number | undefined;
  body: string;
  keepAlive: string | string[] | undefined;
  reused: boolean;
  port: number | undefined;
  flushedAt: number;
}

function read(port: number, pathname: string, agent: Agent): Promise<Reply> {
  return new Promise((resolve, reject) => {
    let flushedAt = 0;
    const request = get(
      { hostname: '127.0.0.1', port, path: pathname, agent, signal: AbortSignal.timeout(20_000) },
      response => {
        const localPort = request.socket?.localPort;
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => {
          body += chunk;
        });
        response.on('error', reject);
        response.on('end', () =>
          resolve({
            status: response.statusCode,
            body,
            keepAlive: response.headers['keep-alive'],
            reused: request.reusedSocket,
            port: localPort,
            flushedAt
          })
        );
      }
    );
    request.on('finish', () => {
      flushedAt = Date.now();
    });
    request.on('error', reject);
  });
}

export const httpKeepAliveTests = [
  {
    name: 'API 同步阻塞 7 秒时，两个已复用连接上的排队读取仍完成且不重试',
    async run() {
      const child = fork(new URL('./fixtures/http-keepalive-child.ts', import.meta.url), {
        execArgv: [],
        stdio: ['ignore', 'ignore', 'inherit', 'ipc']
      });
      const agent = new Agent({ keepAlive: true, maxSockets: 3 });
      try {
        const ready = await nextMessage(child, 'ready');
        assert.ok(typeof ready.port === 'number');
        const port = ready.port;
        const warm = await Promise.all(Array.from({ length: 3 }, () => read(port, '/api/health', agent)));
        const sockets = new Set(warm.map(reply => reply.port));
        assert.equal(sockets.size, 3);
        assert.ok(!sockets.has(undefined));
        for (const reply of warm) {
          assert.equal(reply.status, 200);
          assert.ok(typeof reply.keepAlive === 'string');
          assert.match(reply.keepAlive, /^timeout=5(?:,|$)/);
        }

        // 先收到子进程的阻塞信号，再从另外两个已预热的连接发出真实 HTTP 请求。
        const blocking = nextMessage(child, 'blocking');
        const slow = read(port, '/api/knowledge/notes', agent);
        await Promise.race([
          blocking,
          slow.then(() => {
            throw new Error('阻塞信号前请求已结束');
          })
        ]);
        const unblocked = nextMessage(child, 'unblocked');
        const reads = [read(port, '/api/health', agent), read(port, '/api/health', agent)];
        const [replies, timing] = await Promise.all([Promise.all([slow, ...reads]), unblocked]);

        assert.ok(typeof timing.releasedAt === 'number' && typeof timing.blockedFor === 'number');
        assert.ok(timing.blockedFor >= 7_000, `实际同步阻塞 ${timing.blockedFor}ms`);
        assert.equal(new Set(replies.map(reply => reply.port)).size, 3);
        for (const reply of replies) {
          assert.equal(reply.status, 200);
          assert.equal(reply.reused, true);
          assert.ok(sockets.has(reply.port));
          assert.ok(
            reply.flushedAt > 0 && reply.flushedAt < timing.releasedAt,
            '请求必须在子进程解除同步阻塞前已写入原连接'
          );
        }
        assert.deepEqual(JSON.parse(replies[0].body), { data: [] });
        assert.deepEqual(JSON.parse(replies[1].body), { data: { status: 'ok' } });
        assert.deepEqual(JSON.parse(replies[2].body), { data: { status: 'ok' } });
      } finally {
        agent.destroy();
        if (child.exitCode === null && child.signalCode === null) {
          const closed = once(child, 'exit');
          child.kill('SIGKILL');
          await closed;
        }
      }
    }
  }
];
