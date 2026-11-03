import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { UNAVAILABLE_EXTRACTION, type ExtractionCapability, type KnowledgeExtractionApi } from '@study-accelerator/web-core';
import { useAppStore } from '../../store/AppStoreProvider';
import styles from './KnowledgeExtraction.module.css';

interface Environment { api?: KnowledgeExtractionApi; capability: ExtractionCapability; scopeKey: object; checking: boolean; recheck(): void }
const defaultScope = {};
const EnvironmentContext = createContext<Environment>({ capability: UNAVAILABLE_EXTRACTION, scopeKey: defaultScope, checking: false, recheck() {} });
export const useExtractionEnvironment = () => useContext(EnvironmentContext);

/** A server capability is the only source of demo identity; no URL/storage/config switch. */
export function ExtractionEnvironmentProvider({ children }: PropsWithChildren) {
  const api = useAppStore(s => s.knowledgeExtraction);
  const spaces = useAppStore(s => s.serverData.spaces);
  const spaceId = useAppStore(s => s.serverData.currentSpaceId);
  const generation = useAppStore(s => s.knowledgeGeneration);
  const mode = useAppStore(s => s.dataMode);
  const local = useAppStore(s => s.persistenceMode === 'desktop-local');
  const scopeKey = useMemo(() => ({}), [api, spaces, spaceId, generation, mode, local]);
  const [result, setResult] = useState<{ scope: object; capability: ExtractionCapability } | null>(null);
  const [revision, setRevision] = useState(0);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    if (!api || local || mode !== 'api') return;
    let active = true;
    setChecking(true);
    void api.getCapabilities().then(value => { if (active) setResult({ scope: scopeKey, capability: value.knowledgeExtraction }); })
      .catch(() => { if (active) setResult({ scope: scopeKey, capability: UNAVAILABLE_EXTRACTION }); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [api, local, mode, scopeKey, revision]);
  const capability = result?.scope === scopeKey ? result.capability : UNAVAILABLE_EXTRACTION;
  return <EnvironmentContext.Provider value={{ api: local || mode !== 'api' ? undefined : api, capability, scopeKey,
    checking: Boolean(api && !local && mode === 'api' && checking), recheck: () => setRevision(value => value + 1) }}>{children}</EnvironmentContext.Provider>;
}

export function ExtractionDemoNotice() {
  const { capability } = useExtractionEnvironment();
  return capability.executionMode === 'mock' ? <p role="status" className={styles.demo}>模拟演示，结果仅用于流程验收</p> : null;
}
