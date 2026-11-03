import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCssWithImports } from './helpers/read-css.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const editorHostControllerJs = fs.readFileSync(path.resolve(__dirname, '../src/controllers/editor/host-controller.js'), 'utf8');
const menuRenderersJs = fs.readFileSync(path.resolve(__dirname, '../lib/editor/menu-renderers.js'), 'utf8');
const editorContextModelJs = fs.readFileSync(path.resolve(__dirname, '../lib/editor/context-menu-model.js'), 'utf8');
const milkdownEntry = fs.readFileSync(path.resolve(__dirname, '../lib/editor/milkdown-entry.js'), 'utf8');
const editorFactoryJs = fs.readFileSync(path.resolve(__dirname, '../lib/editor/milkdown/host/editor-factory.js'), 'utf8');
const commandResolversJs = fs.readFileSync(path.resolve(__dirname, '../lib/editor/milkdown/commands/command-resolvers.js'), 'utf8');
const componentsCss = readCssWithImports(path.resolve(__dirname, '../styles/components.css'));
const enhancedImageBlock = fs.readFileSync(path.resolve(__dirname, '../lib/editor/enhanced-image-block.js'), 'utf8');
const imageBlockAttrsJs = fs.readFileSync(path.resolve(__dirname, '../lib/editor/image-block-attrs.js'), 'utf8');
const imageBlockDomJs = fs.readFileSync(path.resolve(__dirname, '../lib/editor/image-block-dom.js'), 'utf8');
const imagePasteControllerJs = fs.readFileSync(path.resolve(__dirname, '../lib/editor/milkdown/host/image-paste-controller.js'), 'utf8');
const imageBlockRenderersJs = fs.readFileSync(path.resolve(__dirname, '../lib/editor/image-block-renderers.js'), 'utf8');
const imageBlockResizeJs = fs.readFileSync(path.resolve(__dirname, '../lib/editor/image-block-resize.js'), 'utf8');
const imageLayoutControllerJs = fs.readFileSync(path.resolve(__dirname, '../lib/editor/milkdown/host/image-layout-controller.js'), 'utf8');
const imageUploadJs = fs.readFileSync(path.resolve(__dirname, '../lib/editor/milkdown/host/image-upload.js'), 'utf8');
// 在 codex-architecture-refactor-phase-1 重构后,image/table 相关的 import 与
// .use() 注册已从 milkdown-entry.js 迁到 milkdown/host/editor-factory.js;
// 下列断言主要检查"插件管线是否注册了 image-block 相关能力",因此重定向到 editor-factory。
const milkdownImageHostJs = [
  editorFactoryJs,
  imageLayoutControllerJs,
  imageUploadJs,
  imagePasteControllerJs
].join('\n');
const imageBlockPluginJs = [
  enhancedImageBlock,
  imageBlockAttrsJs,
  imageBlockDomJs,
  imageBlockRenderersJs,
  imageBlockResizeJs
].join('\n');
const buildScript = fs.readFileSync(path.resolve(__dirname, '../../../scripts/build-milkdown-bundle.mjs'), 'utf8');

assert.match(
  menuRenderersJs,
  /const FORMAT_MENU_ITEMS = \[[\s\S]*\{ key: 'image', label: '图片' \}[\s\S]*\];/,
  'format menu should expose an image insertion entry'
);

assert.match(
  editorContextModelJs,
  /EDITOR_CONTEXT_INSERT_ITEMS = \[[\s\S]*'image'[\s\S]*\];/,
  'context menu insert submenu should expose image insertion'
);

assert.match(
  editorContextModelJs,
  /image: \{ label: '图片' \}/,
  'image insertion should have a localized menu label'
);

assert.match(
  editorFactoryJs,
  /import \{[^}]*imageBlockConfig[^}]*defaultImageBlockConfig[^}]*\} from '@milkdown\/kit\/component\/image-block';/,
  'editor host should reuse the official Milkdown image-block config from source'
);

assert.match(
  editorFactoryJs,
  /import \{ enhancedImageBlockComponent \} from '\.\.\/\.\.\/enhanced-image-block\.js';/,
  'editor host should import the local enhanced image-block plugin'
);

assert.match(
  editorFactoryJs,
  /\.use\(enhancedImageBlockComponent\)/,
  'editor host should register the local enhanced image-block plugin in the Milkdown pipeline'
);

assert.match(
  editorFactoryJs,
  /\.use\(insertImageBlockCommand\)/,
  'editor host should register the image insertion command plugin'
);

