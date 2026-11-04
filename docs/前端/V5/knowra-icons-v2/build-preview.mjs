// 生成 preview.html：新旧图标并排对比。用法：node build-preview.mjs
// 旧图标直接从 apps/web-v5/src/components/icons/knowra/icons/*.tsx 解析，保证对比的是线上真实版本。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GROUPS } from './icons-v2.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const oldDir = path.join(root, 'apps/web-v5/src/components/icons/knowra/icons');
const OLD_ACCENT = '#2563eb';

const oldIcons = {};
for (const f of fs.readdirSync(oldDir)) {
  const src = fs.readFileSync(path.join(oldDir, f), 'utf8');
  const re = /export const (\w+) = createIcon\("\w+", \(\s*<>\s*([\s\S]*?)\s*<\/>\s*\)\);/g;
  let m;
  while ((m = re.exec(src))) {
    oldIcons[m[1]] = m[2]
      .replace(/stroke=\{ACCENT\}/g, `stroke="${OLD_ACCENT}"`)
      .replace(/fill=\{ACCENT\}/g, `fill="${OLD_ACCENT}"`)
      .replace(/strokeWidth=/g, 'stroke-width=');
  }
}
oldIcons.ParagraphAddIcon = `<path d="M5 5h8a4 4 0 0 1 0 8H9V5M9 5v14"/><path d="M16 17h5M18.5 14.5v5" stroke="${OLD_ACCENT}"/>`;

// 新增图标在旧版中不存在，预览里旧版一栏留空
// 旧图标代码已被 V2 替换，解析不到的图标在预览里旧版一栏留空（该对比仅对历史版本有意义）。
for (const n of GROUPS.flatMap(([, , items]) => items.map((i) => i[0]))) oldIcons[n] ??= '';
const names = GROUPS.flatMap(([, , items]) => items.map((i) => i[0]));
console.log(`ok: ${names.length} icons`);

const data = GROUPS.map(([id, zh, items]) => ({
  id, zh,
  items: items.map(([n, label, svg, sw]) => ({ n, label, svg: svg.replaceAll('{A}', 'var(--accent)'), sw: sw || 1.6, old: oldIcons[n] })),
}));

const html = fs.readFileSync(path.join(here, 'preview.template.html'), 'utf8')
  .replace('/*__DATA__*/[]', JSON.stringify(data));
fs.writeFileSync(path.join(here, 'preview.html'), html);
console.log('preview.html written');
