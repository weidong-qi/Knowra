const { contextBridge, ipcRenderer } = require('electron');
let registered = false;
contextBridge.exposeInMainWorld('knowraDesktop', {
  transferBackup(input) {
    return ipcRenderer.invoke('backup-transfer', input);
  },
  downloadAttachment(id) {
    return ipcRenderer.invoke('attachment-download', id);
  },
  openSavedAttachment(token) {
    return ipcRenderer.invoke('attachment-open-saved', token);
  },
  readRecoveryDrafts() {
    const result = ipcRenderer.sendSync('read-recovery-drafts');
    if (result.error) throw new Error(result.error);
    return result.drafts;
  },
  writeRecoveryDraft(key, draft) {
    return ipcRenderer.invoke('write-recovery-draft', key, draft);
  },
  notify(input) {
    return ipcRenderer.invoke('system-notify', input);
  },
  onPdfHistory(callback) {
    const document = globalThis.document;
    let active = true;
    const updateFocus = () => {
      if (active)
        ipcRenderer.send(
          'pdf-history-focus',
          !document.activeElement?.closest('input, textarea, [contenteditable="true"], [role="textbox"]')
        );
    };
    const command = (_event, redo) => callback(redo === true);
    const afterBlur = () => queueMicrotask(updateFocus);
    ipcRenderer.on('pdf-history-command', command);
    document.addEventListener('focusin', updateFocus);
    document.addEventListener('focusout', afterBlur);
    updateFocus();
    return () => {
      active = false;
      ipcRenderer.removeListener('pdf-history-command', command);
      document.removeEventListener('focusin', updateFocus);
      document.removeEventListener('focusout', afterBlur);
      ipcRenderer.send('pdf-history-focus', false);
    };
  },
  modelSettings(action, value) {
    return ipcRenderer.invoke('model-settings', action, value);
  },
  onCancelClose(callback) {
    if (typeof callback === 'function') ipcRenderer.on('cancel-close', () => callback());
  },
  onPrepareClose(callback) {
    if (registered || typeof callback !== 'function') return;
    registered = true;
    ipcRenderer.on('prepare-close', async (_event, id, mode) => {
      try {
        await callback(mode);
        ipcRenderer.send('close-result', { id, ok: true });
      } catch (error) {
        ipcRenderer.send('close-result', { id, ok: false, message: String(error?.message || '保存未完成') });
      }
    });
    ipcRenderer.send('renderer-ready');
  }
});
