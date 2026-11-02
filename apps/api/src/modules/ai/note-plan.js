import { assertAiReadableNote } from './note-privacy.js';
import Ajv2020 from 'ajv/dist/2020.js';
import schema from './contracts/note-tools-v1.schema.json' with { type: 'json' };
import { hashRecord } from './record-contract.js';
import { calculateContentHash } from '../knowledge/domain/note-version.js';
import { buildCreateNoteDto, buildUpdateNoteDto } from '../knowledge/application/dto/note.dto.js';

const descriptions = {
  notes_create: '为用户明确要求的新笔记提出标题与 Markdown。目标 ID 和位置权限由宿主固定；结果仅为计划。',
  notes_append: '为指定笔记的宿主固定位置提出原样追加内容，包含所需段落换行；结果仅为带基线的计划。',
  notes_propose_patch: '提出确切 UTF-16 范围及原文的局部替换；重复片段必须给范围，需用户审阅，结果仅为计划。'
};
export const NOTE_WRITE_TOOLS = freeze(
  Object.entries(schema.$defs).map(([name, parameters]) => ({
    name,
    toolVersion: 1,
    description: descriptions[name],
    parameters
  }))
);
const ajv = new /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (/** @type {unknown} */ (Ajv2020))({
  strict: false,
  allErrors: true
});
const validators = Object.fromEntries(
  Object.entries(schema.$defs).map(([name, definition]) => [name, ajv.compile(definition)])
);
const fail = (code, message) => {
  /** @type {Error & Partial<Pick<import('../../errors/app-error.ts').AppError, 'code'>>} */
  const error = new Error(message);
  error.code = code;
  throw error;
};
const id = value =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 200 &&
  value.trim() === value &&
  !Array.from(value).some(character => character.charCodeAt(0) <= 31);
