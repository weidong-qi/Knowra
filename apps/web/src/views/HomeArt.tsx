// 首页首屏插画：手绘涂鸦。暖纸底上的粗线条星星、螺旋、箭头、圈圈、波浪线，
// 彩色填色故意错位于线稿（类似手工印刷），线条经轻微位移滤镜带出手抖感。
// 颜色取自 HomeHero.module.css 里按明暗切换的变量。

import styles from './HomeArt.module.css';

function starPath(cx: number, cy: number, outer: number, inner: number): string {
  const points: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 ? inner : outer;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    points.push(`${(cx + radius * Math.cos(angle)).toFixed(1)} ${(cy + radius * Math.sin(angle)).toFixed(1)}`);
  }
  return `M${points.join(' L')} Z`;
}

function spiralPath(cx: number, cy: number, turns: number, growth: number): string {
  const points: string[] = [];
  for (let t = 0; t <= turns * 2 * Math.PI; t += 0.22) {
    const radius = (growth * t) / (2 * Math.PI);
    points.push(`${(cx + radius * Math.cos(t)).toFixed(1)} ${(cy + radius * Math.sin(t)).toFixed(1)}`);
  }
  return `M${points.join(' L')}`;
}

function raysPath(cx: number, cy: number, from: number, to: number, count: number): string {
  const parts: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i * 2 * Math.PI) / count + Math.PI / count;
    const x1 = cx + from * Math.cos(angle);
    const y1 = cy + from * Math.sin(angle);
    const x2 = cx + to * Math.cos(angle);
    const y2 = cy + to * Math.sin(angle);
    parts.push(`M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}`);
  }
  return parts.join(' ');
}

const STAR = starPath(800, 300, 128, 56);
const STAR_FILL = starPath(800, 300, 128, 56);
const SPIRAL = spiralPath(300, 210, 3.2, 9);
const RAYS = raysPath(800, 300, 160, 192, 10);

export function HomeArt() {
  return (
    <svg
      className={styles.art}
      viewBox="0 0 1600 900"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <filter id="home-wobble" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed="3" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id="home-grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
      </defs>

      {/* 错位的彩色填色 */}
      <g className={styles.floatStar}>
        <path className={styles.fillOrange} d={STAR_FILL} transform="translate(14 14)" />
      </g>
      <circle className={styles.fillYellow} cx="1262" cy="262" r="62" />
      <path className={styles.fillPink} d="M1086 560 q40 -70 88 -6 q40 62 -20 78 q-70 10 -68 -72 z" />
      <path className={styles.fillMint} d="M212 560 q60 -44 118 -4 q16 56 -48 70 q-72 0 -70 -66 z" />
      <path className={styles.fillYellow} d="M1290 430 l56 -60 l-14 52 l38 4 l-70 70 l16 -56 z" />

      {/* 手绘线稿 */}
      <g className={styles.ink} filter="url(#home-wobble)">
        <g className={styles.floatStar}>
          <path d={STAR} />
          <path d={RAYS} />
          <path className={styles.thin} d="M748 262 q52 -22 104 4 M742 292 q58 -20 116 4 M752 324 q48 -14 96 2" />
        </g>
        <path d={SPIRAL} />
        <path d="M262 640 C 236 520, 360 440, 520 372" />
        <path d="M472 366 L 524 370 L 502 418" />
        <path d="M1204 262 a 64 62 0 1 0 4 -2 M1180 214 a 80 74 0 0 1 120 14" />
        <path d="M1062 700 q 26 -34 52 0 t 52 0 t 52 0 t 52 0" />
        <path d="M1086 560 q40 -70 88 -6 q40 62 -20 78 q-70 10 -68 -72 z" />
        <path d="M212 560 q60 -44 118 -4 q16 56 -48 70 q-72 0 -70 -66 z" />
        <path d="M1290 430 l56 -60 l-14 52 l38 4 l-70 70 l16 -56 z" />
        <path d="M640 120 v36 M622 138 h36" />
        <path d="M1010 100 v28 M996 114 h28" />
        <path d="M470 110 q14 -22 30 0 q14 22 -4 40" />
        <circle cx="560" cy="500" r="9" />
        <circle cx="1220" cy="400" r="7" />
      </g>

      <rect className={styles.grain} x="0" y="0" width="1600" height="900" filter="url(#home-grain)" />
    </svg>
  );
}
