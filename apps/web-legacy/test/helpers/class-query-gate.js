import fs from 'node:fs';
import path from 'node:path';

/**
 * V4 静态门禁辅助：扫描非 bundle JavaScript 中的 class selector 查询。
 *
 * 背景（docs/已归档/前端/V4/01-现有前端遗留审计.md §4.3 与 P-02）：
 * 行为必须通过稳定 id / data-* / ARIA 绑定，不得依赖视觉 class。
 * 该模块为第三方编辑器内部契约提供最小白名单，并登记尚未解耦的 V3 耦合，
 * 使"既有耦合可解释、新耦合被门禁拦截"。
 *
 * 边界说明：
 * - 只扫描 src/ 与 lib/ 的运行时代码；app/、components/ 是未接入的 .jsx 探索目录（V4-08 删除/归档）。
 * - 构建产物 milkdown-bundle.js/.css/.map 不参与扫描。
 * - 只识别字符串字面量 selector；变量动态构造的 selector（如 sidebar-controller 的
 *   focusRequest.selector，值为 data-* 属性选择器）无法静态判定，但只允许 data-* 或 id，禁止 class。
 * - classList.add/remove/toggle 是对模块已持有元素的状态写入，不属于"按 class 查询"，
 *   不在本门禁范围；读取 class 状态的 classList.contains 也应避免，但当前仓库无此用法。
 */

const BUNDLE_BASENAMES = new Set([
  'milkdown-bundle.js',
  'milkdown-bundle.css',
  'milkdown-bundle.js.map',
  'milkdown-bundle.css.map'
]);

