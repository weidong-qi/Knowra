/** 打进 Mac 应用的桌面壳源码文件（CommonJS，运行时按相对路径互相 require）。新增被 require 的模块必须加到这里，否则打包后应用无法启动。 */
export const SHELL_FILES = ['main.cjs', 'preload.cjs', 'draft-store.cjs', 'model-settings.cjs', 'system-notifications.cjs',
  'ai-credential-handler.cjs', 'attachment-downloads.cjs', 'archive-download.cjs', 'backup-transfers.cjs', 'release-updates.cjs'];
