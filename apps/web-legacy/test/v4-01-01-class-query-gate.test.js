import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  scanClassQueries,
  evaluateClassQueries,
  EDITOR_CONTRACT_WHITELIST,
  KNOWN_V3_COUPLINGS
} from './helpers/class-query-gate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, '..');

// 配置自检：白名单与登记耦合条目必须字段齐全，便于后续人工复核白名单是否过宽。
for (const entry of EDITOR_CONTRACT_WHITELIST) {
  assert.ok(
    entry.className && Array.isArray(entry.domains) && entry.domains.length > 0,
    `编辑器白名单条目缺少字段: ${JSON.stringify(entry)}`
  );
}
for (const entry of KNOWN_V3_COUPLINGS) {
  assert.ok(
    entry.className && Array.isArray(entry.files) && entry.files.length > 0 && entry.decoupleTask && entry.note,
    `登记耦合条目缺少字段: ${JSON.stringify(entry)}`
  );
}

// 扫描 src/ 与 lib/ 的全部运行时代码（构建产物与探索目录不参与）。
const findings = scanClassQueries({
  roots: [path.join(webRoot, 'src'), path.join(webRoot, 'lib')],
  baseDir: webRoot
});

assert.ok(findings.length > 0, '扫描应至少找到一处 class selector 查询，请检查扫描根目录配置');

const { editorContract, registered, violations } = evaluateClassQueries(findings);

console.log(
  `v4-class-query-gate: ${findings.length} 处 class selector 查询 ` +
    `-> ${editorContract.length} 编辑器契约 / ${registered.length} 已登记 V3 耦合 / ${violations.length} 违规`
);

// 验收一：当前已登记耦合可解释 —— 不存在既非编辑器契约、也非已登记的 class 行为查询。
assert.equal(violations.length, 0, [
  '发现未登记、未白名单的视觉 class 行为查询（V4 禁止新增）:',
  ...violations.map(
    (v) => `  ${v.file}:${v.line} ${v.api}('${v.selector}') -> .${v.classes.join(' .')}`
  )
].join('\n'));

// 验收二：新耦合会使测试失败（端到端负向证明）。
// 在临时目录放入含新视觉 class 查询的文件，经 scan+evaluate 全链路应被判为违规；
// 编辑器契约 class（.ProseMirror）在契约域内仍被放行。
const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v4-class-gate-'));
try {
  fs.writeFileSync(
    path.join(probeDir, 'new-v4-feature.js'),
    'const card = document.querySelector(".v4-card-panel");\n'
  );
  const probe = evaluateClassQueries(scanClassQueries({ roots: [probeDir], baseDir: probeDir }));
  assert.deepEqual(
    probe.violations.map((v) => v.selector),
    ['.v4-card-panel'],
    '新耦合文件应触发违规，使门禁失败'
  );
} finally {
  fs.rmSync(probeDir, { recursive: true, force: true });
}

const synthetic = evaluateClassQueries([
  { file: 'lib/editor/milkdown/table/table-buttons.js', api: 'querySelector', selector: '.milkdown-table-block', classes: ['milkdown-table-block'], line: 1 },
  { file: 'lib/editor/image-block-resize.js', api: 'closest', selector: '.ProseMirror', classes: ['ProseMirror'], line: 1 },
  {
    file: 'lib/editor/milkdown/table/table-buttons.js',
    api: 'querySelector',
    selector: '.milkdown-table-block .new-visual-class',
    classes: ['milkdown-table-block', 'new-visual-class'],
    line: 1
  }
]);
assert.equal(synthetic.editorContract.length, 2, '编辑器契约 class 在契约域内应被放行');
assert.deepEqual(
  synthetic.violations.map((finding) => finding.selector),
  ['.milkdown-table-block .new-visual-class'],
  '命中一个编辑器契约 class 不得连带放行同一 selector 中的新视觉 class'
);

console.log('ok - V4 class 查询静态门禁：既有耦合可解释，新视觉 class 查询会被拦截');
