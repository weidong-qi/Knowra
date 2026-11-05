import { IconButton } from '../../components/ui';
import { useNotesIndexAppearance, setNotesIndexAppearance, type NotesIndexAppearance } from './notesIndexAppearanceModel';
import styles from './NotesIndexTheme.module.css';

/** 全局外壳、工作区和 portal 共用的定稿外观。 */
export function notesIndexAppearanceProps(appearance: NotesIndexAppearance) {
  return {
    className: styles.theme,
    'data-ni-mode': appearance.mode,
    'data-ni-theme': appearance.theme,
    'data-ni-shape': appearance.shape,
    'data-overlay-material': appearance.overlayMaterial,
    'data-button-style': appearance.buttonStyle,
    'data-default-button-style': appearance.defaultButtonStyle,
    'data-dialog-style': appearance.dialogStyle
  };
}

export function NotesIndexAppearanceControls() {
  const appearance = useNotesIndexAppearance();
  return <div {...notesIndexAppearanceProps(appearance)} className={`${styles.theme} ${styles.controls}`} aria-label="外观">
    <IconButton size={24} aria-label={appearance.mode === 'light' ? '切换深色模式' : '切换浅色模式'} title={appearance.mode === 'light' ? '深色模式' : '浅色模式'} aria-pressed={appearance.mode === 'dark'} onPress={() => setNotesIndexAppearance({ mode: appearance.mode === 'light' ? 'dark' : 'light' })}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        {appearance.mode === 'light' ? <path d="M20 14a8.5 8.5 0 0 1-10-10A8.5 8.5 0 1 0 20 14Z" /> : <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5" /></>}
      </svg>
    </IconButton>
  </div>;
}
