import {
  BACKEND_WORKSPACE_CACHE_KEY,
  apiClient,
  createEmptyWorkspaceSnapshot,
  createWorkspaceApi,
  type KeyValueStorage
} from '@study-accelerator/web-core';
import type { PropsWithChildren } from 'react';
import { AppStoreProvider } from '../store/AppStoreProvider';
import type { AppStoreApi } from '../store/createAppStore';
import { readRuntimeConfig } from './runtimeConfig';
import { ExtractionEnvironmentProvider } from '../features/editor/ExtractionEnvironment';

export interface AppProvidersProps extends PropsWithChildren {
  store?: AppStoreApi;
}

export function AppProviders({ children, store }: AppProvidersProps) {
  const runtime = readRuntimeConfig();
  return (
    <AppStoreProvider
      store={store}
      dependencies={{
        api: createWorkspaceApi({ requestJson: apiClient.requestJson }),
        storage: getBrowserStorage(),
        cacheKey: BACKEND_WORKSPACE_CACHE_KEY + runtime.cacheSuffix,
        persistenceMode: runtime.persistenceMode,
        mockSnapshot: createEmptyWorkspaceSnapshot()
      }}
    >
      <ExtractionEnvironmentProvider>{children}</ExtractionEnvironmentProvider>
    </AppStoreProvider>
  );
}

function getBrowserStorage(): KeyValueStorage | null {
  try { return globalThis.localStorage; } catch { return null; }
}
