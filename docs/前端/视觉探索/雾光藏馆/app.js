/* global document, window */
/* 独立设计原型：所有内容为演示数据，仅在页面内存中更新。 */
const collections = [
  { id: 'deep', title: '深度学习', asset: 'blue' },
  { id: 'math', title: '数值分析', asset: 'coral' },
  { id: 'paper', title: '论文精读', asset: 'slate' }
];
const documents = [
  {
    id: 'attention',
    collection: 'deep',
    title: 'Attention Is All You Need',
    author: 'Vaswani et al. · 2017 · 论文',
    type: 'pdf',
    date: '2026-11-17',
    saved: true,
    marks: 12,
    summary:
      '提出了 Transformer 模型，仅使用注意力机制建立序列之间的联系。多头注意力让模型能够同时关注不同位置与不同表示空间中的信息。',
    note: 'Transformer 结构与自注意力机制笔记'
  },
  {
    id: 'bert',
    collection: 'deep',
    title: 'BERT: Pre-training of Deep Bidirectional Transformers',
    author: 'Devlin et al. · 2018 · 论文',
    type: 'pdf',
    date: '2026-11-14',
    saved: false,
    marks: 5,
    summary:
      '通过掩码语言模型进行双向预训练，让词语表示能够同时利用左右上下文。阅读时重点比较预训练目标与下游微调方式。',
    note: '双向上下文与掩码语言模型'
  },
  {
    id: 'transformer-note',
    collection: 'deep',
    title: 'Transformer 结构与自注意力机制笔记',
    author: '我的笔记 · 2,348 字',
    type: 'note',
    date: '2026-11-16',
    saved: true,
    marks: 3,
    summary:
      '从查询、键和值开始，整理缩放点积注意力、多头机制与残差连接的作用。把论文中的公式转化成可以逐步核对的理解。',
    note: 'Attention Is All You Need'
  },
  {
    id: 'survey',
    collection: 'deep',
    title: 'A Survey of Transformers',
    author: 'Lin et al. · 2022 · 综述',
    type: 'pdf',
    date: '2026-11-10',
    saved: false,
    marks: 7,
    summary: '梳理 Transformer 的结构演进、效率改进与应用方向，作为后续论文阅读的路线参考。',
    note: 'Transformer 阅读路线'
  },
  {
    id: 'gauss',
    collection: 'math',
    title: 'Gauss 求积公式与余项',
    author: '我的笔记 · 1,680 字',
    type: 'note',
    date: '2026-11-16',
    saved: true,
    marks: 4,
    summary: '由正交多项式确定求积节点，结合 Hermite 插值理解高斯求积公式的代数精度及余项形式。',
    note: 'Hermite 插值与误差分析'
  },
  {
    id: 'hermite',
    collection: 'math',
    title: 'Hermite 插值与误差分析',
    author: '课程资料 · 数值分析',
    type: 'pdf',
    date: '2026-11-12',
    saved: false,
    marks: 2,
    summary: '在函数值之外利用导数信息构造插值多项式，分析重复节点与插值余项之间的关系。',
    note: 'Gauss 求积公式与余项'
  },
  {
    id: 'densenet',
    collection: 'paper',
    title: 'Densely Connected Convolutional Networks',
    author: 'Huang et al. · 2017 · 论文',
    type: 'pdf',
    date: '2026-11-15',
    saved: true,
    marks: 8,
    summary: '通过密集连接复用特征。记录 DenseBlock 中通道拼接、增长率和过渡层如何共同决定网络的宽度与计算量。',
    note: 'DenseNet 阅读笔记'
  },
  {
    id: 'densenet-note',
    collection: 'paper',
    title: 'DenseNet 阅读笔记',
    author: '我的笔记 · 986 字',
    type: 'note',
    date: '2026-11-13',
    saved: false,
    marks: 0,
    summary: '以一个小型 DenseBlock 为例，逐步计算每层输入通道数，核对拼接位置与过渡层的压缩方式。',
    note: 'Densely Connected Convolutional Networks'
  }
];
const state = { collection: 'deep', scope: 'all', selected: 'attention', query: '', sort: 'recent', compact: false };
const $ = selector => document.querySelector(selector);
const icon = (name, className = '') => `<img class="${className}" src="assets/icons/${name}.svg" alt="" />`;
const escapeHtml = value =>
  String(value).replace(
    /[&<>"']/g,
    character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]
  );
let toastTimer;

function notify(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 2200);
}

function visibleDocuments() {
  return documents
    .filter(doc => {
      const inCollection = state.query || state.scope !== 'all' || doc.collection === state.collection;
      const inScope = state.scope !== 'saved' || doc.saved;
      return (
        inCollection &&
        inScope &&
        `${doc.title} ${doc.author} ${doc.summary}`.toLowerCase().includes(state.query.toLowerCase())
      );
    })
    .sort((a, b) => (state.sort === 'title' ? a.title.localeCompare(b.title, 'zh-CN') : b.date.localeCompare(a.date)));
}

