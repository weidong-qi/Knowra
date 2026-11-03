const views = [...document.querySelectorAll('[data-screen]')];
const railItems = [...document.querySelectorAll('.rail-item[data-view]')];
const workspace = document.querySelector('.workspace');
const screenStatus = document.querySelector('#screenStatus');
const titles = { home: '主页', library: '资料索引', editor: '资料编辑器' };

function showView(name) {
  views.forEach((view) => view.classList.toggle('is-active', view.dataset.screen === name));
  railItems.forEach((item) => item.classList.toggle('is-active', item.dataset.view === name));
  screenStatus.textContent = titles[name] || name;
  workspace.scrollTop = 0;
  closeMenus();
  closeSearch();
}

document.addEventListener('click', (event) => {
  const viewTarget = event.target.closest('[data-view]');
  if (viewTarget && !viewTarget.disabled) showView(viewTarget.dataset.view);
});

document.querySelectorAll('.task-list li > button').forEach((button) => {
  button.addEventListener('click', () => {
    const item = button.closest('li');
    item.classList.toggle('is-done');
    button.innerHTML = item.classList.contains('is-done') ? '<i class="ri-check-line"></i>' : '';
  });
});

const globalSearch = document.querySelector('#globalSearch');
const searchOverlay = document.querySelector('#searchOverlay');
const overlaySearch = document.querySelector('#overlaySearch');

function openSearch(value = '') {
  searchOverlay.hidden = false;
  overlaySearch.value = value;
  requestAnimationFrame(() => overlaySearch.focus());
}

function closeSearch() {
  searchOverlay.hidden = true;
}

globalSearch.addEventListener('focus', () => openSearch(globalSearch.value));
globalSearch.addEventListener('input', () => openSearch(globalSearch.value));
searchOverlay.addEventListener('click', (event) => { if (event.target === searchOverlay) closeSearch(); });

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    openSearch();
  }
  if (event.key === 'Escape') {
    closeSearch();
    closeDialog();
    closeMenus();
  }
});

function closeMenus() {
  document.querySelectorAll('.menu-popover').forEach((menu) => menu.classList.remove('is-open'));
  document.querySelectorAll('.menu-trigger').forEach((trigger) => trigger.setAttribute('aria-expanded', 'false'));
}

document.querySelectorAll('.menu-trigger').forEach((trigger) => {
  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    const menu = trigger.parentElement.querySelector('.menu-popover') || document.querySelector('.filter-bar .menu-popover');
    if (!menu) return;
    const open = !menu.classList.contains('is-open');
    closeMenus();
    menu.classList.toggle('is-open', open);
    trigger.setAttribute('aria-expanded', String(open));
  });
});
document.addEventListener('click', (event) => { if (!event.target.closest('.menu-popover')) closeMenus(); });

const dialogOverlay = document.querySelector('#dialogOverlay');
const dialogDescription = document.querySelector('#dialogDescription');
const toast = document.querySelector('#toast');

function openDeleteDialog(title = '所选资料') {
  dialogDescription.textContent = `「${title}」将移入回收站，30 天后自动清除。已建立的知识关联将保留。`;
  dialogOverlay.hidden = false;
  requestAnimationFrame(() => document.querySelector('.dialog-cancel').focus());
}

function closeDialog() { dialogOverlay.hidden = true; }
document.querySelector('#deleteDocument').addEventListener('click', () => openDeleteDialog(document.querySelector('#inspectorTitle').textContent));
document.querySelector('#bulkDelete').addEventListener('click', () => openDeleteDialog('回收站中的全部资料'));
document.querySelector('.dialog-close').addEventListener('click', closeDialog);
document.querySelector('.dialog-cancel').addEventListener('click', closeDialog);
dialogOverlay.addEventListener('click', (event) => { if (event.target === dialogOverlay) closeDialog(); });
document.querySelector('.dialog-confirm').addEventListener('click', () => {
  closeDialog();
  toast.classList.add('is-visible');
  setTimeout(() => toast.classList.remove('is-visible'), 1800);
});

const documentRows = [...document.querySelectorAll('.document-row')];
const inspectorTitle = document.querySelector('#inspectorTitle');
documentRows.forEach((row) => {
  row.addEventListener('click', () => {
    documentRows.forEach((item) => item.classList.remove('is-selected'));
    row.classList.add('is-selected');
    inspectorTitle.textContent = row.dataset.title;
  });
});

const libraryFilter = document.querySelector('#libraryFilter');
libraryFilter.addEventListener('input', () => {
  const query = libraryFilter.value.trim().toLowerCase();
  let visible = 0;
  documentRows.forEach((row) => {
    const match = row.textContent.toLowerCase().includes(query);
    row.hidden = !match;
    if (match) visible += 1;
  });
  if (!visible && query) renderState('empty', `没有找到与“${libraryFilter.value}”相关的资料。`);
  else renderState('default');
});

const documentList = document.querySelector('#documentList');
const statePanel = document.querySelector('#statePanel');

function renderState(state, customMessage = '') {
  if (state === 'default') {
    documentList.hidden = false;
    statePanel.hidden = true;
    return;
  }
  showView('library');
  documentList.hidden = true;
  statePanel.hidden = false;
  const states = {
    loading: `<div class="state-copy"><span class="pulse" aria-label="加载中"><span></span><span></span><span></span></span><strong>正在整理资料索引</strong><p>同步元数据与学习状态，请稍候…</p></div>`,
    empty: `<div class="state-copy"><i class="ri-inbox-2-line"></i><strong>这里暂时没有资料</strong><p>${customMessage || '调整筛选条件，或创建第一份学习资料。'}</p><button class="btn btn-primary" type="button" data-view="editor">新建资料</button></div>`,
    error: `<div class="state-copy is-error"><i class="ri-error-warning-line"></i><strong>资料索引加载失败</strong><p>网络连接中断，草稿仍保存在本地。</p><button class="btn" type="button" data-state="loading">重新加载</button></div>`
  };
  statePanel.innerHTML = states[state];
}

document.addEventListener('click', (event) => {
  const stateTarget = event.target.closest('[data-state]');
  if (stateTarget) renderState(stateTarget.dataset.state);
});

document.querySelectorAll('.page-button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.page-button').forEach((item) => item.classList.remove('is-active'));
    button.classList.add('is-active');
  });
});
