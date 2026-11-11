import { actionError } from './action-state.js';
import organizeParameters from './contracts/note-organize-v1.schema.json' with { type: 'json' };
import { NOTE_WRITE_TOOLS } from './note-plan.ts';
export type WriteIntent =
  | { toolName: 'notes_create'; noteId?: undefined }
  | { toolName: 'notes_append' | 'notes_propose_patch' | 'notes_propose_organize'; noteId: string };
type RawWriteIntent = { toolName?: unknown; noteId?: unknown };
interface AssistantWriteToolsOptions {
  canRead?: boolean;
}
// 静态schema只需暴露原map读取的properties；其他schema字段仍完整透传。
interface WriteToolDefinition {
  name: string;
  toolVersion?: number;
  description: string;
  parameters: { properties?: object };
}
export function validateWriteIntent(input: unknown): WriteIntent {
  if (
    !input ||
    Object.keys(input).some(key => !['toolName', 'noteId'].includes(key)) ||
    !['notes_create', 'notes_append', 'notes_propose_patch', 'notes_propose_organize'].includes(
      (input as RawWriteIntent).toolName as string
    ) ||
    ((input as RawWriteIntent).toolName === 'notes_create' && (input as RawWriteIntent).noteId !== undefined) ||
    ((input as RawWriteIntent).toolName !== 'notes_create' &&
      (typeof (input as RawWriteIntent).noteId !== 'string' ||
        !(input as RawWriteIntent).noteId ||
        ((input as RawWriteIntent).noteId as string).length > 128))
  ) {
    actionError('AI_REQUEST_INVALID', '写入意图必须指定明确工具与固定目标。', 422);
  }
  return structuredClone(input) as WriteIntent;
}
export function toolsForWriteIntent(intent: WriteIntent) {
  const valid = validateWriteIntent(intent);
  return [
    ...(NOTE_WRITE_TOOLS as readonly WriteToolDefinition[]),
    {
      name: 'notes_propose_organize',
      toolVersion: 1,
      description: '为固定目标提出改名、移动或标签整理；不修改正文。',
      parameters: organizeParameters
    }
  ]
    .filter(tool => tool.name === valid.toolName)
    .map(({ toolVersion, ...tool }) => ({
      ...tool,
      description: `${tool.description} ${valid.noteId ? `唯一目标 ID：${valid.noteId}。` : ''}仅提出计划，禁止宣称已经保存。`
    }));
}

/** 自主助手只能提出待审成果；实际提交仍由 action service 的用户确认契约保护。 */
export function toolsForAssistant({ canRead = false }: AssistantWriteToolsOptions = {}) {
  return [
    ...(NOTE_WRITE_TOOLS as readonly WriteToolDefinition[]),
    {
      name: 'notes_propose_organize',
      description: '为已读取的笔记提出改名、移动或标签整理，不修改正文。',
      parameters: organizeParameters
    }
  ]
    .filter(tool => canRead || tool.name === 'notes_create')
    .map(({ toolVersion, ...tool }) => ({
      ...tool,
      parameters: {
        ...tool.parameters,
        properties: {
          ...tool.parameters.properties,
          actionId: { type: 'string', minLength: 1, maxLength: 128, description: '继续修改同一待审成果时使用其 ID。' }
        }
      },
      description: `${tool.description} 仅在用户希望形成或修改成果时调用；普通聊天直接回答。既有目标必须先读取；仅形成收件箱待审稿，禁止宣称已保存。`
    }));
}
