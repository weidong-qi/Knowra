import { defaultValueCtx, rootCtx } from '@milkdown/kit/core';
import { clipboard } from '@milkdown/kit/plugin/clipboard';
import { history } from '@milkdown/kit/plugin/history';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { tableBlock, tableBlockConfig } from '@milkdown/kit/component/table-block';
import { imageBlockConfig, defaultImageBlockConfig } from '@milkdown/kit/component/image-block';
import { codeBlockComponent, codeBlockConfig } from '@milkdown/kit/component/code-block';
import { Editor } from '@milkdown/kit/core';
import { enhancedImageBlockComponent } from '../../enhanced-image-block.js';
import {
  insertImageBlockCommand,
  insertInternalLinkCommand,
  insertLinkCommand,
  turnIntoTaskListCommand
} from '../commands/editor-commands.js';
import { findHighlightBehavior } from '../plugins/find-highlight-plugin.js';
import { annotationHighlightBehavior } from '../plugins/annotation-highlight-plugin.js';
import { enhancedEnterBehavior } from '../plugins/enter-key-behavior-plugin.js';
import { createMarkdownPasteBehavior } from '../plugins/markdown-paste-plugin.js';
import { taskListClickBehavior } from '../plugins/task-list-click-plugin.js';
import {
  highlightRemark,
  highlightSchema,
  toggleHighlightCommand
} from '../schema/highlight-mark.js';
import { renderTableButton } from '../table/table-buttons.js';
import { createCodeBlockComponentConfig } from './code-block-component-config.js';
import { renderIcon } from '../../../icons/icon-map.js';

export function createConfiguredMilkdownEditor(host, markdown) {
  return Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, host.root);
      ctx.set(defaultValueCtx, markdown);
      ctx.set(imageBlockConfig.key, {
        ...defaultImageBlockConfig,
        uploadButton: '上传',
        uploadPlaceholderText: '或粘贴图片链接',
        confirmButton: renderIcon('imageConfirm', { className: 'milkdown-image-confirm-icon' }),
        onUpload: async (file) => host.uploadAttachmentImage(file)
      });
      ctx.set(tableBlockConfig.key, {
        renderButton: renderTableButton
      });
      ctx.set(codeBlockConfig.key, createCodeBlockComponentConfig());
      ctx.get(listenerCtx).markdownUpdated((listenerCtxValue, nextMarkdown) => {
        host.onChange?.(nextMarkdown, listenerCtxValue);
      });
      ctx.get(listenerCtx).updated(() => {
        host.scheduleImageLayoutRefreshBurst?.();
      });
    })
    .use(commonmark)
    .use(codeBlockComponent)
    .use(listener)
    .use(history)
    .use(createMarkdownPasteBehavior(host))
    .use(clipboard)
    .use(gfm)
    .use(insertLinkCommand)
    .use(insertImageBlockCommand)
    .use(insertInternalLinkCommand)
    .use(turnIntoTaskListCommand)
    .use(enhancedImageBlockComponent)
    .use(tableBlock)
    .use(enhancedEnterBehavior)
    .use(findHighlightBehavior)
    .use(annotationHighlightBehavior)
    .use(taskListClickBehavior)
    .use(highlightRemark)
    .use(highlightSchema)
    .use(toggleHighlightCommand);
}
