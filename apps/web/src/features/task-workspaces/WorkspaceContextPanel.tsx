import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from '../../components/ui/button/Button';
import styles from './TaskWorkspaces.module.css';

/** Desktop keeps context visible; narrow screens disclose it without replacing the shell. */
export function WorkspaceContextPanel({ label, current, children, toolbar = false }: {
  label: string; current?: string; toolbar?: boolean; children(close: () => void): ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = () => {
    setOpen(false);
    if (window.matchMedia('(max-width: 700px)').matches) trigger.current?.focus();
  };
  useEffect(() => {
    const media = window.matchMedia('(max-width: 700px)');
    const resize = () => {
      setOpen(false);
      if (media.matches && body.current?.contains(document.activeElement)) trigger.current?.focus();
      if (!media.matches && document.activeElement === trigger.current) body.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
    };
    media.addEventListener('change', resize);
    return () => media.removeEventListener('change', resize);
  }, []);
  return <div className={toolbar ? styles.contextToolbar : styles.contextPanel} onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    <Button ref={trigger} variant="ghost" className={styles.contextTrigger} aria-expanded={open} aria-controls={id}
      onPress={() => setOpen(value => !value)}>
      <span className={styles.contextLabel}>{label}{current && <span className={styles.contextCurrent}> · {current}</span>}</span>
      <span aria-hidden="true">{open ? '收起' : '展开'}</span>
    </Button>
    <div ref={body} id={id} className={toolbar ? styles.contextActions : styles.contextBody} data-collapsed={!open}>
      {children(close)}
    </div>
  </div>;
}
