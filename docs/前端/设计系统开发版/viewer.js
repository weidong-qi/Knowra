import { marked } from '/vendor/marked.esm.js';

const sections = [
  ['overview', '概览', 'home'],
  ['color', '颜色', 'palette'],
  ['type', '字体', 'type'],
  ['spacing', '间距', 'spacing'],
  ['radius', '圆角', 'radius'],
  ['shadow', '阴影', 'shadow'],
  ['size', '尺寸', 'size'],
  ['components', '组件', 'components'],
  ['assets', '资源', 'assets']
];
const iconPaths = {
  home: '<path d="m3 10 9-7 9 7v10H3zM9 20v-7h6v7"/>',
  palette:
    '<circle cx="12" cy="12" r="9"/><circle cx="8" cy="9" r="1"/><circle cx="13" cy="6" r="1"/><circle cx="17" cy="10" r="1"/><path d="M12 21c6-7-7-3-2-9"/>',
  type: '<path d="M3 5h14M10 5v15m-4 0h8m2-10h7m-4 0v10"/>',
  spacing: '<path d="M4 3v18M20 3v18M4 12h16m-12-4-4 4 4 4m8-8 4 4-4 4"/>',
  radius: '<path d="M5 20V9a5 5 0 0 1 5-5h10M4 4h1m15 16h1"/>',
  shadow: '<rect x="4" y="4" width="13" height="13" rx="2"/><path d="M8 20h10a2 2 0 0 0 2-2V8"/>',
  size: '<path d="M4 9V4h5M15 20h5v-5M4 4l6 6m10 10-6-6"/>',
  components:
    '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  assets:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/>'
};
const esc = (value = '') =>
  String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const main = document.querySelector('#main');
const themeSelect = document.querySelector('#theme');
const search = document.querySelector('#search');
const readText = async path => {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`无法读取 ${path}`);
  return response.text();
};
let theme = localStorage.getItem('knowra-design-theme') || 'light';
let tokens;
let manifest;
let overview;
let query = '';
let renderId = 0;

