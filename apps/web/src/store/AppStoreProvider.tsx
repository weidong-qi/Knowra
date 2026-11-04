import { createContext, useContext, useRef, type PropsWithChildren } from 'react';
import { useStore } from 'zustand';
import { createAppStore, type AppStoreApi } from './createAppStore';
import type { AppStore, WorkspaceDependencies } from './types';

const AppStoreContext = createContext<AppStoreApi | null>(null);

export interface AppStoreProviderProps extends PropsWithChildren {
  dependencies: WorkspaceDependencies;
  store?: AppStoreApi;
}

export function AppStoreProvider({ children, dependencies, store }: AppStoreProviderProps) {
  const storeRef = useRef<AppStoreApi | null>(null);
  storeRef.current ??= store ?? createAppStore(dependencies);
  return <AppStoreContext.Provider value={storeRef.current}>{children}</AppStoreContext.Provider>;
}

/** 订阅 store 派生值的 React hook。Provider 缺失时抛错。 */
export function useAppStore<T>(selector: (state: AppStore) => T): T {
  const store = useContext(AppStoreContext);
  if (!store) throw new Error('AppStoreProvider must wrap the V4 application.');
  return useStore(store, selector);
}

/** 取得 store 引用本身（不订阅），用于在事件回调 / ref 中读取最新状态或执行命令式操作。 */
export function useAppStoreApi(): AppStoreApi {
  const store = useContext(AppStoreContext);
  if (!store) throw new Error('AppStoreProvider must wrap the V4 application.');
  return store;
}
