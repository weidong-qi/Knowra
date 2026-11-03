import { createContext, useContext } from 'react';

interface DesktopTitlebarState {
  enabled: boolean;
  host: HTMLDivElement | null;
}

export const DesktopTitlebarContext = createContext<DesktopTitlebarState>({ enabled: false, host: null });

export function useDesktopTitlebar(): DesktopTitlebarState {
  return useContext(DesktopTitlebarContext);
}
