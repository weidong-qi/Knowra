export type NoteFontSize = 15 | 17 | 19;

export interface AppPreferences {
  noteFontSize: NoteFontSize;
  reduceMotion: boolean;
}

const PREFERENCES_KEY = 'knowra:preferences:v1';

export const defaultAppPreferences: AppPreferences = {
  noteFontSize: 15,
  reduceMotion: false
};

export function readAppPreferences(): AppPreferences {
  try {
    const stored = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? 'null') as Partial<AppPreferences> | null;
    return {
      noteFontSize: stored?.noteFontSize === 15 || stored?.noteFontSize === 17 || stored?.noteFontSize === 19 ? stored.noteFontSize : 15,
      reduceMotion: stored?.reduceMotion === true
    };
  } catch {
    return { ...defaultAppPreferences };
  }
}

export function applyAppPreferences(preferences: AppPreferences): void {
  document.documentElement.style.setProperty('--note-font-size', `${preferences.noteFontSize}px`);
  if (preferences.reduceMotion) document.documentElement.dataset.reduceMotion = 'true';
  else delete document.documentElement.dataset.reduceMotion;
  try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences)); }
  catch { /* 存储不可用时，当前页面中的设置仍然生效。 */ }
}
