import type { AuthoritativePurgeResult, PurgeConfirmationInput, TrainingAssetKind, TrainingAssetRecord, TrainingMutationInput, TrainingPurgePreview } from '@study-accelerator/web-core';
import { assertLocalPurgeConfirmation } from '../assetPurge';
import { workspaceCapabilities } from '../workspaceCapabilities';
import type { WorkspaceDependencies } from '../types';
import type { GetStore } from '../workspaceSnapshotState';

export interface TrainingSlice {
  listTrainingAssets(kind: TrainingAssetKind): Promise<TrainingAssetRecord[]>;
  createTrainingAsset(kind: TrainingAssetKind, input: Record<string, unknown>): Promise<TrainingAssetRecord>;
  updateTrainingAsset(kind: TrainingAssetKind, id: string, input: Record<string, unknown>): Promise<TrainingAssetRecord>;
  mutateTrainingAsset(kind: TrainingAssetKind, id: string, action: 'validate' | 'confirm' | 'archive' | 'restore' | 'trash' | 'restore-deleted', input?: TrainingMutationInput): Promise<TrainingAssetRecord>;
  inspectTrainingAssetPurge(kind: TrainingAssetKind, id: string): Promise<TrainingPurgePreview>;
  purgeTrainingAsset(kind: TrainingAssetKind, id: string, confirmation: string | PurgeConfirmationInput): Promise<AuthoritativePurgeResult>;
}

export function createTrainingSlice(get: GetStore, { api }: WorkspaceDependencies): TrainingSlice {
  function requireConnected() {
    if (get().dataMode !== 'api') throw new Error('资料库尚未连接，请先重试加载。');
  }
  function requireWrite() {
    requireConnected();
    if (!workspaceCapabilities(get().persistenceMode).writeTraining || !get().canWriteWorkspace()) throw new Error('当前资料库只读，请重新连接并加载后重试。');
  }
  function requireMethod<T>(method: T | undefined): T {
    if (!method) throw new Error('当前服务尚未接通训练工作域，请更新应用后重试。');
    return method;
  }
  return {
    listTrainingAssets: kind => { requireConnected(); return requireMethod(api.listTrainingAssets)(kind, { includeArchived: true, includeDeleted: true }); },
    createTrainingAsset: (kind, input) => { requireWrite(); return requireMethod(api.createTrainingAsset)(kind, input); },
    updateTrainingAsset: (kind, id, input) => { requireWrite(); return requireMethod(api.updateTrainingAsset)(kind, id, input); },
    mutateTrainingAsset: (kind, id, action, input) => {
      requireWrite();
      const mutate = requireMethod(api.mutateTrainingAsset);
      return input === undefined ? mutate(kind, id, action) : mutate(kind, id, action, input);
    },
    inspectTrainingAssetPurge: (kind, id) => { requireConnected(); return requireMethod(api.inspectTrainingAssetPurge)(kind, id); },
    purgeTrainingAsset: (kind, id, confirmation) => {
      requireConnected();
      if (!get().canWriteWorkspace() || !workspaceCapabilities(get().persistenceMode).purgeTraining) throw new Error('当前资料库只读，不能永久清理。');
      if (get().persistenceMode === 'desktop-local') assertLocalPurgeConfirmation(confirmation);
      return requireMethod(api.purgeTrainingAsset)(kind, id, confirmation);
    }
  };
}
