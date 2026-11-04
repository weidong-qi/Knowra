import { readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const testRoot = __dirname;

/**
 * 等待一整轮 microtask + setImmediate,直到事件循环稳定。
 * 用于隔离 IIFE 风格的测试(它们在 import 后异步执行,会修改 globalThis.document 等)。
 * 等待 3 轮 setImmediate 让所有微任务与计划任务都有机会完成。
 */
async function settleEventLoop() {
  for (let i = 0; i < 3; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/**
 * 递归收集 testRoot 下所有 `*.test.js` 文件,排除:
 *   - run-tests.js 自身
 *   - 以 `_` 开头的支持文件
 *   - `node_modules` 与隐藏目录
 */
function collectTestFiles(dir) {
  const entries = readdirSync(dir);
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      files.push(...collectTestFiles(full));
    } else if (
      entry.endsWith('.test.js')
      && entry !== 'run-tests.js'
      && !entry.startsWith('_')
    ) {
      files.push(full);
    }
  }
  return files.sort();
}

const files = collectTestFiles(testRoot);
let passed = 0;
let failed = 0;
const failures = [];

for (const file of files) {
  const rel = relative(testRoot, file);
  const url = pathToFileURL(file).href;
  try {
    // import 前先稳定事件循环,确保上一个测试的 IIFE 已清理全局状态
    await settleEventLoop();
    await import(url);
    // import 后再次稳定,让当前测试的 IIFE 跑完
    await settleEventLoop();
    passed += 1;
    console.log(`PASS ${rel}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${rel}`);
    console.error(error && error.stack ? error.stack : error);
    failures.push({ file: rel, error });
    // 即使失败也要稳定事件循环,避免污染后续测试
    await settleEventLoop();
  }
}

console.log(`\nWeb tests: ${passed} passed, ${failed} failed (of ${files.length}).`);
if (failed > 0) {
  process.exitCode = 1;
  console.error(`\nFirst failure: ${failures[0].file}`);
}