function matches(item) {
  return !query || `${item.name} ${item.usage || ''} ${item.summary || ''}`.toLowerCase().includes(query);
}
function heading(title, subtitle = '') {
  return `<header class="page-header"><h1>${esc(title)}</h1>${subtitle ? `<p class="subtitle">${esc(subtitle)}</p>` : ''}</header>`;
}
function frame(name, height, lazy = true) {
  return `<iframe title="${esc(name)} 组件预览" src="/previews/${encodeURIComponent(name)}.html?theme=${theme}" height="${height}" ${lazy ? 'loading="lazy"' : ''}></iframe>`;
}
function themedValues(section) {
  const themes = tokens.color.themes;
  const rows = tokens[section].tokens.filter(matches);
  return `<div class="table-wrap"><table><thead><tr><th>名称</th>${themes.map(t => `<th>${esc(t.name)}</th>`).join('')}</tr></thead><tbody>${rows
    .map(
      token =>
        `<tr><td>${esc(token.name)}<span class="usage">${esc(token.usage)}</span></td>${themes
          .map(t => {
            const value = typeof token.value === 'object' ? (token.value[t.id] ?? token.value.light) : token.value;
            if (section === 'color')
              return `<td><button class="swatch" data-copy="${esc(value)}" aria-label="复制 ${esc(token.name)} ${esc(t.name)} ${esc(value)}" style="background:${esc(value)}"></button><span class="token-value">${esc(value)}</span></td>`;
            return `<td data-theme="${t.id}"><button class="shadow-sample" data-copy="${esc(value)}" aria-label="复制 ${esc(token.name)} ${esc(t.name)}" style="box-shadow:${esc(value)}"></button><span class="token-value">${esc(value)}</span></td>`;
          })
          .join('')}</tr>`
    )
    .join('')}</tbody></table></div>`;
}
function scalarValues(section) {
  return `<table><thead><tr><th>名称</th><th>数值与预览</th><th>使用说明</th></tr></thead><tbody>${tokens[
    section
  ].tokens
    .filter(matches)
    .map(
      t =>
        `<tr><td>${esc(t.name)}</td><td><code>${esc(t.value)}</code>${section === 'radius' ? `<div class="radius-sample" style="border-radius:${esc(t.value)};margin-top:10px"></div>` : `<div class="size-sample" style="width:${esc(t.value)}"></div>`}</td><td>${esc(t.usage)}</td></tr>`
    )
    .join('')}</tbody></table>`;
}
async function componentContent() {
  const components = manifest.components.filter(matches);
  return (
    (
      await Promise.all(
        components.map(async component => {
          const name = component.name;
          const [html, readme] = await Promise.all([
            readText(`/project/components/${name}/preview.html`),
            readText(`/project/components/${name}/README.md`)
          ]);
          const baseHeight = Number(html.match(/@dsCard[^>]*height=(\d+)/)?.[1] || 180);
          const height = ['Dialog', 'Menu', 'Select', 'Tooltip'].includes(name)
            ? Math.max(baseHeight + 60, 280)
            : Math.max(baseHeight + 40, 120);
          return `<article class="component"><div class="component-heading"><h2>${esc(name)}</h2><a href="/project/components/${name}/preview.html" target="_blank" rel="noreferrer">查看源文件</a></div><p class="component-summary">${esc(component.summary)}</p>${frame(name, height)}<details><summary>组件使用说明</summary><div class="markdown">${marked.parse(readme)}</div></details></article>`;
        })
      )
    ).join('') || '<p class="empty">没有匹配的组件。</p>'
  );
}
function assetContent() {
  return manifest.assetGroups
    .map(group => {
      const files = group.files.filter(item => !query || item.path.toLowerCase().includes(query));
      return `<h2 class="asset-heading">${esc(group.name)} <span class="usage">${files.length}个 SVG</span></h2><div class="asset-grid ${group.name === 'Logos' ? 'logos' : ''}">${files.map(item => `<a class="asset-tile" href="/project/${esc(item.path)}" download><img src="/project/${esc(item.path)}" alt="${esc(item.path.split('/').pop())}" loading="lazy"><span>${esc(item.path.split('/').pop())}</span></a>`).join('')}</div>`;
    })
    .join('');
}
async function render() {
  const currentId = ++renderId;
  const section = location.hash.slice(1) || 'overview';
  const title = sections.find(s => s[0] === section)?.[1] || '概览';
  document.querySelectorAll('.nav-item').forEach(button => {
    if (button.dataset.section === section) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  let content;
  if (section === 'components') {
    content = heading(title, '保留原始组件代码，使用本地 React 18 运行。') + (await componentContent());
  } else if (section === 'color' || section === 'shadow') {
    content =
      heading(title, '点击预览可复制对应 CSS 值。现橙浅色和深色的数值来自 tokens.json。') + themedValues(section);
  } else if (['spacing', 'radius', 'size'].includes(section)) {
    content = heading(title) + `<div class="page-content">${scalarValues(section)}</div>`;
  } else if (section === 'type') {
    content =
      heading(title) +
      `<div class="page-content">${tokens.type.groups
        .map(
          group =>
            `<h2 class="asset-heading">${esc(group.name)}</h2><table><tbody>${group.styles
              .filter(matches)
              .map(
                style =>
                  `<tr><td>${esc(style.name)}<span class="usage">${esc(style.usage)}</span></td><td><div style="font-family:var(--font-${group.family});font-size:${esc(style.fontSize)};font-weight:${Number(style.fontWeight)};line-height:${Number(style.lineHeight)};letter-spacing:${esc(style.letterSpacing || 'normal')}">${esc(style.sample || '知境 Knowra')}</div><span class="token-value">${esc(style.fontSize)} / ${esc(style.lineHeight)} · ${esc(style.fontWeight)}</span></td></tr>`
              )
              .join('')}</tbody></table>`
        )
        .join('')}</div>`;
  } else if (section === 'assets') {
    content =
      heading(title, '品牌标记与图标按原始目录保存在本地，点击可下载。') +
      `<div class="page-content">${assetContent()}</div>`;
  } else {
    content =
      frame('Cover', 280, false).replace('<iframe ', '<iframe class="cover" ') +
      `<div class="page-content markdown">${marked.parse(overview)}</div>`;
  }
  if (currentId !== renderId) return;
  main.innerHTML = `<section class="page">${content}</section>`;
  main.scrollTop = 0;
}

try {
  [tokens, manifest, overview] = await Promise.all([
    readText('/project/tokens.json').then(JSON.parse),
    readText('/catalog.json').then(JSON.parse),
    readText('/project/README.md')
  ]);
  if (!tokens.color.themes.some(t => t.id === theme)) theme = 'light';
  localStorage.setItem('knowra-design-theme', theme);
  document.documentElement.dataset.theme = theme;
  themeSelect.innerHTML = tokens.color.themes.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
  themeSelect.value = theme;
  document.querySelector('#nav').innerHTML = sections
    .map(
      ([id, name, icon]) =>
        `<button class="nav-item" data-section="${id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[icon]}</svg>${name}</button>`
    )
    .join('');
  document.querySelector('#nav').addEventListener('click', event => {
    const button = event.target.closest('[data-section]');
    if (button) location.hash = button.dataset.section;
  });
  themeSelect.addEventListener('change', () => {
    theme = themeSelect.value;
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('knowra-design-theme', theme);
    render();
  });
  search.addEventListener('input', () => {
    query = search.value.trim().toLowerCase();
    render();
  });
  main.addEventListener('click', async event => {
    const button = event.target.closest('[data-copy]');
    if (!button) return;
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      const notice = document.querySelector('#notice');
      notice.textContent = '已复制 CSS 值';
      notice.style.display = 'block';
      setTimeout(() => {
        notice.style.display = 'none';
      }, 1600);
    } catch {
      button.title = button.dataset.copy;
    }
  });
  addEventListener('hashchange', render);
  await render();
  if (document.documentElement.dataset.liveReload === 'true') {
    const events = new EventSource('/__events');
    events.addEventListener('reload', () => location.reload());
  }
} catch (error) {
  main.innerHTML = `<section class="page empty">${esc(error.message)}。请使用 npm run dev 启动预览。</section>`;
}
