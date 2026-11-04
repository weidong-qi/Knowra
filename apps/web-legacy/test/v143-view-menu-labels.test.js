import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const menuRenderersJs = fs.readFileSync(path.resolve(__dirname, '../lib/editor/menu-renderers.js'), 'utf8');

assert.match(
  menuRenderersJs,
  /data-editor-menu-toggle="view"[\s\S]*视图/,
  'view menu toggle should show a readable Chinese label instead of mojibake'
);

assert.match(
  menuRenderersJs,
  /阅读模式/,
  'view menu should show a readable Chinese label for read mode'
);

assert.match(
  menuRenderersJs,
  /编辑模式/,
  'view menu should show a readable Chinese label for edit mode'
);

assert.match(
  menuRenderersJs,
  /专注模式/,
  'view menu should show a readable Chinese label for focus mode'
);

assert.match(
  menuRenderersJs,
  /隐藏左侧目录区|显示左侧目录区/,
  'view menu should show readable left-sidebar toggle labels'
);

assert.match(
  menuRenderersJs,
  /隐藏右侧辅助区|显示右侧辅助区/,
  'view menu should show readable right-sidebar toggle labels'
);

assert.match(
  menuRenderersJs,
  /隐藏源码编辑器|显示源码编辑器/,
  'view menu should show readable source-editor toggle labels'
);

console.log('ok - V1.4.3 view menu labels remain readable');
