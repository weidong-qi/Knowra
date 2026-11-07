import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { backup } from 'node:sqlite';
import { openReadonlySqliteSnapshot } from '../apps/desktop-runtime/src/sqlite-readonly-snapshot.mjs';
import { projectMarkdown } from '@study-accelerator/content-anchor';
import { calculateContentHash } from '../apps/api/src/modules/knowledge/domain/note-version.ts';
import {
  planHistoryRetention,
  changedHistoryNoteIds
} from '../apps/api/src/modules/knowledge/domain/history-retention.ts';
import { createContentAnnotationService } from '../apps/api/src/modules/knowledge/application/content-annotation-service.js';
import { createInMemoryContentAnnotationRepository } from '../apps/api/src/modules/knowledge/infrastructure/content-annotation-repository.js';
import { readActiveDirectory } from '../apps/desktop-runtime/src/restore-directory.mjs';
import { inspectAnnotationRetirement, readRetirementInspection } from './inspect-inline-annotation-retirement.mjs';
import { isDirectExecution } from './cli-entry.mjs';

// 对象键顺序不参与双端比对，数组顺序仍有意义。只输出摘要，不输出来源正文。
const canonical = value =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map(key => [key, canonical(value[key])])
        )
      : value;
const digest = value =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
const bytesHash = bytes => createHash('sha256').update(bytes).digest('hex');
const lifecycle = row => row.lifecycleStatus ?? (row.status === 'archived' ? 'archived' : 'active');
const occurrences = (text, quote) => {
  let count = 0;
  for (let start = 0; (start = text.indexOf(quote, start)) !== -1; start++) count++;
  return count;
};

function uniqueRow(rows, id) {
  const matches = (rows ?? []).filter(row => row.id === id);
  return matches.length === 1 ? matches[0] : null;
}

function evidence(state, row) {
  const note = uniqueRow(state.notes, row.noteId);
  const version = uniqueRow(state.noteVersions, row.noteVersionId);
  if (
    !note ||
    !version ||
    version.noteId !== note.id ||
    typeof note.rawMarkdown !== 'string' ||
    typeof version.content !== 'string' ||
    version.contentHash !== calculateContentHash(version.content) ||
    row.noteContentHash !== version.contentHash ||
    note.deleted !== true ||
    row.anchor != null ||
    row.originSnapshot != null ||
    row.comment ||
    typeof row.quoteText !== 'string' ||
    !row.quoteText ||
    !Number.isSafeInteger(row.fromPosition) ||
    !Number.isSafeInteger(row.toPosition) ||
    row.fromPosition < 0 ||
    row.toPosition <= row.fromPosition ||
    !Number.isSafeInteger(row.revision ?? 1) ||
    (row.revision ?? 1) < 1
  )
    return null;
  const text = projectMarkdown(note.rawMarkdown).text;
  const versionText = projectMarkdown(version.content).text;
  const diagnosis = {
    currentQuoteOccurrences: occurrences(text, row.quoteText),
    versionQuoteOccurrences: occurrences(versionText, row.quoteText),
    currentRawRangeMatches: note.rawMarkdown.slice(row.fromPosition, row.toPosition) === row.quoteText,
    currentProjectedRangeMatches: text.slice(row.fromPosition, row.toPosition) === row.quoteText,
    versionRawRangeMatches: version.content.slice(row.fromPosition, row.toPosition) === row.quoteText,
    versionProjectedRangeMatches: versionText.slice(row.fromPosition, row.toPosition) === row.quoteText
  };
  // 只处理已核查的这一类旧行；任何语义变化须重新决定方案。
  if (
    diagnosis.currentQuoteOccurrences !== 1 ||
    diagnosis.versionQuoteOccurrences !== 1 ||
    Object.entries(diagnosis).some(([key, value]) => key.endsWith('Matches') && value)
  )
    return null;
  const revisions = (state.annotationRevisions ?? [])
    .filter(value => value.annotationId === row.id)
    .sort((a, b) => a.id.localeCompare(b.id));
  const exclusions = (state.annotationExclusions ?? [])
    .filter(value => value.parentAnnotationId === row.id)
    .sort((a, b) => a.id.localeCompare(b.id));
  return { note, version, revisions, exclusions, diagnosis };
}

