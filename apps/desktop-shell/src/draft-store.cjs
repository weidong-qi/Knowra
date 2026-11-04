const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function validateDraft(key, draft) {
  const prefix =
    typeof key === 'string' &&
    ['knowra:note-draft:v1:', 'knowra:knowledge-draft:v1:', 'knowra:pdf-draft:v1:'].find(value =>
      key.startsWith(value)
    );
  if (!prefix || key.length > 2000) throw new Error('草稿标识无效');
  let parts;
  try {
    parts = JSON.parse(key.slice(prefix.length));
  } catch {
    throw new Error('草稿标识无效');
  }
  if (!Array.isArray(parts) || parts.length !== 2 || parts.some(value => typeof value !== 'string' || !value))
    throw new Error('草稿标识无效');
  if (draft === null) return;
  if (!draft || JSON.stringify(draft).length > 20000000) throw new Error('恢复草稿无效或过大');
  if (prefix === 'knowra:pdf-draft:v1:') {
    if (draft.version !== 1 || !/^[a-f0-9]{64}$/.test(draft.sha256 ?? '') || !Array.isArray(draft.drafts))
      throw new Error('PDF 恢复草稿无效');
    return;
  }
  if (prefix === 'knowra:note-draft:v1:') {
    if (typeof draft.markdown !== 'string' || typeof draft.baseMarkdown !== 'string') throw new Error('恢复草稿无效');
    return;
  }
  const form = value =>
    value &&
    ['title', 'canonicalStatement', 'userExplanation'].every(key => typeof value[key] === 'string') &&
    ['concept', 'fact', 'principle', 'process', 'algorithm', 'formula', 'comparison', 'application'].includes(
      value.knowledgeType
    );
  const source = draft.source;
  if (
    draft.version !== 1 ||
    !['create', 'edit'].includes(draft.kind) ||
    draft.candidateId !== parts[1] ||
    !form(draft.initialValue) ||
    !form(draft.value) ||
    (draft.kind === 'edit' && (typeof draft.expectedUpdatedAt !== 'string' || !draft.expectedUpdatedAt)) ||
    (source &&
      (draft.kind !== 'create' ||
        typeof source.annotationId !== 'string' ||
        !source.annotationId ||
        typeof source.quoteText !== 'string' ||
        !Array.isArray(source.headingPath) ||
        source.headingPath.some(value => typeof value !== 'string') ||
        (source.noteVersionId !== undefined && typeof source.noteVersionId !== 'string') ||
        (source.expectedAnnotationRevision !== undefined &&
          (!Number.isInteger(source.expectedAnnotationRevision) || source.expectedAnnotationRevision < 1))))
  )
    throw new Error('知识恢复草稿格式无效');
}

// 只接受草稿键和值，渲染进程不能指定文件路径。
function createDraftStore(directory) {
  const file = path.join(directory, 'recovery-drafts.json');
  function read() {
    if (!fs.existsSync(file)) return {};
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (
      !value ||
      value.version !== 1 ||
      !value.drafts ||
      typeof value.drafts !== 'object' ||
      Array.isArray(value.drafts)
    )
      throw new Error('恢复草稿文件损坏，请保留文件后重试。');
    return value.drafts;
  }
  function write(key, draft) {
    validateDraft(key, draft);
    const drafts = read();
    if (draft === null) delete drafts[key];
    else drafts[key] = draft;
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(directory, `.draft-${crypto.randomUUID()}.tmp`);
    let fd;
    try {
      fd = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(fd, JSON.stringify({ version: 1, drafts }));
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(temporary, file);
      if (process.platform !== 'win32') {
        const directoryFd = fs.openSync(directory, 'r');
        try {
          fs.fsyncSync(directoryFd);
        } finally {
          fs.closeSync(directoryFd);
        }
      }
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      fs.rmSync(temporary, { force: true });
    }
  }
  return { read, write };
}
module.exports = { createDraftStore };