function renderNavigation() {
  const scopes = [
    { id: 'all', title: '全部资料', icon: 'folder', count: documents.length },
    { id: 'recent', title: '最近阅读', icon: 'clock', count: documents.length },
    { id: 'saved', title: '收藏', icon: 'star', count: documents.filter(doc => doc.saved).length }
  ];
  $('#scopes').innerHTML = scopes
    .map(
      scope =>
        `<button class="nav-item ${state.scope === scope.id ? 'selected' : ''}" data-scope="${scope.id}" aria-pressed="${state.scope === scope.id}">${icon(scope.icon)}<span>${scope.title}</span><span class="count">${scope.count}</span></button>`
    )
    .join('');
  $('#collection-nav').innerHTML = collections
    .map(
      collection =>
        `<button class="nav-item" data-collection="${collection.id}" aria-pressed="${state.collection === collection.id && state.scope === 'all'}">${icon('folder')}<span>${collection.title}</span><span class="count">${documents.filter(doc => doc.collection === collection.id).length}</span></button>`
    )
    .join('');
  $('#collections').innerHTML = collections
    .map(
      collection =>
        `<button class="collection" data-collection="${collection.id}" aria-pressed="${state.collection === collection.id && state.scope === 'all'}"><img src="assets/folder-${collection.asset}.png" alt="" /><span class="collection-title">${collection.title}</span><span class="collection-count">${documents.filter(doc => doc.collection === collection.id).length} 篇资料</span></button>`
    )
    .join('');
}

function renderList() {
  const visible = visibleDocuments();
  if (!visible.some(doc => doc.id === state.selected)) state.selected = visible[0]?.id ?? null;
  $('#list-title').textContent = state.query
    ? '搜索结果'
    : state.scope === 'saved'
      ? '我的收藏'
      : state.scope === 'recent'
        ? '最近阅读'
        : `${collections.find(collection => collection.id === state.collection).title} · 资料`;
  $('#result-count').textContent = `共 ${visible.length} 篇`;
  $('#document-list').classList.toggle('compact', state.compact);
  $('#document-list').innerHTML = visible.length
    ? visible
        .map(
          doc =>
            `<div class="doc-row ${doc.id === state.selected ? 'selected' : ''}"><button class="doc-open" data-document="${doc.id}" aria-pressed="${doc.id === state.selected}"><span class="file-icon ${doc.type === 'note' ? 'note' : ''}">${icon(doc.type === 'note' ? 'markdown-file' : 'pdf-file')}</span><span class="doc-info"><strong>${escapeHtml(doc.title)}</strong><small>${escapeHtml(doc.author)}</small></span><span class="doc-date">${doc.date.slice(5).replace('-', ' / ')}</span></button><button class="icon-button star-button ${doc.saved ? 'saved' : ''}" data-save="${doc.id}" aria-label="${doc.saved ? '取消收藏' : '收藏'} ${escapeHtml(doc.title)}" aria-pressed="${doc.saved}" title="${doc.saved ? '取消收藏' : '收藏'}">${icon('star')}</button></div>`
        )
        .join('')
    : '<div class="empty">没有找到匹配的资料<br />换个关键词，或新建一篇笔记。</div>';
  renderInspector();
}

function renderInspector() {
  const doc = documents.find(item => item.id === state.selected);
  if (!doc) {
    $('#inspector').innerHTML = '<div class="empty">选择一篇资料，查看内容与标注。</div>';
    return;
  }
  const isAttention = doc.id === 'attention';
  $('#inspector').innerHTML =
    `<header><h2 class="detail-title">${escapeHtml(doc.title)}</h2><p class="detail-meta">${escapeHtml(doc.author)}${doc.type === 'pdf' ? '（PDF）' : ''}</p></header><div class="paper-preview" aria-label="资料内容示意"><h4>${escapeHtml(doc.title)}</h4><div class="paper-authors">${isAttention ? 'Ashish Vaswani &nbsp; Noam Shazeer &nbsp; Niki Parmar<br />Jakob Uszkoreit &nbsp; Llion Jones' : escapeHtml(doc.author)}</div><b>${doc.type === 'pdf' ? 'Abstract' : '阅读与思考'}</b><p>${isAttention ? 'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms.' : escapeHtml(doc.summary)}</p></div><button class="annotation-button" id="show-annotations">${icon('highlight')}<span>${doc.marks} 条标注</span>${icon('chevron-right')}</button><section class="detail-section"><h3>内容摘要</h3><p>${escapeHtml(doc.summary)}</p></section>${doc.note ? `<section class="detail-section related"><h3>相关笔记</h3><button id="related-note">${icon('note')}<span>${escapeHtml(doc.note)}</span></button></section>` : ''}<button class="primary read-button" id="read">${icon('book')}继续阅读</button>`;
  $('#read').addEventListener('click', () => openReader(doc));
  $('#show-annotations').addEventListener('click', () => {
    $('#annotations-content').innerHTML = doc.marks
      ? `<p class="form-note">以下是当前资料的标注样式示例。</p><div class="annotation">${escapeHtml(doc.summary.split('。')[0])}。<small>重点 · 阅读时摘录</small></div><div class="annotation">这个方法与之前的结构相比，解决了什么问题？<small>思考 · 待继续核对</small></div>`
      : '<p class="empty">还没有标注，阅读时可以记录你的思考。</p>';
    $('#annotations-dialog').showModal();
  });
  $('#related-note')?.addEventListener('click', () => {
    const related = documents.find(item => item.title === doc.note);
    if (related) {
      state.selected = related.id;
      state.collection = related.collection;
      state.query = '';
      state.scope = 'all';
      $('#search').value = '';
      render();
    } else notify('这篇关联笔记尚未加入演示资料');
  });
}