// 用负向断言捕获完整字符串实参：允许属性值内出现与定界符不同的引号，
// 例如 closest('.milkdown-table-block [data-role="row-drag-handle"]')。
const SELECTOR_QUERY_API = /(querySelector|querySelectorAll|closest|matches|getElementsByClassName)\s*\(\s*(['"`])((?:(?!\2)[^])*)\2/g;

/** 递归收集 roots 下的 *.js / *.mjs，跳过 node_modules、隐藏目录与构建产物。 */
export function collectJavaScriptFiles(roots) {
  const files = [];
  for (const root of roots) collect(root);
  return files.sort();

  function collect(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      if (entry.name.startsWith('.') && entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) collect(full);
      else if (/\.(js|mjs)$/.test(entry.name) && !BUNDLE_BASENAMES.has(entry.name)) files.push(full);
    }
  }
}

/** 从 selector 字符串提取 class token。先剥离属性选择器，避免把引号内的点号误判为 class。 */
export function extractClassTokens(selector) {
  const withoutAttributes = selector.replace(/\[[^\]]*\]/g, '');
  const tokens = [];
  const pattern = /\.([A-Za-z_][A-Za-z0-9_-]*)/g;
  let match;
  while ((match = pattern.exec(withoutAttributes)) !== null) tokens.push(match[1]);
  return [...new Set(tokens)];
}

/** 扫描 roots，返回 [{ file, line, api, selector, classes }]，file 为相对 baseDir 的路径。 */
export function scanClassQueries({ roots, baseDir }) {
  const findings = [];
  for (const file of collectJavaScriptFiles(roots)) {
    const content = fs.readFileSync(file, 'utf8');
    // Gate configuration uses repository-style paths on every platform.
    const rel = path.relative(baseDir, file).split(path.sep).join('/');
    let match;
    SELECTOR_QUERY_API.lastIndex = 0;
    while ((match = SELECTOR_QUERY_API.exec(content)) !== null) {
      const api = match[1];
      const arg = match[3];
      const classes = api === 'getElementsByClassName'
        ? [...new Set(arg.trim().split(/\s+/).filter(Boolean))]
        : extractClassTokens(arg);
      if (classes.length === 0) continue;
      findings.push({
        file: rel,
        line: content.slice(0, match.index).split('\n').length,
        api,
        selector: arg,
        classes
      });
    }
  }
  return findings;
}

/**
 * 编辑器内部契约白名单（最小）。className 只允许在其 domains 覆盖的文件内查询。
 * 选择器字符串中的每一个 class 都必须在当前文件所属契约域内逐项命中白名单。
 * 白名单收紧策略：逐条登记真实存在的插件结构 class；新 class 出现时须显式加条目供复核。
 */
export const EDITOR_CONTRACT_WHITELIST = [
  { className: 'milkdown-table-block', domains: ['lib/editor/milkdown/'], note: 'Milkdown 表格插件结构根 class' },
  { className: 'milkdown-image-block', domains: ['lib/editor/milkdown/'], note: 'Milkdown 图片插件结构根 class' },
  { className: 'milkdown-code-block-placeholder', domains: ['lib/editor/milkdown/'], note: 'Milkdown 代码块占位 class' },
  { className: 'button-group', domains: ['lib/editor/milkdown/table/'], note: '表格拖拽手柄内置按钮组 class' },
  { className: 'children', domains: ['lib/editor/milkdown/table/'], note: 'Milkdown 表格 <table class="children"> 结构 class（行列下标计算）' },
  { className: 'selectedCell', domains: ['lib/editor/milkdown/table/'], note: '表格选区 class' },
  { className: 'ProseMirror', domains: ['lib/editor/', 'src/controllers/editor/'], note: 'ProseMirror/Milkdown 编辑器宿主 class（宽度测量、导出读取编辑器 DOM 等能力）' }
];

/**
 * 已登记 V3 行为耦合：当前仍存在、须在指定任务中解耦的 class 查询。
 * 解耦完成并删除查询后，必须同步删除对应登记，使白名单/登记清单持续收紧。
 */
export const KNOWN_V3_COUPLINGS = [
  { className: 'top-bar-search-control', files: ['src/controllers/search-controller.js'], decoupleTask: 'V4-01-02', note: '全局搜索控件宿主；改为稳定 data-search-control' },
  { className: 'search-panel-host', files: ['src/controllers/search-controller.js'], decoupleTask: 'V4-01-02', note: '全局搜索面板宿主；改为稳定 data-search-panel-host' },
  { className: 'editor-context-submenu-group', files: ['src/controllers/editor/context-menu-controller.js'], decoupleTask: 'V4-01-02', note: '编辑器右键菜单分组；改为 data-editor-context-*' },
  { className: 'editor-context-submenu-trigger', files: ['src/controllers/editor/context-menu-controller.js'], decoupleTask: 'V4-01-02', note: '编辑器右键菜单触发器；改为 data-editor-context-*' },
  { className: 'editor-context-submenu', files: ['src/controllers/editor/context-menu-controller.js'], decoupleTask: 'V4-01-02', note: '编辑器右键菜单子菜单；改为 data-editor-context-*' },
  { className: 'editor-context-panel', files: ['src/controllers/editor/context-menu-controller.js'], decoupleTask: 'V4-01-02', note: '编辑器右键菜单面板；改为 data-editor-context-*' },
  { className: 'image-preset-button', files: ['lib/editor/image-block-renderers.js'], decoupleTask: 'V4-01-03', note: '图片预设按钮视觉 class 同时决定状态同步；改为 data-image-preset' }
];

/** file 是否落在任一 domain 内（按目录前缀匹配）。 */
export function isUnderDomain(file, domains) {
  return domains.some((domain) => file.startsWith(domain.endsWith('/') ? domain : `${domain}/`));
}

/**
 * 把扫描结果分为三类：
 * - editorContract：编辑器内部契约（命中白名单且位于契约域）；
 * - registered：已登记 V3 耦合（命中登记清单且文件匹配）；
 * - violations：既非编辑器契约也非已登记的新耦合。
 */
export function evaluateClassQueries(findings) {
  const editorContract = [];
  const registered = [];
  const violations = [];
  for (const finding of findings) {
    const whitelistedClasses = finding.classes.filter((className) => (
      EDITOR_CONTRACT_WHITELIST.some(
        (entry) => entry.className === className && isUnderDomain(finding.file, entry.domains)
      )
    ));
    if (whitelistedClasses.length === finding.classes.length) {
      editorContract.push({
        ...finding,
        matchedClass: whitelistedClasses[0],
        matchedClasses: whitelistedClasses
      });
      continue;
    }
    const registeredClasses = finding.classes.filter((className) => (
      KNOWN_V3_COUPLINGS.some(
        (entry) => entry.className === className && entry.files.includes(finding.file)
      )
    ));
    if (registeredClasses.length === finding.classes.length) {
      registered.push({
        ...finding,
        matchedClass: registeredClasses[0],
        matchedClasses: registeredClasses
      });
      continue;
    }
    violations.push(finding);
  }
  return { editorContract, registered, violations };
}
