import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { createAppContext } from '../src/app.factory.ts';
import { createFileDataStore } from '../src/infrastructure/file-data-store.ts';

export const attachmentCleanupCrashTests = ['before-commit', 'after-commit'].map(phase => ({
  name: `附件清理真实子进程 SIGKILL：${phase} 恢复保留或自动清理`,
  async run() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-cleanup-crash-'));
    const child = fork(new URL('./fixtures/attachment-cleanup-crash-child.mjs', import.meta.url), [root, phase], {
      execArgv: [],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });
    let stderr = '';
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
    try {
      await Promise.race([
        once(child.stdout, 'data'),
        once(child, 'exit').then(() => {
          throw new Error(`子进程未到验收边界：${stderr}`);
        })
      ]);
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      const [, signal] = await exited;
      assert.equal(signal, 'SIGKILL', stderr);
      const { attachment, file } = JSON.parse(fs.readFileSync(path.join(root, 'crash-boundary.json'), 'utf8'));
      assert.equal(fs.readFileSync(file, 'utf8'), 'synthetic cleanup');
      const store = createFileDataStore(path.join(root, 'data.json'));
      const retained = phase === 'before-commit';
      assert.equal(
        store.state.attachments.some(item => item.id === attachment.id),
        retained
      );
      const app = createAppContext({ dataStore: store, storageRootDir: root, uploadsDir: path.join(root, 'uploads') });
      // 启动重试有异步元数据查询；等待一个事件循环，无手动调用 retry 接口。
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(fs.existsSync(file), retained);
      if (retained) {
        assert.equal(
          app.http.storage.getAttachmentContent({ id: attachment.id }).content.toString(),
          'synthetic cleanup'
        );
        assert.equal((await app.http.storage.listAttachmentCleanup()).pending, 0);
        assert.equal(app.http.storage.deleteAttachment({ id: attachment.id }).cleanup, 'complete');
      } else {
        assert.throws(() => app.http.storage.getAttachmentContent({ id: attachment.id }), {
          code: 'ATTACHMENT_NOT_FOUND'
        });
        assert.equal((await app.http.storage.listAttachmentCleanup()).pending, 0);
      }
      assert.equal(fs.existsSync(file), false);
      const tasks = path.join(root, 'storage', 'temp', 'attachment-cleanup');
      assert.deepEqual(fs.readdirSync(tasks), []);
    } finally {
      clearTimeout(timer);
      child.kill('SIGKILL');
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
}));
