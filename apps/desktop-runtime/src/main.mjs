import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { defaultDataDirectory } from './data-directory.mjs';
import { startLocalRuntime } from './runtime-server.mjs';
import { restoreRuntimeBackup } from './backup.mjs';
import { importJsonSnapshot } from './snapshot-migration.mjs';

const { values } = parseArgs({
  options: {
    'data-dir': { type: 'string' },
    'dist-dir': { type: 'string' },
    'restore-from': { type: 'string' },
    'import-json': { type: 'string' },
    port: { type: 'string' }
  }
});
const dataDirectory = path.resolve(values['data-dir'] || defaultDataDirectory());
if (values['restore-from'] && values['import-json']) throw new Error('恢复备份与导入 JSON 不能同时执行。');
if (values['import-json']) {
  if (!values['data-dir']) throw new Error('迁移必须通过 --data-dir 指定尚不存在的新目录。');
  importJsonSnapshot(path.resolve(values['import-json']), dataDirectory);
}
if (values['restore-from']) {
  if (!values['data-dir']) throw new Error('恢复必须通过 --data-dir 指定尚不存在的新目录。');
  restoreRuntimeBackup(path.resolve(values['restore-from']), dataDirectory);
}
const runtime = await startLocalRuntime({
  dataDirectory,
  distRoot: path.resolve(values['dist-dir'] || fileURLToPath(new URL('../../web/dist', import.meta.url))),
  port: values.port ? Number(values.port) : 0
});
console.log(`本地资料目录：${dataDirectory}`);
console.log(`请在浏览器打开本次启动入口：${runtime.launchUrl}`);
console.log('离线保存已启用；可在界面底栏连接云端并同步。退出前请等待界面显示“已保存到本机”。');
if (process.send) process.send({ type: 'ready', launchUrl: runtime.launchUrl, origin: runtime.origin });
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    void runtime
      .close()
      .then(() => {
        process.exitCode = 0;
      })
      .catch(error => {
        console.error(error);
        process.exitCode = 1;
      });
  });
}
