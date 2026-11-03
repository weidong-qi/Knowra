export function renderRichEditorHost() {
  return `
    <section class="editor-pane editor-pane-single">
      <div class="pane-body">
        <div class="editor-utility-panel" id="editor-utility-panel" hidden></div>
        <div class="editor-table-dialog" id="editor-table-dialog" hidden></div>
        <div class="milkdown-host" id="milkdown-editor"></div>
      </div>
    </section>
  `;
}
