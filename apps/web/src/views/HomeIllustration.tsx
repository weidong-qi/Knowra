// 首页欢迎区插画：一叠笔记纸页、铅笔与印章，纸页上是会看向鼠标的像素小脸。
// 颜色全部取自共享令牌，深浅色同时成立；动效只在允许动画时启用。

import { PixelFace } from '../components/companion';
import styles from './HomeIllustration.module.css';

export function HomeIllustration() {
  return (
    <div className={styles.wrap} aria-hidden="true">
      <svg className={styles.svg} viewBox="0 0 440 320" focusable="false">
        <circle className={styles.blob} cx="230" cy="170" r="136" />
        <circle className={styles.blobRing} cx="230" cy="170" r="152" />

        <g transform="rotate(-9 210 170)">
          <rect className={styles.paperBack} x="116" y="72" width="190" height="212" rx="14" />
        </g>
        <g transform="rotate(6 250 170)">
          <rect className={styles.paperMid} x="172" y="60" width="190" height="216" rx="14" />
          <rect className={styles.line} x="196" y="92" width="96" height="8" rx="4" />
          <rect className={styles.line} x="196" y="112" width="132" height="8" rx="4" />
          <rect className={styles.line} x="196" y="132" width="110" height="8" rx="4" />
        </g>

        <g transform="rotate(-2 232 176)">
          <rect className={styles.paperFront} x="138" y="84" width="204" height="206" rx="14" />
          <rect className={styles.title} x="162" y="110" width="88" height="11" rx="5.5" />
          <rect className={styles.line} x="162" y="138" width="150" height="8" rx="4" />
          <rect className={styles.line} x="162" y="156" width="124" height="8" rx="4" />
          <rect className={styles.chip} x="162" y="246" width="62" height="22" rx="11" />
          <circle className={styles.chipDot} cx="177" cy="257" r="4" />
          <rect className={styles.line} x="188" y="254" width="26" height="6" rx="3" />
        </g>

        <g transform="translate(352 92)">
          <g className={styles.floatA}>
            <circle className={styles.stamp} r="30" />
            <circle className={styles.stampRing} r="23" />
            <path className={styles.check} d="M-12 1 l8 9 l16 -19" />
          </g>
        </g>

        <g transform="translate(66 250) rotate(-36)">
          <g className={styles.floatB}>
            <rect className={styles.pencilBody} x="0" y="0" width="118" height="17" rx="3" />
            <rect className={styles.pencilBand} x="96" y="0" width="9" height="17" />
            <polygon className={styles.pencilWood} points="118,0 144,8.5 118,17" />
            <polygon className={styles.pencilTip} points="136,5.3 144,8.5 136,11.7" />
            <rect className={styles.pencilCap} x="-8" y="0" width="12" height="17" rx="3" />
          </g>
        </g>

        <path className={styles.spark} d="M96 96 v16 M88 104 h16" />
        <path className={styles.spark} d="M388 206 v14 M381 213 h14" />
        <path className={styles.spark} d="M300 36 v12 M294 42 h12" />
        <circle className={styles.dot} cx="118" cy="40" r="4" />
        <circle className={styles.dot} cx="404" cy="150" r="3" />
        <circle className={styles.dot} cx="60" cy="176" r="3" />
      </svg>
      <div className={styles.face}>
        <PixelFace proximity={160} idleAfterMs={25000} maxLookOffset={5} />
      </div>
    </div>
  );
}
