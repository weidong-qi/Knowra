import type { MigrationCodec } from './annotationInlineMigration';
import { inlineAnnotationHighlightBehavior } from './editorInlineAnnotations';
import { createHeadlessNoteCodec } from './headlessNoteCodec';

/** 测试与试运行用：迁移计算需要的 MigrationCodec，复用生产的无界面编辑器。只在 jsdom 等有 DOM 的环境里使用。 */
export async function createMigrationCodec(): Promise<MigrationCodec & { destroy(): Promise<void> }> {
  return createHeadlessNoteCodec('');
}

/** 带内联重点显示插件的测试编辑器：返回视图，供操作与装饰测试使用。 */
export async function createKnowraTestEditor(markdown: string) {
  return createHeadlessNoteCodec(markdown, [inlineAnnotationHighlightBehavior].flat());
}
