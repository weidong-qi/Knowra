import styles from './EmptyArt.module.css';

export type EmptyArtVariant = 'note' | 'search' | 'knowledge';

function Badge({ variant }: { variant: EmptyArtVariant }) {
  if (variant === 'search') return <g className={styles.glyph}><circle cx="165" cy="105" r="8.5" /><path d="m171.5 111.5 6 6" /></g>;
  if (variant === 'knowledge') return <g className={styles.glyph}><path d="m165 95 13 6.5-13 6.5-13-6.5Z" /><path d="m152 108 13 6.5 13-6.5" /></g>;
  return <g className={styles.glyph}><path d="M158 95h10l7 7v15a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2V97a2 2 0 0 1 2-2Z" /><path d="M168 95v7h7" /></g>;
}

/** 空状态插图：两张错落的纸页加一枚强调色徽章，随主题强调色着色；纯装饰，对读屏隐藏。 */
export function EmptyArt({ variant = 'note', className }: { variant?: EmptyArtVariant; className?: string }) {
  return <svg className={`${styles.art} ${className ?? ''}`} width="240" height="150" viewBox="0 0 240 150" fill="none" aria-hidden="true" focusable="false">
    <g transform="rotate(-6 85 70)"><rect className={styles.page} x="52" y="26" width="76" height="92" rx="7" /><rect className={styles.line} x="64" y="46" width="40" height="5" rx="2.5" /><rect className={styles.line} x="64" y="58" width="32" height="5" rx="2.5" /></g>
    <g transform="rotate(4 125 70)"><rect className={styles.page} x="90" y="18" width="84" height="104" rx="7" /><rect className={styles.bar} x="102" y="32" width="36" height="6" rx="3" />
      {[50, 62, 74, 86].map((y, index) => <rect key={y} className={styles.line} x="102" y={y} width={[58, 50, 58, 34][index]} height="5" rx="2.5" />)}</g>
    <circle className={styles.badge} cx="165" cy="105" r="21" />
    <Badge variant={variant} />
    <circle className={styles.dot} cx="51" cy="44" r="3.5" /><circle className={styles.dot} cx="191" cy="36" r="3" /><circle className={styles.dot} cx="203" cy="88" r="2" />
  </svg>;
}
