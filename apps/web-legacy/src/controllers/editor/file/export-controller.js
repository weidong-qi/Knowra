import {
  buildNoteExportHtml,
  buildExportFileName
} from '../../../../lib/editor/file-menu.js';

export function createNoteExportController(deps) {
  const {
    state,
    flashStatus,
    escapeHtml
  } = deps;

  function exportCurrentNoteAsMarkdown(note) {
    if (!note) {
      return;
    }

    const fileName = buildExportFileName(note.title, 'md');
    triggerFileDownload(fileName, state.draftMarkdown || note.rawMarkdown, 'text/markdown;charset=utf-8');
    flashStatus(`已导出：${fileName}`);
  }

  function exportCurrentNoteAsPdf(note) {
    if (!note) {
      return;
    }

    const editorBody = document.querySelector('#milkdown-editor .ProseMirror');
    const previewHtml = editorBody?.innerHTML ?? `<pre>${escapeHtml(state.draftMarkdown || note.rawMarkdown)}</pre>`;
    const previewFileName = buildExportFileName(note.title, 'pdf');
    const printableHtml = buildNoteExportHtml({
      title: previewFileName,
      previewHtml,
      print: true,
      delayedPrint: true
    });
    const exportBlob = new Blob([printableHtml], { type: 'text/html;charset=utf-8' });
    const exportUrl = URL.createObjectURL(exportBlob);
    const exportWindow = window.open(exportUrl, '_blank');

    if (!exportWindow) {
      flashStatus('导出 PDF 失败：浏览器拦截了弹窗');
      return;
    }

    const fileName = buildExportFileName(note.title, 'pdf');
    exportWindow.document.write(buildNoteExportHtml({
      title: fileName,
      previewHtml,
      print: true
    }));
    exportWindow.document.close();
    flashStatus(`已准备导出：${fileName}`);
  }

  function exportCurrentNoteAsPdfStable(note) {
    if (!note) {
      return;
    }

    const editorBody = document.querySelector('#milkdown-editor .ProseMirror');
    const previewHtml = editorBody?.innerHTML ?? `<pre>${escapeHtml(state.draftMarkdown || note.rawMarkdown)}</pre>`;
    const exportName = buildExportFileName(note.title, 'html');
    const styledHtml = buildNoteExportHtml({
      title: exportName,
      previewHtml,
      rich: true
    });
    triggerFileDownload(exportName, styledHtml, 'text/html;charset=utf-8');
    flashStatus(`已导出：${exportName}`);
  }

  function triggerFileDownload(fileName, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return {
    exportCurrentNoteAsMarkdown,
    exportCurrentNoteAsPdf,
    exportCurrentNoteAsPdfStable,
    triggerFileDownload
  };
}
