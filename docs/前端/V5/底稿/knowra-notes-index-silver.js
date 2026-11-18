/* global $, $$, S, notes, NOW, esc, ic, nById, locName, render, document */
/* 仅控制设计稿的展示状态，沿用底稿的示例内容。 */
(() => {
  const selectedNote = notes.find(note => note.id === 'n1');
  selectedNote.upd = NOW.toISOString();
  selectedNote.sum = '层级、留白与材质，是界面安静而清晰的基础。先建立秩序，再让内容自然浮现。';
  selectedNote.ol = ['让层级先于装饰', '给内容留出呼吸', '在细节中建立一致'];

  // 预览面板保留底稿的区域职责，改为侧重阅读的视觉构图。
  globalThis.renderPeek = function () {
    const panel = $('#peek');
    const note = S.cur && nById(S.cur);
    panel.hidden = !S.peek;
    $('#itog').setAttribute('aria-pressed', String(S.peek));
    if (!S.peek || !note) return;
    const kind = note.kind === 'pdf' ? 'PDF / 阅读预览' : 'NOTE / 笔记预览';
    panel.innerHTML = `<div class="pk-h"><span>内容预览</span><button class="ib" data-closepeek aria-label="关闭预览">${ic('x')}</button></div>
      <div class="pk-b"><div class="pk-eyebrow">${kind}</div><h2>${esc(note.title)}</h2><p class="sum">${esc(note.sum)}</p>

      <div class="preview-origin">${esc(locName(note))}<span>${note.kind === 'pdf' ? note.pages + ' 页' : note.words.toLocaleString() + ' 字'}</span></div>
      <h4>内容脉络</h4><ol class="ol">${note.ol.map(item => `<li>${esc(item)}</li>`).join('')}</ol>
      <div class="excerpt">${esc(note.id === 'n1' ? '细腻并不意味着更多。让每一次强调，都有它存在的理由。' : note.sum)}</div></div>
      <div class="pk-f"><button class="btn" data-opennote="${note.id}">${ic('open')}${note.kind === 'pdf' ? '继续阅读' : '打开笔记'}</button></div>`;
  };
  S.cur = 'n1';
  S.peek = true;
  render();
  $$('.visual-modes button').forEach(button => {
    button.addEventListener('click', () => {
      document.documentElement.dataset.tone = button.dataset.tone;
      $$('.visual-modes button').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    });
  });
})();
