import type { AppStore, StatusSlice } from '../types';

type SetStore = (partial: Partial<AppStore> | ((state: AppStore) => Partial<AppStore>)) => void;

export function createStatusSlice(set: SetStore): StatusSlice {
  return {
    editorHasLocalChanges: false,
    editorSaveError: null,
    setEditorHasLocalChanges: (editorHasLocalChanges, editorSaveError = null) => set({ editorHasLocalChanges, editorSaveError }),
    statusMessage: '正在加载资料工作台…',
    saveState: 'idle',
    saveError: null,
    setStatusMessage: (statusMessage) => set({ statusMessage }),
    beginSave: (message = '正在保存…') => set({
      saveState: 'saving',
      saveError: null,
      statusMessage: message
    }),
    finishSave: (message = '已保存') => set({
      saveState: 'saved',
      saveError: null,
      statusMessage: message
    }),
    failSave: (error) => {
      const saveError = error instanceof Error ? error.message : '保存失败，请重试。';
      set({ saveState: 'error', saveError, statusMessage: saveError });
    }
  };
}
