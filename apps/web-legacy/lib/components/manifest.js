import * as components from './index.js';

/**
 * 组件清单（正式代码组件库的核心数据）。
 *
 * 每一条目描述一个可复用组件：分组、用途、参数、样例数据与预览渲染。
 * Agent/开发者据此查询组件的签名与用法，再从 `./index.js` 统一 import。
 *
 * 约束：preview 一律通过 `components.<name>` 调用组件——
 * 若某组件未在 index.js 导出，本文件加载即报错，强制清单与目录保持同步。
 *
 * @typedef {Object} ComponentEntry
 * @property {string} name   组件函数名（与 index.js 导出一致）
 * @property {string} group  所属分组
 * @property {string} doc    用途说明（供 Agent 阅读）
 * @property {string} props  参数说明
 * @property {Object} sample 样例数据（预览渲染时传入）
 * @property {(sample: Object) => string} preview 返回组件的 HTML 渲染
 */

/** @type {ComponentEntry[]} */
export const componentManifest = [
  // ── 基础 ──────────────────────────────────────────────
  {
    name: 'renderIcon',
    group: '基础',
    doc: '渲染 InkGrid 语义图标。传语义名即可，图标路径由 icon-map 统一维护，避免散落硬编码资源路径。',
    props: 'name: string, { className?: string, data?: { [key]: string } }',
    sample: ['search', 'folder', 'noteMarkdown', 'create', 'more', 'settings'],
    preview: (names) => names
      .map((n) => `<span class="catalog-icon-box">${components.renderIcon(n, { className: 'catalog-icon' })}<span class="catalog-icon-name">${n}</span></span>`)
      .join('')
  },

  // ── 外壳与导航 ────────────────────────────────────────
  {
    name: 'renderModuleRail',
    group: '外壳与导航',
    doc: '渲染左侧模块导航 rail（知识库/训练场/学习档案等）。',
    props: 'items: Array<{ key: string, active?: boolean }>',
    sample: [
      { key: 'materials', active: true },
      { key: 'knowledge', active: false },
      { key: 'training', active: false },
      { key: 'learning', active: false }
    ],
    preview: (items) => components.renderModuleRail(items)
  },
  {
    name: 'renderFunctionNavigation',
    group: '外壳与导航',
    doc: '渲染当前模块的功能导航分组（工作台/资料库/知识库/训练场/学习档案）。',
    props: 'activeDomain?: string（当前激活模块 key）',
    sample: 'materials',
    preview: (domain) => components.renderFunctionNavigation(domain)
  },
  {
    name: 'renderNavigationSection',
    group: '外壳与导航',
    doc: '渲染侧栏一个可折叠分节（如收藏夹/最近/回收站），children 为预渲染的子节点。',
    props: '{ key, label, count, children, open, isDropTarget? }',
    sample: {
      key: 'favorites',
      label: '收藏夹',
      count: '3',
      open: true,
      children: components.renderNoteNode({
        note: { id: 'n1', title: 'InkGrid 设计语言', favorite: true },
        level: 1
      }) + components.renderNoteNode({
        note: { id: 'n2', title: '组件库规范', favorite: true },
        level: 1
      })
    },
    preview: (s) => components.renderNavigationSection(s)
  },
  {
    name: 'renderFolderIcon',
    group: '外壳与导航',
    doc: '渲染文件夹折叠/展开图标。',
    props: 'open: boolean',
    sample: true,
    preview: (open) => components.renderFolderIcon(open)
  },
  {
    name: 'renderNoteIcon',
    group: '外壳与导航',
    doc: '按资料类型渲染笔记图标（markdown/pdf/resource/manual）。',
    props: "iconKind?: 'markdown' | 'pdf' | 'resource' | 'manual'",
    sample: 'markdown',
    preview: (kind) => components.renderNoteIcon(kind)
  },
  {
    name: 'renderContextMenuItems',
    group: '外壳与导航',
    doc: '渲染通用右键菜单项列表，支持 divider 分隔线。',
    props: 'items: Array<{ type?: "divider", action: string, label: string }>',
    sample: [
      { type: 'divider' },
      { action: 'open', label: '打开' },
      { action: 'favorite', label: '收藏' },
      { action: 'delete', label: '删除' }
    ],
    preview: (items) => components.renderContextMenuItems(items)
  },
  {
    name: 'renderSectionMenuItems',
    group: '外壳与导航',
    doc: '渲染侧栏分节显隐开关菜单项。',
    props: '{ items?, sections: { [key]: boolean } }',
    sample: { sections: { favorites: true, recent: true, recycle: false } },
    preview: (s) => components.renderSectionMenuItems(s)
  },

  // ── 编辑器 ────────────────────────────────────────────
  {
    name: 'renderEmptyNoteTabs',
    group: '编辑器',
    doc: '渲染无打开资料时的空 Tab 占位。',
    props: '无参数',
    sample: {},
    preview: () => components.renderEmptyNoteTabs()
  },
  {
    name: 'renderNoteTabs',
    group: '编辑器',
    doc: '渲染文档 Tab 行，含激活态、脏保存态（有未保存修改方点）、拖拽态与长标题省略。',
    props: '{ notes, selectedNoteId, saveState, tabDragState, foldersById, buildNoteTabPath }',
    sample: {
      notes: [
        { id: 'n1', title: 'InkGrid 设计语言', folderId: 'f1' },
        { id: 'n2', title: '一份标题非常长的资料用于验证 Tab 溢出时的省略展示效果如何呈现', folderId: 'f2' },
        { id: 'n3', title: '组件库规范', folderId: 'f1' }
      ],
      selectedNoteId: 'n1',
      saveState: 'saved',
      tabDragState: {},
      foldersById: { f1: { id: 'f1', title: '设计' }, f2: { id: 'f2', title: '规范文档' } },
      buildNoteTabPath: (note, folders) => {
        const folder = folders[note.folderId];
        return folder ? `${folder.title} / ${note.title}` : note.title;
      }
    },
    preview: (s) => components.renderNoteTabs(s)
  },

  // ── 侧边栏 ────────────────────────────────────────────
  {
    name: 'renderTagPills',
    group: '侧边栏',
    doc: '渲染只读标签胶囊列表。',
    props: 'tags: Array<{ id, name, color }>',
    sample: [
      { id: 't1', name: '设计系统', color: 'blue' },
      { id: 't2', name: '前端重构', color: 'amber' },
      { id: 't3', name: '验收', color: 'green' }
    ],
    preview: (tags) => components.renderTagPills(tags)
  },
  {
    name: 'renderAssignedTagPills',
    group: '侧边栏',
    doc: '渲染当前笔记已分配标签的胶囊，带移除按钮。',
    props: 'tags: Array<{ id, name, color }>',
    sample: [
      { id: 't1', name: '设计系统', color: 'blue' },
      { id: 't2', name: '验收', color: 'green' }
    ],
    preview: (tags) => components.renderAssignedTagPills(tags)
  },
  {
    name: 'renderAvailableTagPills',
    group: '侧边栏',
    doc: '渲染可添加的候选标签胶囊，带添加按钮。',
    props: 'tags: Array<{ id, name, color }>',
    sample: [
      { id: 't3', name: '前端重构', color: 'amber' },
      { id: 't4', name: '待办', color: 'rose' }
    ],
    preview: (tags) => components.renderAvailableTagPills(tags)
  },
  {
    name: 'renderLinkedNotes',
    group: '侧边栏',
    doc: '渲染双向链接的笔记列表。',
    props: 'linkedNotes: Array<{ id, title, summary? }>',
    sample: [
      { id: 'n1', title: 'InkGrid 设计语言', summary: 'Token 与组件规范总览' },
      { id: 'n2', title: '迁移里程碑', summary: 'M1 Token 与资源' }
    ],
    preview: (notes) => components.renderLinkedNotes(notes)
  },
  {
    name: 'renderAttachments',
    group: '侧边栏',
    doc: '渲染笔记附件列表，含状态标签。',
    props: 'attachments: Array<{ id, fileName, status, isReferenced? }>',
    sample: [
      { id: 'a1', fileName: 'InkGrid-规范.pdf', status: 'referenced', isReferenced: true },
      { id: 'a2', fileName: '原型截图.png', status: 'pending', isReferenced: false }
    ],
    preview: (attachments) => components.renderAttachments(attachments)
  },

  // ── 资料库索引 ────────────────────────────────────────
  {
    name: 'renderLibraryPagination',
    group: '资料库索引',
    doc: '渲染资料库分页控件（上一页/页码/下一页）。',
    props: '{ page, pageSize, totalItems, totalPages }',
    sample: { page: 1, pageSize: 10, totalItems: 23, totalPages: 3 },
    preview: (p) => components.renderLibraryPagination(p)
  },

  // ── 主页与工作域 ──────────────────────────────────────
  {
    name: 'renderCountLabel',
    group: '主页与工作域',
    doc: '渲染数字 + 标签的计数块。',
    props: 'count: number, label: string',
    sample: { count: 128, label: '条笔记' },
    preview: (s) => components.renderCountLabel(s.count, s.label)
  },
  {
    name: 'renderHomeLoading',
    group: '主页与工作域',
    doc: '渲染主页加载占位。',
    props: '无参数',
    sample: {},
    preview: () => components.renderHomeLoading()
  },

  // ── 搜索 ──────────────────────────────────────────────
  {
    name: 'renderSearchTagOption',
    group: '搜索',
    doc: '渲染搜索筛选标签候选选项。',
    props: 'tag: { id, name, color }, selected: boolean',
    sample: { tag: { id: 't1', name: '设计系统', color: 'blue' }, selected: true },
    preview: (s) => components.renderSearchTagOption(s.tag, s.selected)
  },
  {
    name: 'renderSelectedSearchChips',
    group: '搜索',
    doc: '渲染已选搜索标签胶囊，超出 inlineLimit 折叠为 +N。',
    props: 'selectedTags: Array<{ id, name, color }>, { inlineLimit? }',
    sample: [
      { id: 't1', name: '设计系统', color: 'blue' },
      { id: 't2', name: '验收', color: 'green' },
      { id: 't3', name: '前端重构', color: 'amber' }
    ],
    preview: (tags) => components.renderSelectedSearchChips(tags, { inlineLimit: 2 })
  },

  // ── 状态与标签 ────────────────────────────────────────
  {
    name: 'renderStatusIndicators',
    group: '状态与标签',
    doc: '渲染底部状态栏的保存状态与消息提示。',
    props: '{ statusMessage: string, saveState?: string }',
    sample: { statusMessage: '已保存', saveState: 'saved' },
    preview: (s) => components.renderStatusIndicators(s)
  },
  {
    name: 'renderTagList',
    group: '状态与标签',
    doc: '渲染标签列表（通用标签集合）。',
    props: 'tags: Array<{ id, name, color }>',
    sample: [
      { id: 't1', name: '设计系统', color: 'blue' },
      { id: 't2', name: '验收', color: 'green' }
    ],
    preview: (tags) => components.renderTagList(tags)
  }
];
