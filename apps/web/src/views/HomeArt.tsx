// 首页整页背景插画：日出渐变 + 撕纸感层叠波浪 + 半调点、星芒、波浪线，以及铅笔与印章。
// 全部铺满父容器（slice 裁切、底部对齐）；颜色取自 HomeHero.module.css 里按明暗切换的变量。

import styles from './HomeArt.module.css';

const SPARKLE = 'M0 -30 L7 -9 L28 -9 L11 4 L17 26 L0 12 L-17 26 L-11 4 L-28 -9 L-7 -9 Z';

export function HomeArt() {
  return (
    <svg
      className={styles.art}
      viewBox="0 0 1600 900"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <pattern id="home-halftone" width="16" height="16" patternUnits="userSpaceOnUse">
          <circle cx="4" cy="4" r="2.2" style={{ fill: 'var(--art-dots)' }} />
        </pattern>
        <pattern id="home-halftone-b" width="16" height="16" patternUnits="userSpaceOnUse">
          <circle cx="4" cy="4" r="2.2" style={{ fill: 'var(--art-dots-b)' }} />
        </pattern>
        <filter id="home-torn" x="-2%" y="-5%" width="104%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.018 0.05" numOctaves="3" seed="7" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="26" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id="home-grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
      </defs>

      <rect className={styles.dots} x="330" y="110" width="340" height="260" fill="url(#home-halftone)" />
      <rect className={styles.dotsB} x="980" y="430" width="300" height="160" fill="url(#home-halftone-b)" />

      <g filter="url(#home-torn)">
        <path
          className={styles.waveBack}
          d="M-60 640 C 160 560, 360 700, 620 640 S 1040 560, 1260 650 S 1560 600, 1700 640 V 960 H -60 Z"
        />
        <path
          className={styles.waveMid}
          d="M-60 720 C 200 650, 420 790, 700 720 S 1100 650, 1320 740 S 1580 700, 1700 730 V 960 H -60 Z"
        />
        <path
          className={styles.waveFront}
          d="M-60 800 C 240 750, 460 860, 760 800 S 1160 740, 1400 820 S 1600 790, 1700 810 V 960 H -60 Z"
        />
      </g>

      <path className={styles.squiggle} d="M300 560 q26 -36 52 0 t52 0 t52 0 t52 0 t52 0" />
      <path className={styles.squiggleB} d="M1330 120 q22 -30 44 0 t44 0 t44 0 t44 0" />

      <g transform="translate(1210 150)">
        <path className={styles.sparkA} d={SPARKLE} />
      </g>
      <g transform="translate(460 470) scale(.8)">
        <path className={styles.sparkB} d={SPARKLE} />
      </g>
      <g transform="translate(1250 480) scale(1.1)">
        <path className={styles.sparkC} d={SPARKLE} />
      </g>
      <g transform="translate(760 96) scale(.6)">
        <path className={styles.sparkD} d={SPARKLE} />
      </g>
      <g transform="translate(330 250) scale(.5)">
        <path className={styles.sparkC} d={SPARKLE} />
      </g>
      <circle className={styles.ring} cx="1300" cy="330" r="46" />
      <circle className={styles.ringB} cx="400" cy="330" r="22" />
      <circle className={styles.dotSolid} cx="560" cy="170" r="7" />
      <circle className={styles.dotSolidB} cx="1040" cy="260" r="10" />
      <circle className={styles.dotSolid} cx="1360" cy="260" r="6" />

      <g transform="translate(420 650) rotate(-30)">
        <g className={styles.floatB}>
          <rect className={styles.pencilBody} x="0" y="0" width="230" height="30" rx="5" />
          <rect className={styles.pencilBand} x="186" y="0" width="16" height="30" />
          <polygon className={styles.pencilWood} points="230,0 280,15 230,30" />
          <polygon className={styles.pencilTip} points="264,9.5 280,15 264,20.5" />
          <rect className={styles.pencilCap} x="-16" y="0" width="22" height="30" rx="5" />
        </g>
      </g>

      <g transform="translate(1140 610)">
        <g className={styles.floatA}>
          <circle className={styles.stamp} r="50" />
          <circle className={styles.stampRing} r="39" />
          <path className={styles.check} d="M-20 2 l13 15 l27 -32" />
        </g>
      </g>

      <rect className={styles.grain} x="0" y="0" width="1600" height="900" filter="url(#home-grain)" />
    </svg>
  );
}
