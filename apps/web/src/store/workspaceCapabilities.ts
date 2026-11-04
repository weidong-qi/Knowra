/** 与桌面运行服务的路由边界保持一致；只读预览可用，永久清理保持单独的能力门禁。 */
export function workspaceCapabilities(persistenceMode: 'remote' | 'desktop-local') {
  const local = persistenceMode === 'desktop-local';
  return {
    permanentDelete: !local,
    purgeKnowledge: true,
    purgeTraining: true,
    saveAnalysisScope: true,
    writeKnowledge: true,
    writeTraining: true,
  };
}

export const LOCAL_ASSET_PURGE_REASON = '永久清理需要连接兼容的云端并完成同步；离线时保留本地原件。';

export const LOCAL_PERMANENT_DELETE_REASON = '桌面端暂不支持彻底删除。可在此恢复笔记；需要永久清理时，请先完成云端同步，再在网页版操作。';
export const LOCAL_ANALYSIS_SCOPE_REASON = '当前资料库暂不支持保存分析范围，请升级后重试。';

export const LOCAL_TRAINING_PURGE_REASON = '桌面端暂不支持训练资产永久清理。可在此恢复资产；需要永久清理时，请先完成云端同步，再在网页版操作。';
