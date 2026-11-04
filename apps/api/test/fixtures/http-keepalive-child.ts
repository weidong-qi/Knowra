import { createServer } from '../../src/server.js';

const server = createServer({
  appContext: {
    http: {
      storage: {},
      knowledge: {
        listNotes() {
          process.send?.({ phase: 'blocking' });
          const start = performance.now();
          // 与客户端分进程，保证同步持久化阻塞期间客户端仍能发送排队读取。
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 7_000);
          process.send?.({ phase: 'unblocked', blockedFor: performance.now() - start, releasedAt: Date.now() });
          return [];
        }
      }
    }
  }
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('HTTP 测试服务没有 TCP 监听地址');
  process.send?.({ phase: 'ready', port: address.port });
});