/** 在内存副本运行标准取消，再预演云端 JSON 提交时的保留策略；不绑定持久化回调。 */
function previewCancellationRetention(cloud, row, now) {
  const state = structuredClone(cloud.state);
  state.annotationRevisions ??= [];
  const at = new Date(now).toISOString();
  const service = createContentAnnotationService({
    repository: createInMemoryContentAnnotationRepository({ records: state.contentAnnotations }),
    revisionRepository: {
      save(record) {
        state.annotationRevisions.push({ ...record, createdAt: at });
      }
    }
  });
  const cancelled = service.deleteAnnotation(row.id, { expectedRevision: row.revision ?? 1 });
  cancelled.updatedAt = cancelled.deletedAt = at;
  // 与 file-data-store.getHistoryRetentionReferences 一致，兼容根文档和 data 包装；任务工作区/待办不是保留根。
  const externalReferences = cloud.privateSources
    .filter(source =>
      /^json(?:\.data)?\.(aiRuntime|coreOperations|knowledgeExtractionCommits|aiKnowledgeExtractionTasks)$/.test(
        source.name
      )
    )
    .flatMap(source => source.records);
  const plan = planHistoryRetention(state, {
    now,
    noteIds: changedHistoryNoteIds(cloud.state, state),
    externalReferences
  });
  return Object.fromEntries(Object.entries(plan.summary).map(([name, summary]) => [name, summary.removed]));
}

/** 只生成维护计划；ready 仅表示这两个快照通过预检，不授权操作活动库。 */
export function planV1AnnotationMaintenance(cloud, local, now = Date.now()) {
  const cloudReport = inspectAnnotationRetirement(cloud.state, now, cloud);
  const localReport = inspectAnnotationRetirement(local.state, now, local);
  const blockers = new Set();
  if (
    cloud.coverage.privateRecords !== 'checked' ||
    cloud.coverage.pendingSync !== 'not-applicable-server-json' ||
    local.coverage.privateRecords !== 'checked' ||
    local.coverage.pendingSync !== 'checked'
  )
    blockers.add('incomplete-coverage');
  if (localReport.pendingSync.valuesScanned) blockers.add('pending-sync');
  const active = state =>
    state.contentAnnotations.filter(row => (row.schemaVersion ?? 1) === 1 && lifecycle(row) === 'active');
  const cloudRows = active(cloud.state),
    localRows = active(local.state);
  let request = null,
    diagnosis = null,
    baselineSha256 = null,
    retentionPreview = null;
  if (cloudRows.length !== 1 || localRows.length !== 1) blockers.add('expected-one-active-v1');
  else {
    const row = cloudRows[0];
    const left = evidence(cloud.state, row),
      right = evidence(local.state, localRows[0]);
    if (!left || !right) blockers.add('source-evidence-changed');
    else {
      diagnosis = left.diagnosis;
      // 比较原始记录、整条父笔记和绑定版本；不通过构造器补默认值掩盖差异。
      if (digest({ row, ...left }) !== digest({ row: localRows[0], ...right })) blockers.add('cloud-local-mismatch');
      const targetState = state => ({
        ...state,
        contentAnnotations: state.contentAnnotations.filter(value => value.id === row.id)
      });
      for (const state of [cloud.state, local.state]) {
        const references = inspectAnnotationRetirement(targetState(state), now).legacy.referencesByCollection;
        if (Object.keys(references).length) blockers.add('protected-core-reference');
      }
      if (left.exclusions.length || right.exclusions.length) blockers.add('unexpected-exclusions');
      baselineSha256 = digest({ row, ...left });
      retentionPreview = previewCancellationRetention(cloud, row, now);
      if (Object.values(retentionPreview).some(removed => removed > 0)) blockers.add('history-retention-side-effects');
      request = {
        method: 'DELETE',
        path: `/api/knowledge/annotations/${encodeURIComponent(row.id)}`,
        body: { expectedRevision: row.revision ?? 1 }
      };
    }
  }
  const report = {
    format: 'knowra-v1-maintenance-plan',
    version: 1,
    generatedAt: new Date(now).toISOString(),
    scope: 'two-snapshots-only',
    status: blockers.size ? 'blocked' : 'ready-for-maintenance-window',
    blockers: [...blockers],
    activeV1: { cloud: cloudRows.length, local: localRows.length },
    baselineSha256,
    diagnosis,
    retentionPreview,
    pendingSync: { valuesScanned: localReport.pendingSync.valuesScanned },
    privateHistory: {
      cloudLegacyCopies: cloudReport.privateRecords.legacyCopies,
      localLegacyCopies: localReport.privateRecords.legacyCopies
    },
    currentLegacyRows: { cloud: cloudReport.legacy.total, local: localReport.legacy.total },
    existingLatestRetentionEnd: cloudReport.legacy.latestRetentionEnd,
    execution: 'requires-fresh-live-check-backups-and-quiet-window'
  };
  // 请求只放在权限受限的文件里，不进 stdout；阻塞时不提供可执行请求。
  return { report, request: blockers.size ? null : request };
}