const boundary = (text, offset) =>
  offset === 0 ||
  offset === text.length ||
  !(
    text.charCodeAt(offset - 1) >= 0xd800 &&
    text.charCodeAt(offset - 1) <= 0xdbff &&
    text.charCodeAt(offset) >= 0xdc00 &&
    text.charCodeAt(offset) <= 0xdfff
  );
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** 此处只形成不可变计划，不判断写授权、不提交业务；trusted 只由宿主提供。 */
export function createNoteWritePlan({ toolName, arguments: input, trusted }) {
  const validate = typeof toolName === 'string' && Object.hasOwn(validators, toolName) ? validators[toolName] : null;
  if (!validate || !validate(input)) fail('AI_NOTE_TOOL_INVALID', '笔记工具字段不符合白名单。');
  const args = structuredClone(input);
  const keys = [
    'actorId',
    'ownerId',
    'datasetId',
    'datasetEpoch',
    'spaceId',
    'requestId',
    'operationId',
    'targetNoteId'
  ];
  if (!trusted || keys.some(key => !id(trusted[key]))) fail('AI_NOTE_TARGET_INVALID', '缺少宿主固定的目标与请求身份。');
  const identity = Object.fromEntries(keys.map(key => [key, trusted[key]]));
  let before = null,
    after,
    edits = [],
    baseline;
  if (toolName === 'notes_create') {
    if (trusted.note) fail('AI_NOTE_TARGET_CONFLICT', '新建目标 ID 已存在。');
    const folderId = args.folderId ?? null,
      tagIds = args.tagIds ?? [];
    if (
      (folderId !== null && !trusted.allowedFolderIds?.includes(folderId)) ||
      tagIds.some(tag => !trusted.allowedTagIds?.includes(tag))
    )
      fail('AI_NOTE_REFERENCE_DENIED', '目录或标签不在宿主允许范围。');
    if (!args.title.trim()) fail('AI_NOTE_TOOL_INVALID', '新笔记标题不能为空。');
    const dto = buildCreateNoteDto({ ...args, id: trusted.targetNoteId, spaceId: trusted.spaceId, folderId, tagIds });
    after = {
      id: dto.id,
      spaceId: dto.spaceId,
      title: dto.title,
      folderId: dto.folderId,
      tagIds: dto.tagIds,
      rawMarkdown: dto.rawMarkdown,
      aiVisibility: 'normal'
    };
    baseline = { targetNoteId: trusted.targetNoteId, exists: false };
  } else {
    const note = trusted.note;
    if (
      !note ||
      note.id !== trusted.targetNoteId ||
      args.noteId !== trusted.targetNoteId ||
      note.spaceId !== trusted.spaceId ||
      note.deleted ||
      typeof note.rawMarkdown !== 'string'
    ) {
      fail('AI_NOTE_TARGET_INVALID', '只能修改宿主指定的当前空间有效笔记。');
    }
    assertAiReadableNote(note);
    const expectedUpdatedAt = new Date(note.updatedAt);
    if (Number.isNaN(expectedUpdatedAt.getTime()) || note.updatedAt == null)
      fail('AI_NOTE_BASELINE_INVALID', '笔记基线时间无效。');
    before = {
      id: note.id,
      spaceId: note.spaceId,
      title: note.title,
      folderId: note.folderId ?? null,
      tagIds: [...(note.tagIds ?? [])],
      rawMarkdown: note.rawMarkdown,
      aiVisibility: note.aiVisibility ?? 'normal'
    };
    baseline = {
      targetNoteId: note.id,
      exists: true,
      expectedUpdatedAt: expectedUpdatedAt.toISOString(),
      contentHash: calculateContentHash(note.rawMarkdown),
      metadataHash: hashRecord({
        title: before.title,
        folderId: before.folderId,
        tagIds: [...before.tagIds].sort(),
        spaceId: before.spaceId,
        aiVisibility: before.aiVisibility
      })
    };
    if (toolName === 'notes_append') {
      const offset = trusted.appendOffset ?? note.rawMarkdown.length;
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        offset > note.rawMarkdown.length ||
        !boundary(note.rawMarkdown, offset)
      ) {
        fail('AI_NOTE_ANCHOR_INVALID', '追加位置不在宿主基线的合法字符边界。');
      }
      edits = [{ start: offset, end: offset, quote: '', replacement: args.rawMarkdown }];
    } else {
      edits = args.replacements.sort((a, b) => a.start - b.start);
      for (let index = 0; index < edits.length; index++) {
        const edit = edits[index];
        if (
          edit.end <= edit.start ||
          edit.end > note.rawMarkdown.length ||
          !boundary(note.rawMarkdown, edit.start) ||
          !boundary(note.rawMarkdown, edit.end) ||
          note.rawMarkdown.slice(edit.start, edit.end) !== edit.quote ||
          (index > 0 && edits[index - 1].end > edit.start)
        )
          fail('AI_NOTE_PATCH_INVALID', '替换范围、原文或字符边界不匹配，不能模糊替换。');
      }
    }
    let rawMarkdown = note.rawMarkdown;
    for (const edit of [...edits].reverse())
      rawMarkdown = rawMarkdown.slice(0, edit.start) + edit.replacement + rawMarkdown.slice(edit.end);
    buildUpdateNoteDto({ rawMarkdown, expectedUpdatedAt: baseline.expectedUpdatedAt });
    after = { ...before, rawMarkdown };
    if (after.rawMarkdown === before.rawMarkdown) fail('AI_NOTE_NO_CHANGE', '计划未产生正文变化。');
  }
  if (Buffer.byteLength(after.rawMarkdown) > 400_000) fail('AI_NOTE_PLAN_LIMIT', '单篇计划正文超过上限。');
  const plan = {
    schemaVersion: 1,
    toolVersion: 1,
    resultKind: 'plan',
    status: 'planned',
    toolName,
    ...identity,
    targetIds: [trusted.targetNoteId],
    baseline,
    baselineHash: hashRecord(baseline),
    before,
    after,
    edits,
    approvalMode: toolName === 'notes_propose_patch' ? 'previewRequired' : 'requestBound'
  };
  return freeze({ ...plan, planHash: hashRecord(plan) });
}
