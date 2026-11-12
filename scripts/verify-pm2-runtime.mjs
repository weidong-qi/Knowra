import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { normalizeEnv } from '../apps/api/src/config/env.schema.ts';

const require = createRequire(import.meta.url);
const [phase, directory] = process.argv.slice(2);
const apiKeys = [
  'KNOWRA_OWNER_ID',
  'CORS_ALLOWED_ORIGINS',
  'KNOWRA_AI_ENABLED',
  'KNOWRA_AI_EGRESS_ENABLED',
  'KNOWRA_SYNC_PUSH_ENABLED',
  'KNOWRA_SYNC_ALLOWED_DEVICE_IDS',
  'KNOWRA_SYNC_VERIFY_SCOPED_AFTER',
  'STUDY_RUNTIME_PORTS_FILE'
];
const webKeys = ['API_ORIGIN', 'WEB_TRUST_LOOPBACK_PROXY', 'CORS_ALLOWED_ORIGINS', 'STUDY_RUNTIME_PORTS_FILE'];
const runtimeKeys = [
  'NODE_OPTIONS',
  'NODE_EXTRA_CA_CERTS',
  'NODE_TLS_REJECT_UNAUTHORIZED',
  'NODE_USE_ENV_PROXY',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'TZ'
];
let input = '';
process.stdin.setEncoding('utf8');
process.stdin
  .on('data', chunk => {
    input += chunk;
  })
  .on('end', () => {
    try {
      if (!['before', 'after'].includes(phase)) throw new Error('无效的核验阶段');
      const root = fs.realpathSync(directory);
      const definitions = require(path.join(root, 'deploy/ecosystem.config.cjs')).apps;
      const processes = JSON.parse(input);
      const mismatches = [];
      for (const name of ['knowra-api', 'knowra-web']) {
        const previous = processes.find(app => app.name === name)?.pm2_env;
        const definition = definitions.find(app => app.name === name);
        if (!previous || !definition) throw new Error('缺少进程定义');
        const actual = { ...previous.env, ...previous };
        const expected = { ...process.env, ...definition.env };
        const databaseKeys =
          name === 'knowra-api'
            ? [...new Set([...Object.keys(actual), ...Object.keys(expected)])].filter(key =>
                /^(?:PG[A-Z_]+|PRISMA_)/.test(key)
              )
            : [];
        const keys = ['NODE_ENV', ...runtimeKeys, ...databaseKeys, ...(name === 'knowra-api' ? apiKeys : webKeys)];
        // PM2 同时提供平铺与嵌套字段时，不用其中一份覆盖相互矛盾的配置。
        const checkedKeys = ['PORT', ...keys, ...(name === 'knowra-api' ? Object.keys(normalizeEnv({})) : [])];
        for (const key of checkedKeys) {
          if (
            Object.hasOwn(previous, key) &&
            Object.hasOwn(previous.env ?? {}, key) &&
            String(previous[key]) !== String(previous.env[key])
          )
            mismatches.push(`${name}.${key}`);
        }
        for (const key of keys) {
          if (String(actual[key] ?? '') !== String(expected[key] ?? '')) mismatches.push(`${name}.${key}`);
        }
        const fallbackPort = name === 'knowra-api' ? 3001 : 3000;
        if (Number(actual.PORT || fallbackPort) !== Number(expected.PORT || fallbackPort)) {
          mismatches.push(`${name}.PORT`);
        }
        if (name === 'knowra-api') {
          const actualStorage = normalizeEnv(actual);
          const expectedStorage = normalizeEnv(expected);
          const shellStorage = normalizeEnv(process.env);
          for (const key of Object.keys(expectedStorage)) {
            if (actualStorage[key] !== expectedStorage[key] || expectedStorage[key] !== shellStorage[key]) {
              mismatches.push(`${name}.${key}`);
            }
          }
          if (expectedStorage.PERSISTENCE_DRIVER === 'postgres' && !expectedStorage.DATABASE_URL) {
            mismatches.push(`${name}.DATABASE_URL`);
          }
          // API 的资料根目录来自入口文件位置；相同的相对路径也可能指向另一份资料库。
          const previousRoot = path.resolve(path.dirname(fs.realpathSync(previous.pm_exec_path)), '../../..');
          const storagePaths = {
            STORAGE_UPLOADS_DIR: actual.STORAGE_UPLOADS_DIR || 'storage/uploads',
            STORAGE_EXPORTS_DIR: actualStorage.STORAGE_EXPORTS_DIR,
            STORAGE_TEMP_DIR: actualStorage.STORAGE_TEMP_DIR
          };
          for (const [key, value] of Object.entries(storagePaths)) {
            const expectedValue =
              key === 'STORAGE_UPLOADS_DIR' ? expected.STORAGE_UPLOADS_DIR || 'storage/uploads' : expectedStorage[key];
            if (physicalPath(path.resolve(previousRoot, value)) !== physicalPath(path.resolve(root, expectedValue))) {
              mismatches.push(`${name}.${key}`);
            }
            if (
              key === 'STORAGE_UPLOADS_DIR' &&
              physicalPath(path.resolve(root, expectedValue)) !==
                physicalPath(path.resolve(root, process.env.STORAGE_UPLOADS_DIR || 'storage/uploads'))
            ) {
              mismatches.push(`${name}.${key}`);
            }
          }
          if (
            expectedStorage.PERSISTENCE_DRIVER === 'local-json' &&
            physicalPath(path.join(previousRoot, 'storage/data/knowledge-base.json')) !==
              physicalPath(path.join(root, 'storage/data/knowledge-base.json'))
          ) {
            mismatches.push(`${name}.LOCAL_JSON_PATH`);
          }
        }
        if (phase === 'after') {
          const script = name === 'knowra-api' ? 'apps/api/src/main.ts' : 'apps/web/server.mjs';
          if (
            previous.status !== 'online' ||
            fs.realpathSync(previous.pm_cwd) !== root ||
            fs.realpathSync(previous.pm_exec_path) !== path.join(root, script)
          ) {
            mismatches.push(`${name}.entry`);
          }
        }
      }
      if (mismatches.length) {
        // 仅输出字段名；数据库连接、口令和 PM2 完整环境不进入日志。
        console.error(`PM2 运行配置核验失败：${[...new Set(mismatches)].join('、')}。请加载一致的受保护环境后重试。`);
        process.exitCode = 1;
      }
    } catch {
      console.error('PM2 运行配置核验失败：无法读取有效的进程信息或部署配置。');
      process.exitCode = 1;
    }
  });

function physicalPath(file) {
  try {
    return fs.realpathSync(file);
  } catch (error) {
    if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
    const parent = path.dirname(file);
    if (parent === file) throw error;
    return path.join(physicalPath(parent), path.basename(file));
  }
}