/** 云端文件须由操作者从活动路径取回；SQLite 先复制 DB/WAL/SHM，再从临时副本生成独立备份。 */
export async function prepareV1AnnotationMaintenance({ cloudSource, localRoot, outputDirectory }) {
  const cloudFile = fs.realpathSync(cloudSource);
  const root = fs.realpathSync(localRoot);
  const active = fs.realpathSync(readActiveDirectory(root));
  const localFile = fs.realpathSync(path.join(active, 'local.sqlite'));
  // 必须新目录，不能复用或覆盖来源、旧计划、备份。
  fs.mkdirSync(outputDirectory, { mode: 0o700 });
  const output = fs.realpathSync(outputDirectory);
  const cloudBackup = path.join(output, 'cloud.json'),
    localBackup = path.join(output, 'local.sqlite');
  const cloudBytes = fs.readFileSync(cloudFile);
  fs.writeFileSync(cloudBackup, cloudBytes, { mode: 0o600, flag: 'wx' });
  // 预建私有文件，避免 SQLite 新建文件受宽松 umask 影响。
  fs.closeSync(fs.openSync(localBackup, 'wx', 0o600));
  const snapshot = openReadonlySqliteSnapshot(localFile);
  try {
    await backup(snapshot.database, localBackup);
  } finally {
    snapshot.close();
  }
  if (!fs.readFileSync(cloudFile).equals(cloudBytes) || fs.realpathSync(readActiveDirectory(root)) !== active)
    throw new Error('取快照期间来源已变化，文件已保留但未生成维护计划；请重新核对。');
  const cloud = await readRetirementInspection('local-json', cloudBackup);
  const local = await readRetirementInspection('sqlite', localBackup);
  const { report, request } = planV1AnnotationMaintenance(cloud, local);
  const manifest = {
    ...report,
    sources: { cloudFile, localFile },
    backups: { cloudSha256: bytesHash(cloudBytes), localSha256: bytesHash(fs.readFileSync(localBackup)) },
    request
  };
  fs.writeFileSync(path.join(output, 'plan.json'), JSON.stringify(manifest, null, 2), { mode: 0o600, flag: 'wx' });
  // 报告不含来源路径、对象 ID、正文或请求；完整资料仅在私有目录保留。
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600, flag: 'wx' });
  return report;
}

async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    console.log(
      '用法：node scripts/prepare-v1-annotation-maintenance.mjs --cloud-source=活动云端JSON副本 --local-root=Mac资料根目录 --output-dir=新的私有目录\n只读备份与预检，不连接云端、不取消或回收数据。快照通过也须在停用 App 的窗口重新核对活动版本、revision 和队列；退出 0 为快照就绪、2 为阻塞、1 为读取/格式错误。'
    );
    return;
  }
  const keys = { 'cloud-source': 'cloudSource', 'local-root': 'localRoot', 'output-dir': 'outputDirectory' };
  const options = {};
  for (const argument of args) {
    const match = /^--(cloud-source|local-root|output-dir)=(.+)$/.exec(argument);
    if (!match || options[keys[match[1]]]) throw new Error('参数无效，请使用 --help。');
    options[keys[match[1]]] = path.resolve(match[2]);
  }
  if (Object.keys(options).length !== 3) throw new Error('必须指定云端副本、Mac 资料根目录和新的输出目录。');
  const report = await prepareV1AnnotationMaintenance(options);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.status === 'blocked' ? 2 : 0;
}
if (isDirectExecution(import.meta.url))
  main(process.argv.slice(2)).catch(() => {
    // 底层校验器错误可能包含来源片段，CLI 统一隐藏原值。
    console.error('V1 维护预检失败，未执行取消；请核对参数、格式和版本，已生成的快照保留在输出目录。');
    process.exitCode = 1;
  });
