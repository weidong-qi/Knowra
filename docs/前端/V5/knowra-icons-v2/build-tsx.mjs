// 把 icons-v2.mjs 生成为项目组件：apps/web-v5/src/components/icons/knowra/icons/*.tsx
// 用法：node docs/前端/V5/knowra-icons-v2/build-tsx.mjs
// 修改图标请改 icons-v2.mjs 后重新生成，不要手改生成的 tsx。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GROUPS } from './icons-v2.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const outDir = path.join(root, 'apps/web-v5/src/components/icons/knowra/icons');
const DEFAULT_STROKE = 1.6;

const toJsx = (svg) => svg
  .replace(/fill="\{A\}"/g, 'fill={ACCENT}')
  .replace(/stroke="\{A\}"/g, 'stroke={ACCENT}')
  .replace(/stroke-width=/g, 'strokeWidth=');

// 插入段落带 position 参数：below 为默认，above 把加号放到顶部并上下翻转文本线。
const PARAGRAPH_ADD = `export const ParagraphAddIcon = forwardRef<SVGSVGElement, KnowraIconProps & { position?: "above" | "below" }>(
  function ParagraphAddIcon({ position = "below", ...props }, ref) {
    return <IconBase ref={ref} {...props}>
      {position === "above"
        ? <path d="M4 18h16M4 12h10M4 6h5M17 3v6M14 6h6" />
        : <path d="M4 6h16M4 12h10M4 18h5M17 15v6M14 18h6" />}
    </IconBase>;
  }
);
`;

for (const [id, , items] of GROUPS) {
  const usesAccent = items.some(([, , svg]) => svg.includes('{A}'));
  const hasParagraph = items.some(([n]) => n === 'ParagraphAddIcon');
  let out = '';
  if (hasParagraph) out += 'import { forwardRef } from "react";\n';
  out += usesAccent ? 'import { ACCENT } from "../IconBase";\n' : '';
  out += hasParagraph ? 'import { IconBase } from "../IconBase";\n' : '';
  out += 'import { createIcon } from "../createIcon";\n';
  if (hasParagraph) out += 'import type { KnowraIconProps } from "../types";\n';
  out += '\n';
  out += items.map(([name, , svg, sw]) => {
    if (name === 'ParagraphAddIcon') return PARAGRAPH_ADD;
    const extra = sw && sw !== DEFAULT_STROKE ? `, ${sw}` : '';
    return `export const ${name} = createIcon("${name}", (\n  <>\n    ${toJsx(svg)}\n  </>\n)${extra});\n`;
  }).join('\n');
  fs.writeFileSync(path.join(outDir, `${id}.tsx`), out);
  console.log(`${id}.tsx: ${items.length}`);
}
