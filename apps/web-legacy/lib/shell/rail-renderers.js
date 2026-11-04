import { escapeHtml, escapeAttribute } from '../../src/app/formatting.js';
import { renderIcon } from '../icons/icon-map.js';

const FUNCTION_NAV_GROUPS = Object.freeze([
  {
    key: 'workbench',
    label: '工作台',
    items: [
      { key: 'home', label: '首页概览', icon: 'navOverview' },
      { key: 'materials', label: '全部资料', icon: 'navMaterials', moduleKey: 'materials', shortcut: '⌘1' },
      { key: 'favorites', label: '收藏夹', icon: 'navFavorites', placeholder: 'favorites' },
      { key: 'recycle', label: '回收站', icon: 'navRecycle', placeholder: 'recycle' }
    ]
  },
  {
    key: 'materials',
    label: '资料库',
    items: [
      { key: 'quick-note', label: '快速笔记', icon: 'navQuickNote', placeholder: 'quick-note' },
      { key: 'folder-management', label: '文件夹管理', icon: 'navFolders', placeholder: 'folder-management' },
      { key: 'tag-management', label: '标签管理', icon: 'navTags', placeholder: 'tag-management' },
      { key: 'attachment-library', label: '附件库', icon: 'navAttachments', placeholder: 'attachment-library' }
    ]
  },
  {
    key: 'knowledge',
    label: '知识库',
    items: [
      { key: 'knowledge-overview', label: '知识概览', icon: 'navKnowledge', moduleKey: 'knowledge' },
      { key: 'knowledge-items', label: '知识单元', icon: 'navKnowledgeItems', placeholder: 'knowledge-items' },
      { key: 'knowledge-links', label: '双向链接', icon: 'navKnowledgeLinks', placeholder: 'knowledge-links' }
    ]
  },
  {
    key: 'training',
    label: '训练场',
    items: [
      { key: 'training-overview', label: '训练概览', icon: 'navTraining', moduleKey: 'training' },
      { key: 'question-bank', label: '题库', icon: 'navQuestionBank', placeholder: 'question-bank' },
      { key: 'practice-plan', label: '练习计划', icon: 'navPractice', placeholder: 'practice-plan' },
      { key: 'training-review', label: '错题回顾', icon: 'navReview', placeholder: 'training-review' }
    ]
  },
  {
    key: 'learning',
    label: '学习档案',
    items: [
      { key: 'learning-overview', label: '学习档案', icon: 'navLearning', moduleKey: 'learning' },
      { key: 'mastery', label: '掌握度', icon: 'navMastery', placeholder: 'mastery' },
      { key: 'learning-curve', label: '学习曲线', icon: 'navLearningCurve', placeholder: 'learning-curve' }
    ]
  }
]);

export function renderModuleRail(items) {
  return items
    .map((item) => {
      const label = getRailLabel(item.key);

      return `
        <button
          type="button"
          class="rail-item"
          data-module-key="${escapeAttribute(item.key)}"
          data-active="${Boolean(item.active)}"
          aria-label="${escapeAttribute(label)}"
          title="${escapeAttribute(label)}"
        >
          <span class="rail-item-icon" aria-hidden="true">${renderRailIcon(item.key)}</span>
          <span class="rail-item-label">${escapeHtml(label)}</span>
        </button>
      `;
    })
    .join('');
}

export function getFunctionNavigationGroups() {
  return FUNCTION_NAV_GROUPS;
}

export function renderFunctionNavigation(activeDomain = 'materials') {
  const groups = FUNCTION_NAV_GROUPS.map((group) => `
    <section class="function-nav-group" data-nav-group="${escapeAttribute(group.key)}" aria-labelledby="function-nav-group-${escapeAttribute(group.key)}">
      <h2 class="function-nav-group-title" id="function-nav-group-${escapeAttribute(group.key)}">${escapeHtml(group.label)}</h2>
      <div class="function-nav-group-items">
        ${group.items.map((item) => renderFunctionNavigationItem(item, activeDomain)).join('')}
      </div>
    </section>
  `).join('');

  return `
    <div class="function-nav-scroll" data-ui-function-navigation-scroll>
      ${groups}
    </div>
    <div class="function-nav-footer" data-ui-function-navigation-footer>
      ${renderFunctionNavigationItem({
        key: 'create-space',
        label: '新建空间',
        icon: 'navCreateSpace',
        placeholder: 'create-space'
      }, activeDomain)}
    </div>
  `;
}

function renderFunctionNavigationItem(item, activeDomain) {
  const isActive = item.key === activeDomain || Boolean(item.moduleKey && item.moduleKey === activeDomain);
  const isPlaceholder = Boolean(item.placeholder);
  const label = isPlaceholder ? `${item.label}（即将开放）` : item.label;
  const dataAttributes = [
    `data-nav-item="${escapeAttribute(item.key)}"`,
    `data-active="${isActive}"`
  ];
  if (item.moduleKey) {
    dataAttributes.push(`data-module-key="${escapeAttribute(item.moduleKey)}"`);
  }
  if (item.placeholder) {
    dataAttributes.push(`data-nav-placeholder="${escapeAttribute(item.placeholder)}"`);
  }

  return `
    <button
      type="button"
      class="function-nav-item"
      ${dataAttributes.join(' ')}
      aria-label="${escapeAttribute(label)}"
      title="${escapeAttribute(label)}"
      ${isActive ? 'aria-current="page"' : ''}
      ${isPlaceholder ? 'aria-disabled="true"' : ''}
      ${isPlaceholder ? 'disabled' : ''}
    >
      <span class="function-nav-item-icon" aria-hidden="true">${renderIcon(item.icon, { className: 'function-nav-icon' })}</span>
      <span class="function-nav-item-label">${escapeHtml(item.label)}</span>
      ${item.shortcut ? `<kbd class="function-nav-shortcut">${escapeHtml(item.shortcut)}</kbd>` : ''}
    </button>
  `;
}

export function getRailLabel(key) {
  switch (key) {
    case 'materials':
      return '资料';
    case 'knowledge':
      return '知识';
    case 'training':
      return '训练';
    case 'learning':
      return '学习档案';
    // 保留旧入口的显示兼容，避免缓存或旧快照中的模块键渲染为空。
    case 'paper':
      return '题库';
    case 'ai':
      return 'AI 工作台';
    case 'task':
      return '任务';
    case 'review':
      return '复盘';
    case 'settings':
      return '设置';
    default:
      return key;
  }
}

export function renderRailIcon(key) {
  const iconNames = {
    materials: 'moduleMaterials',
    knowledge: 'moduleKnowledge',
    training: 'moduleTraining',
    learning: 'moduleLearning',
    paper: 'modulePaper',
    ai: 'moduleAi',
    task: 'moduleTask',
    review: 'moduleReview'
  };
  return iconNames[key] ? renderIcon(iconNames[key]) : '';
}
