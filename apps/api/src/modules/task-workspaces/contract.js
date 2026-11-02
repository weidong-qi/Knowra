import { createHash } from 'node:crypto';
import { createAppError } from '../../errors/app-error.js';
export const LIMITS = Object.freeze({
  markdown: 256 * 1024,
  pageText: 16 * 1024,
  progress: 4096,
  summary: 16384,
  artifacts: 20,
  leaseMs: 300000
});
const messages = {
  INVALID: '任务工作区参数无效。',
  CONFLICT: '内容或任务状态已变化，请刷新后重试。',
  FORBIDDEN: '无法访问此任务工作区内容。',
  UNAVAILABLE: '当前宿主未提供任务工作区能力。',
  LEASE_EXPIRED: '执行租约已失效，请重新领取。',
  CURSOR_INVALID: '列表已变化，请从第一页重新加载。',
  LIMIT: '内容超过任务工作区限制。'
};
/** @returns {never} */
export function fail(code = 'INVALID') {
  throw createAppError(
    `TASK_WORKSPACE_${code}`,
    messages[code] ?? messages.INVALID,
    {
      INVALID: 422,
      CONFLICT: 409,
      FORBIDDEN: 403,
      UNAVAILABLE: 503,
      LEASE_EXPIRED: 409,
      CURSOR_INVALID: 409,
      LIMIT: 413
    }[code] ?? 422
  );
}
export const hash = value =>
  createHash('sha256')
    .update(typeof value === 'string' || Buffer.isBuffer(value) ? value : stable(value))
    .digest('hex');
export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map(k => `${JSON.stringify(k)}:${stable(value[k])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export function uuid(value) {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  )
    fail();
  return value;
}
export function text(value, max = 1024, empty = false) {
  if (typeof value !== 'string' || (!empty && !value.trim())) fail();
  if (Buffer.byteLength(value) > max) fail('LIMIT');
  return value;
}
export function revision(value) {
  if (!Number.isSafeInteger(value) || value < 1) fail();
  return value;
}
export function fields(value, allowed, required = []) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(k => !allowed.includes(k)) ||
    required.some(k => !Object.hasOwn(value, k))
  )
    fail();
}
export function identity(tx, ctx) {
  const current = tx.identity();
  if (
    !ctx ||
    !['user', 'mcp'].includes(ctx.actor?.kind) ||
    typeof ctx.actor.id !== 'string' ||
    !ctx.actor.id ||
    ctx.datasetId !== current.datasetId ||
    ctx.datasetEpoch !== current.datasetEpoch
  )
    fail('FORBIDDEN');
  return current;
}
export function imageUri(workspaceId, documentId, attachmentId) {
  return `/api/task-workspaces/${workspaceId}/documents/${documentId}/attachments/${attachmentId}/content`;
}
/** No raw HTML, reference-style or encoded image targets: one canonical owned namespace only. */
export function imageReferences(markdown, workspaceId, documentId, attachments) {
  text(markdown, LIMITS.markdown, true);
  if (/<\s*\/?\s*(?:img|picture|source|svg|iframe|object|embed|video|audio)\b/i.test(markdown)) fail();
  const found = new Set();
  const stripped = markdown.replace(/!\[([^\]\n]*)\]\(([^\s()]+)(?:\s+"[^"\n]*")?\)/g, (all, alt, target) => {
    const item = attachments.find(a => target === imageUri(workspaceId, documentId, a.id));
    if (!item) fail();
    found.add(item.id);
    return '';
  });
  if (/!\[/.test(stripped)) fail();
  // Canonical attachment links cannot smuggle other workspaces or private-note paths.
  const refs = markdown.match(/\/api\/[^\s<>"')]+/g) ?? [];
  for (const ref of refs)
    if (ref.includes('attachment') && !attachments.some(a => ref === imageUri(workspaceId, documentId, a.id))) fail();
  return found;
}
export function safeAttachment(a) {
  const { id, documentId, fileName, mimeType, size, sha256, status, createdAt } = a;
  return {
    id,
    documentId,
    fileName,
    mimeType,
    size,
    sha256,
    status,
    createdAt
  };
}
export function safeWorkspace(w) {
  const { id, name, description, archivedAt, revision, createdAt, updatedAt } = w;
  return { id, name, description, archivedAt, revision, createdAt, updatedAt };
}
export function safeDocument(d, versionId, start = 0) {
  const v = d.versions.find(v => v.id === (versionId ?? d.currentVersionId));
  if (!v) fail('FORBIDDEN');
  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    start > v.markdown.length ||
    (start && /[\uDC00-\uDFFF]/.test(v.markdown[start]))
  )
    fail();
  let end = Math.min(start + LIMITS.pageText, v.markdown.length);
  if (end < v.markdown.length && /[\uDC00-\uDFFF]/.test(v.markdown[end])) end--;
  const { id, ordinal, contentHash, createdAt, actor } = v;
  return {
    id: d.id,
    workspaceId: d.workspaceId,
    title: d.title,
    revision: d.revision,
    currentVersionId: d.currentVersionId,
    version: { id, ordinal, contentHash, createdAt, actor },
    markdown: v.markdown.slice(start, end),
    start,
    end,
    hasMore: end < v.markdown.length,
    attachments: d.attachments.map(safeAttachment)
  };
}
export function safeAttempt(a) {
  if (!a) return null;
  const {
    id,
    taskId,
    workspaceId,
    requirementId,
    generation,
    actor,
    status,
    leaseExpiresAt,
    progress,
    submission,
    startedAt,
    finishedAt
  } = a;
  return {
    id,
    taskId,
    workspaceId,
    requirementId,
    generation,
    actor,
    status,
    leaseExpiresAt,
    progress,
    submission,
    startedAt,
    finishedAt
  };
}
function progressPreview(value) {
  // Imported records are also bounded at projection time; never split a surrogate pair.
  let end = Math.min(value.length, 1024);
  if (end < value.length && /[\uDC00-\uDFFF]/.test(value[end])) end--;
  return value.slice(0, end);
}
export function taskSummary(t, tx, now, canExecute = false) {
  const a = t.activeAttemptId ? tx.get('attempts', t.activeAttemptId) : null;
  return {
    id: t.id,
    workspaceId: t.workspaceId,
    title: t.title,
    status: t.status,
    revision: t.revision,
    currentRequirementId: t.currentRequirementId,
    activeAttemptId: t.activeAttemptId,
    leaseExpiresAt: a?.leaseExpiresAt ?? null,
    // actor originates in the trusted host context, never in an Agent-supplied display name.
    currentExecutor:
      a?.actor?.kind === 'mcp'
        ? {
            kind: 'mcp',
            id: a.actor.id,
            label: `客户端 ${a.actor.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 8) || '未命名'}`
          }
        : null,
    latestProgress: a?.progress
      ? {
          message: progressPreview(a.progress.message),
          updatedAt: a.progress.updatedAt
        }
      : null,
    leaseExpired: t.status === 'running' && Boolean(a?.leaseExpiresAt) && Date.parse(a.leaseExpiresAt) <= now,
    claimable: canExecute && (t.status === 'ready' || (t.status === 'running' && Date.parse(a?.leaseExpiresAt) <= now)),
    updatedAt: t.updatedAt
  };
}
