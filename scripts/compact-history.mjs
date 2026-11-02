#!/usr/bin/env node
// 默认只读预览；应用需要同一数据哈希的预览和完整备份。生产运维先停止 API，再执行。
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createFileDataStore } from '../apps/api/src/infrastructure/file-data-store.js';
import { acquireDataFileWriteLock } from '../apps/api/src/infrastructure/data-file-write-lock.ts';
import { writeJsonFileAtomically } from '../apps/api/src/infrastructure/atomic-json-file.ts';
import { LOCAL_DATA_COLLECTIONS } from '../apps/api/src/infrastructure/local-data-schema.js';
import {
  planHistoryRetention,
  applyHistoryRetentionPlan,
  ANNOTATION_REVISION_RETENTION
} from '../apps/api/src/modules/knowledge/domain/history-retention.js';
import { NOTE_VERSION_RETENTION } from '../apps/api/src/modules/knowledge/domain/note-version-retention.js';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function fileDigest(file) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
const currentDigest = state =>
  digest(
    Object.fromEntries(
      LOCAL_DATA_COLLECTIONS.filter(name => !['noteVersions', 'annotationRevisions'].includes(name)).map(name => [
        name,
        state[name]
      ])
    )
  );

export async function compactHistory({ file, apply = false, preview, backupDirectory, now = Date.now() }) {
  const source = fs.realpathSync(file);
  if (apply && (!preview || !backupDirectory)) throw new Error('应用清理需要 --preview 和 --backup-dir。');
  const reviewed = apply ? JSON.parse(fs.readFileSync(preview, 'utf8')) : null;
  if (
    reviewed &&
    (reviewed.schemaVersion !== 1 ||
      reviewed.mode !== 'preview' ||
      reviewed.source !== source ||
      !Number.isFinite(Date.parse(reviewed.plannedAt)) ||
      now - Date.parse(reviewed.plannedAt) > 24 * 3600000 ||
      Date.parse(reviewed.plannedAt) > now + 1000)
  )
    throw new Error('预览无效、资料路径不同或已超过 24 小时，请重新预览。');
  const lock = apply ? acquireDataFileWriteLock(source) : null;
  try {
    const sourceSha256 = await fileDigest(source);
    if (reviewed && reviewed.sourceSha256 !== sourceSha256)
      throw new Error('资料库自预览后已变化，清理未执行；请重新预览。');
    let committing = false;
    const store = createFileDataStore(source, {
      maintenanceToken: lock?.token,
      // 加载如需要迁移则拒绝在预览/清理中顺带修改数据。
      writeJson: (...args) => {
        if (!committing) throw new Error('资料库需要先完成版本迁移，不能直接清理。');
        return writeJsonFileAtomically(...args);
      }
    });
    const references = store.getHistoryRetentionReferences();
    if (references === null) throw new Error('私有任务或来源记录不可读，未执行清理。');
    const plannedAt = reviewed?.plannedAt ?? new Date(now).toISOString();
    const plan = planHistoryRetention(store.state, { now: Date.parse(plannedAt), externalReferences: references });
    const policies = { notes: NOTE_VERSION_RETENTION, annotations: ANNOTATION_REVISION_RETENTION };
    const planHash = digest({
      sourceSha256,
      plannedAt,
      policies,
      versions: [...plan.removedVersions].sort(),
      revisions: [...plan.removedRevisions].sort()
    });
    const report = {
      schemaVersion: 1,
      mode: 'preview',
      source,
      sourceSha256,
      plannedAt,
      policies,
      planHash,
      summary: plan.summary,
      currentRecordsSha256: currentDigest(store.state),
      beforeBytes: fs.statSync(source).size
    };
    if ((await fileDigest(source)) !== sourceSha256) throw new Error('读取期间资料库已变化，请重新预览。');
    if (!apply) return report;
    if (reviewed.planHash !== planHash) throw new Error('当前规则或引用与预览不一致，未执行清理。');
    fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
    const backupPath = path.join(
      path.resolve(backupDirectory),
      `knowledge-base-before-history-${Date.now()}-${randomUUID()}.json`
    );
    fs.copyFileSync(source, backupPath, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(backupPath, 0o600);
    if ((await fileDigest(backupPath)) !== sourceSha256) throw new Error('备份校验失败，未执行清理。');
    // 复用已验证的后像，在独立事务中提交删除事实与主体，不直接重写裸 JSON。
    const next = applyHistoryRetentionPlan(store.state, plan);
    if (currentDigest(next) !== report.currentRecordsSha256) throw new Error('清理涉及当前业务记录，已拒绝。');
    committing = true;
    store.runSyncBatchTransaction(() => {
      for (const name of ['noteVersions', 'annotationRevisions'])
        store.state[name].splice(0, store.state[name].length, ...next[name]);
    });
    if (currentDigest(store.state) !== report.currentRecordsSha256)
      throw new Error('提交后业务记录校验不一致，请使用已保留的完整备份核查。');
    return {
      ...report,
      mode: 'applied',
      backupPath,
      backupSha256: sourceSha256,
      afterSha256: await fileDigest(source),
      afterBytes: fs.statSync(source).size
    };
  } finally {
    lock?.release();
  }
}

// 按真实文件身份识别硬链接、目录别名和大小写别名；报告不能覆盖资料库或预览。
function validateReportPath(report, inputs) {
  let output;
  try {
    output = fs.lstatSync(report, { bigint: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (output?.isSymbolicLink()) throw new Error('输出报告不能使用符号链接。');
  if (output && !output.isFile()) throw new Error('输出报告必须是普通文件。');
  for (const input of inputs.filter(Boolean)) {
    const identity = fs.statSync(input, { bigint: true });
    if (
      (output && output.dev === identity.dev && output.ino === identity.ino) ||
      path.resolve(report) === fs.realpathSync(input)
    )
      throw new Error('必须指定独立的资料库、预览和输出报告路径。');
  }
}

function options(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--apply') {
      result.apply = true;
      continue;
    }
    const key = { '--file': 'file', '--report': 'report', '--preview': 'preview', '--backup-dir': 'backupDirectory' }[
      args[i]
    ];
    if (!key || !args[i + 1] || args[i + 1].startsWith('--'))
      throw new Error(
        '用法：compact-history.mjs --file <资料库.json> --report <报告.json> [--apply --preview <预览.json> --backup-dir <目录>]'
      );
    result[key] = args[++i];
  }
  if (!result.file || !result.report) throw new Error('必须指定独立的资料库、预览和输出报告路径。');
  result.report = path.resolve(result.report);
  validateReportPath(result.report, [result.file, result.preview]);
  fs.mkdirSync(path.dirname(result.report), { recursive: true });
  result.report = path.join(fs.realpathSync(path.dirname(result.report)), path.basename(result.report));
  validateReportPath(result.report, [result.file, result.preview]);
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = options(process.argv.slice(2));
    const report = await compactHistory(config);
    validateReportPath(config.report, [config.file, config.preview]);
    // 独占创建临时文件再替换目录项，校验后出现的链接也不会被跟随写入。
    writeJsonFileAtomically(config.report, report);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