function openReader(doc) {
  $('#reader-content').innerHTML =
    `<h1 id="reader-title">${escapeHtml(doc.title)}</h1><p class="reader-meta">${escapeHtml(doc.author)} · 阅读界面示意</p><p>${escapeHtml(doc.summary)}</p><h2>阅读线索</h2><p>阅读这份资料时，可以先确认它试图解决的问题，再记录核心方法与论证依据。把不确定的地方留下来，后续回到原文继续核对。</p><p><mark>${escapeHtml(doc.summary.split('。')[0])}。</mark></p><h2>我的思考</h2><p>哪些条件支持这一结论？如果改变其中一个假设，结果是否仍然成立？通过整理这些问题，让一次阅读成为下一次理解的起点。</p><p class="reader-meta">此处为设计预览内容，未加载真实 PDF 或个人笔记。</p>`;
  $('#reader-dialog').showModal();
}

function render() {
  renderNavigation();
  renderList();
}
document.addEventListener('click', event => {
  const collectionButton = event.target.closest('[data-collection]');
  if (collectionButton) {
    state.collection = collectionButton.dataset.collection;
    state.scope = 'all';
    state.query = '';
    $('#search').value = '';
    render();
  }
  const scopeButton = event.target.closest('[data-scope]');
  if (scopeButton) {
    state.scope = scopeButton.dataset.scope;
    state.query = '';
    $('#search').value = '';
    render();
  }
  const documentButton = event.target.closest('[data-document]');
  if (documentButton) {
    state.selected = documentButton.dataset.document;
    renderList();
    if (window.innerWidth <= 1050) openReader(documents.find(doc => doc.id === state.selected));
  }
  const saveButton = event.target.closest('[data-save]');
  if (saveButton) {
    const doc = documents.find(item => item.id === saveButton.dataset.save);
    doc.saved = !doc.saved;
    notify(doc.saved ? '已加入收藏' : '已取消收藏');
    render();
  }
  const closeButton = event.target.closest('[data-close]');
  if (closeButton) closeButton.closest('dialog').close();
});
$('#search').addEventListener('input', event => {
  state.query = event.target.value.trim();
  renderList();
});
$('#sort').addEventListener('change', event => {
  state.sort = event.target.value;
  renderList();
});
$('#density').addEventListener('click', () => {
  state.compact = !state.compact;
  $('#density').setAttribute('aria-pressed', String(state.compact));
  renderList();
});
$('#theme').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme !== 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('#theme').setAttribute('aria-label', dark ? '切换浅色模式' : '切换深色模式');
  $('#theme').title = dark ? '切换浅色模式' : '切换深色模式';
});
$('#materials').addEventListener('click', () => {
  state.scope = 'all';
  state.collection = 'deep';
  state.query = '';
  $('#search').value = '';
  render();
});
$('#create').addEventListener('click', () => {
  $('#note-collection').value = state.collection;
  $('#create-dialog').showModal();
  $('#note-title').focus();
});
$('#create-form').addEventListener('submit', event => {
  event.preventDefault();
  const title = $('#note-title').value.trim();
  if (!title) {
    $('#note-title').setCustomValidity('请输入笔记名称');
    $('#note-title').reportValidity();
    return;
  }
  const id = `note-${Date.now()}`;
  documents.unshift({
    id,
    title,
    collection: $('#note-collection').value,
    author: '我的笔记 · 刚刚创建',
    type: 'note',
    date: '2026-11-17',
    saved: false,
    marks: 0,
    summary: '新的想法，从这里开始。',
    note: ''
  });
  state.collection = $('#note-collection').value;
  state.selected = id;
  state.scope = 'all';
  state.query = '';
  $('#search').value = '';
  $('#create-dialog').close();
  $('#create-form').reset();
  render();
  notify('笔记已创建 · 仅保留在本次预览中');
});
$('#note-title').addEventListener('input', () => $('#note-title').setCustomValidity(''));
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    $('#search').focus();
  }
});
render();
