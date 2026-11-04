import { escapeAttribute, escapeHtml } from '../../src/app/formatting.js';

export const WORK_DOMAIN_DEFINITIONS = Object.freeze([
  { key: 'materials', index: '01', label: '资料', english: 'MATERIALS' },
  { key: 'knowledge', index: '02', label: '知识', english: 'KNOWLEDGE' },
  { key: 'training', index: '03', label: '训练', english: 'TRAINING' },
  { key: 'learning', index: '04', label: '学习档案', english: 'LEARNING' }
]);

export const KNOWLEDGE_DOMAIN_VIEWS = Object.freeze([
  { key: 'overview', label: '概览' },
  { key: 'items', label: '知识单元' },
  { key: 'objectives', label: '学习目标' },
  { key: 'review', label: '审核队列' }
]);

export const TRAINING_DOMAIN_VIEWS = Object.freeze([
  { key: 'overview', label: '概览' },
  { key: 'questions', label: '题目库' },
  { key: 'editor', label: '题目编辑' },
  { key: 'profiles', label: '考试场景' }
]);

export function getWorkDomainDefinition(key) {
  return WORK_DOMAIN_DEFINITIONS.find((domain) => domain.key === key) ?? WORK_DOMAIN_DEFINITIONS[0];
}

export function renderWorkDomainShell({ domain, view, body, meta = '' } = {}) {
  const definition = getWorkDomainDefinition(domain);
  const views = domain === 'knowledge' ? KNOWLEDGE_DOMAIN_VIEWS : TRAINING_DOMAIN_VIEWS;
  return `<div class="work-domain-shell" data-work-domain="${escapeAttribute(definition.key)}">
    <header class="work-domain-header">
      <div class="work-domain-heading">
        <span class="work-domain-index">${escapeHtml(definition.index)}</span>
        <div><h1>${escapeHtml(definition.label)}</h1><span>${escapeHtml(definition.english)}</span></div>
      </div>
      <div class="work-domain-meta">${meta}</div>
    </header>
    <nav class="work-domain-nav" aria-label="${escapeAttribute(`${definition.label}工作域页面`)}">
      ${views.map((item) => renderDomainViewButton(item, view, domain)).join('')}
    </nav>
    <div class="work-domain-body">${body}</div>
  </div>`;
}

export function renderDomainViewButton(item, activeView, domain) {
  return `<button type="button" class="work-domain-nav-button" data-work-domain-view="${escapeAttribute(item.key)}" data-active="${String(activeView === item.key)}" data-work-domain-target="${escapeAttribute(domain)}">${escapeHtml(item.label)}</button>`;
}

export function renderWorkDomainLoading(label = '正在加载工作域数据…') {
  return `<div class="work-domain-state work-domain-state-loading" role="status"><span class="state-marker" aria-hidden="true"></span><strong>${escapeHtml(label)}</strong></div>`;
}

export function renderWorkDomainError(message = '工作域数据加载失败') {
  return `<div class="work-domain-state work-domain-state-error" role="alert"><strong>加载失败</strong><span>${escapeHtml(message)}</span><small>请重试，或返回资料继续工作。</small></div>`;
}

export function renderWorkDomainEmpty(title, message, action = '') {
  return `<div class="work-domain-state work-domain-state-empty"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span>${action}</div>`;
}

export function renderStatusBadge(status, labels = {}) {
  const label = labels[status] ?? status ?? '未设置';
  return `<span class="workspace-status-badge" data-status="${escapeAttribute(status ?? 'unset')}">${escapeHtml(label)}</span>`;
}

export function renderCountLabel(count, label) {
  return `<span class="workspace-count"><strong>${escapeHtml(String(count ?? 0))}</strong><small>${escapeHtml(label)}</small></span>`;
}