assert.match(
  editorFactoryJs,
  /\.use\(insertLinkCommand\)/,
  'editor host should register the link insertion command plugin'
);

assert.match(
  editorFactoryJs,
  /\.use\(insertInternalLinkCommand\)/,
  'editor host should register the internal-link insertion command plugin'
);

assert.match(
  editorFactoryJs,
  /\.use\(turnIntoTaskListCommand\)/,
  'editor host should register the task-list insertion command plugin'
);

assert.match(
  editorFactoryJs,
  /ctx\.set\(imageBlockConfig\.key, \{[\s\S]*onUpload: async \(file\) =>/,
  'image-block configuration should provide an upload handler'
);

assert.match(
  editorFactoryJs,
  /uploadButton:\s*'上传'[\s\S]*uploadPlaceholderText:\s*'或粘贴图片链接'[\s\S]*confirmButton:\s*renderIcon\('imageConfirm'/,
  'image-block configuration should localize the empty-state actions and use the formal local icon mapping'
);

assert.match(
  milkdownImageHostJs,
  /fileToBase64\(file\)[\s\S]*uploadAttachment\(\{/,
  'image upload host helper should only prepare the attachment payload before calling the injected service'
);

assert.match(
  milkdownImageHostJs,
  /createImageUploadPlaceholderSrc\([\s\S]*replaceSelectionWith\(node,\s*false\)[\s\S]*host\.uploadAttachmentImage\(file\)[\s\S]*setNodeAttribute\(position,\s*'src',\s*nextSrc\)/,
  'pasted image files should insert a placeholder block first and then swap in the uploaded attachment URL in place'
);

assert.doesNotMatch(
  imageUploadJs,
  /\bfetch\(/,
  'image upload host helper should not perform network requests directly'
);

assert.match(
  commandResolversJs,
  /image: \(\) => \(\{ key: insertImageBlockCommand\.key \}\)/,
  'image command should insert an image-block node instead of raw markdown'
);

assert.match(
  editorHostControllerJs,
  /const handleAttachmentUpload = async \(input\) => \{[\s\S]*knowledgeApi\.uploadAttachmentImage\(input\)[\s\S]*state\.attachments = \[[\s\S]*renderSidebar\(getCurrentNote\(\)\);[\s\S]*return uploaded\?\.referenceUrl[\s\S]*buildAttachmentReferenceUrl\(attachment\?\.id\)[\s\S]*uploaded\?\.contentUrl[\s\S]*'';/,
  'editor host should sync newly uploaded image attachments into the sidebar state and return an attachment-aware reference URL to the image block'
);

assert.match(
  editorHostControllerJs,
  /createMilkdownHost\(\{[\s\S]*noteId,[\s\S]*uploadAttachmentImage: handleAttachmentUpload,[\s\S]*onChange: handleEditorMarkdownChange[\s\S]*\}\)/,
  'editor host should receive the active note id and wrapped upload service'
);

assert.match(
  milkdownImageHostJs,
  /refreshImageBlockLayouts\(\)|scheduleImageLayoutRefresh\(\)|ResizeObserver/,
  'editor host should re-run image sizing after layout changes'
);

assert.match(
  componentsCss,
  /\.milkdown-image-block[\s\S]*\.image-toolbar[\s\S]*\.image-stage/,
  'editor styles should include image-block layout rules'
);

assert.match(
  componentsCss,
  /\.image-toolbar[\s\S]*position:\s*absolute;[\s\S]*top:\s*6px;[\s\S]*right:\s*12px;[\s\S]*opacity:\s*0;[\s\S]*\.milkdown-image-block\.selected \.image-toolbar[\s\S]*opacity:\s*1;/,
  'image toolbar should float at the top-right and only appear for the selected image block'
);

assert.match(
  componentsCss,
  /\.image-stage[\s\S]*cursor:\s*default;[\s\S]*user-select:\s*none;[\s\S]*\.image-stage > img[\s\S]*cursor:\s*default;[\s\S]*user-select:\s*none;/,
  'image blocks should use an arrow cursor and disable text-style selection when hovering the image area'
);

assert.match(
  componentsCss,
  /\.image-resize-handle[\s\S]*\.milkdown-resize-handle/,
  'editor styles should keep proportional resize handles visible and usable'
);

assert.doesNotMatch(
  milkdownEntry,
  /ImageOverlayResizer|attachImageResizer\(/,
  'editor host should not keep the legacy overlay resizer once source-level image plugin takes over'
);

assert.match(
  imageBlockPluginJs,
  /computeFittedImageDimensions|computeResizeRatioFromCornerDrag|IMAGE_PRESET_BUTTONS/,
  'enhanced image block plugin should centralize fitted sizing, proportional dragging, and preset controls'
);

assert.match(
  imageBlockResizeJs,
  /window\.addEventListener\('pointermove', controller\.onPointerMove\);[\s\S]*window\.addEventListener\('pointerup', controller\.onPointerUp\);[\s\S]*window\.addEventListener\('pointercancel', controller\.onPointerUp\);/,
  'image resize interactions should also recover from pointer cancellation on Safari and trackpads'
);

assert.match(
  imageBlockResizeJs,
  /window\.removeEventListener\('pointermove', controller\.onPointerMove\);[\s\S]*window\.removeEventListener\('pointerup', controller\.onPointerUp\);[\s\S]*window\.removeEventListener\('pointercancel', controller\.onPointerUp\);/,
  'image resize cleanup should remove pointer cancellation handlers together with the normal drag listeners'
);

assert.match(
  enhancedImageBlock,
  /toggleCaption\(\)\s*\{[\s\S]*updateCaptionVisibility\(\)[\s\S]*\}/,
  'caption toggle should update the existing DOM in place instead of recreating the image block'
);

assert.doesNotMatch(
  enhancedImageBlock,
  /toggleCaption\(\)\s*\{[\s\S]*this\.render\(\)[\s\S]*\}/,
  'caption toggle should not trigger a full image re-render that causes flicker and blur'
);

assert.match(
  imageBlockAttrsJs,
  /bindImageBlockAttrs\(controller, node\)\s*\{[\s\S]*extractAttachmentIdFromUrl\(nextSrc\)[\s\S]*controller\.dom\.dataset\.attachmentId[\s\S]*updateFilledImageState\(\)[\s\S]*\}/,
  'image updates should derive attachment identity and patch the filled state in place when the source already exists'
);

assert.match(
  imageBlockRenderersJs,
  /createButton\(\{[\s\S]*className:\s*'confirm'[\s\S]*title:\s*'插入图片链接'[\s\S]*\}\)/,
  'empty-state confirm action should be rendered as a real button with an accessible title'
);

assert.match(
  imageBlockRenderersJs,
  /image\.addEventListener\('load', \(\) => \{[\s\S]*controller\.applyImageLayout\(\);[\s\S]*controller\.scheduleLayoutRefresh\(\);[\s\S]*\}\);/,
  'image load should trigger an immediate and a deferred layout pass so pasted large images fit without refresh'
);

assert.match(
  imageBlockRenderersJs,
  /stage\.dataset\.attachmentId = controller\.dom\.dataset\.attachmentId[\s\S]*image\.dataset\.attachmentId = controller\.dom\.dataset\.attachmentId/,
  'rendered image blocks should expose attachment ids on DOM nodes for precise sidebar jump targeting'
);

assert.match(
  editorFactoryJs,
  /listenerCtx\)\.updated\(\(\) => \{[\s\S]*host\.scheduleImageLayoutRefreshBurst\?\.\(\);[\s\S]*\}\);/,
  'editor host should re-run image layout refresh bursts after document updates, including paste-driven image insertion'
);

assert.match(
  imageLayoutControllerJs,
  /if \(!image\.complete \|\| image\.naturalWidth <= 0\) \{[\s\S]*image\.dataset\.layoutPending[\s\S]*host\.scheduleImageLayoutRefreshBurst\?\.\(\[32, 96, 240, 480\]\);/,
  'image layout controller should keep retrying while pasted images are still loading so large images fit without a manual refresh'
);

assert.doesNotMatch(
  buildScript,
  /replace\(|Patch 1|Patch 2|Patch 3/,
  'milkdown bundle build should no longer patch generated output strings'
);

assert.match(
  componentsCss,
  /\.image-edit[\s\S]*grid-template-columns:\s*24px minmax\(0,\s*1fr\) auto;[\s\S]*padding:\s*10px 12px;/,
  'empty image insert shell should use a compact three-column layout'
);

assert.match(
  componentsCss,
  /\.confirm[\s\S]*min-width:\s*32px[\s\S]*padding:\s*0;/,
  'confirm action should render as a compact inline control instead of an oversized broken block'
);

assert.match(
  componentsCss,
  /\.confirm \.semantic-icon[\s\S]*width:\s*16px[\s\S]*height:\s*16px;/,
  'confirm action should render a compact local check icon instead of oversized text'
);

console.log('ok - image block upload, fit sizing, and modern proportional resize hooks are present');
