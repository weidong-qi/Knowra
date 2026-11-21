// 全站 Toast 粒子汇聚→矢量图标动效：支持 success / warning / danger / accent / neutral 五种语义，
// 统一使用无外圈纯矢量定格，并在 jsdom 与 prefers-reduced-motion 下回退为静态 SVG。

import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { StatusTone } from '../tokens';

interface Point {
  x: number;
  y: number;
}

interface SwarmParticle {
  isCore: boolean;
  sx: number;
  sy: number;
  orbitDir: number;
  swirlAmount: number;
  wobbleFreq: number;
  driftAng: number;
  sizeFactor: number;
  delay: number;
}

interface ToneSpec {
  light: [primary: string, highlight: string];
  dark: [primary: string, highlight: string];
  /** 核心粒子数量（其余为外围漂浮粒子）。 */
  gatherMs: number;
  morphStartMs: number;
  morphEndMs: number;
  doneMs: number;
  /** 将 [0, 1] 参数映射到最终矢量图形上的采样点（归一化到 [-1, 1]）。 */
  sampleTarget(u: number): Point;
  /** 绘制 morph 阶段的最终矢量图形。 */
  drawShape(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
    scale: number,
    morphEase: number,
    pulseRaw: number,
    primary: string
  ): void;
  /** 静态回退 SVG 路径。 */
  fallbackSvg(size: number): ReactElement;
}

const V0: Point = { x: -0.44, y: 0.04 };
const V1: Point = { x: -0.1, y: 0.38 };
const V2: Point = { x: 0.48, y: -0.32 };

function sampleSegment(a: Point, b: Point, u: number): Point {
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
}

function sampleCheckPoint(u: number): Point {
  const len1 = Math.hypot(V1.x - V0.x, V1.y - V0.y);
  const len2 = Math.hypot(V2.x - V1.x, V2.y - V1.y);
  const total = len1 + len2;
  const d = u * total;
  if (d <= len1) return sampleSegment(V0, V1, d / len1);
  return sampleSegment(V1, V2, (d - len1) / len2);
}

const TONE_SPECS: Record<StatusTone, ToneSpec> = {
  success: {
    light: ['#16c765', '#4ade80'],
    dark: ['#34d399', '#6ee7b7'],
    gatherMs: 950,
    morphStartMs: 800,
    morphEndMs: 1480,
    doneMs: 1780,
    sampleTarget: sampleCheckPoint,
    drawShape(ctx, cx, cy, radius, scale, morphEase, pulseRaw, primary) {
      const len1 = Math.hypot(V1.x - V0.x, V1.y - V0.y);
      const len2 = Math.hypot(V2.x - V1.x, V2.y - V1.y);
      const targetDist = Math.min(1, morphEase * 1.25) * (len1 + len2);
      const bounce = pulseRaw > 0 && pulseRaw < 1 ? Math.sin(pulseRaw * Math.PI) * 0.25 : 0;

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = primary;
      ctx.lineWidth = scale * (1.25 + 0.95 * morphEase + bounce);
      ctx.globalAlpha = Math.min(1, morphEase * 1.35);

      ctx.beginPath();
      ctx.moveTo(cx + V0.x * radius, cy + V0.y * radius);
      if (targetDist <= len1) {
        const k = targetDist / len1;
        ctx.lineTo(cx + (V0.x + (V1.x - V0.x) * k) * radius, cy + (V0.y + (V1.y - V0.y) * k) * radius);
      } else {
        ctx.lineTo(cx + V1.x * radius, cy + V1.y * radius);
        const k = (targetDist - len1) / len2;
        ctx.lineTo(cx + (V1.x + (V2.x - V1.x) * k) * radius, cy + (V1.y + (V2.y - V1.y) * k) * radius);
      }
      ctx.stroke();
      ctx.restore();
    },
    fallbackSvg: size => (
      <svg width={size} height={size} viewBox="0 0 22 22" fill="none" aria-hidden="true">
        <path
          d="m6.7 11.4 3.3 3.3 5.6-6.8"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  },

  warning: {
    light: ['#d97706', '#fbbf24'],
    dark: ['#fbbf24', '#fde68a'],
    gatherMs: 880,
    morphStartMs: 740,
    morphEndMs: 1380,
    doneMs: 1700,
    sampleTarget: u => (u < 0.72 ? sampleSegment({ x: 0, y: -0.48 }, { x: 0, y: 0.14 }, u / 0.72) : { x: 0, y: 0.44 }),
    drawShape(ctx, cx, cy, radius, scale, morphEase, pulseRaw, primary) {
      const bounce = pulseRaw > 0 && pulseRaw < 1 ? Math.sin(pulseRaw * Math.PI) * 0.22 : 0;
      const lineProg = Math.min(1, morphEase * 1.3);
      const dotProg = Math.max(0, Math.min(1, (morphEase - 0.25) / 0.75));

      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = primary;
      ctx.fillStyle = primary;
      ctx.lineWidth = scale * (1.35 + 0.9 * morphEase + bounce);
      ctx.globalAlpha = Math.min(1, morphEase * 1.4);

      ctx.beginPath();
      ctx.moveTo(cx, cy - 0.48 * radius);
      ctx.lineTo(cx, cy + (-0.48 + 0.62 * lineProg) * radius);
      ctx.stroke();

      if (dotProg > 0) {
        ctx.globalAlpha = dotProg;
        ctx.beginPath();
        ctx.arc(cx, cy + 0.44 * radius, scale * (1.25 * dotProg + bounce * 0.7), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    },
    fallbackSvg: size => (
      <svg width={size} height={size} viewBox="0 0 22 22" fill="none" aria-hidden="true">
        <path d="M11 6.2v6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="11" cy="15.3" r="1.25" fill="currentColor" />
      </svg>
    )
  },

  danger: {
    light: ['#dc2626', '#f87171'],
    dark: ['#f87171', '#fca5a5'],
    gatherMs: 760,
    morphStartMs: 620,
    morphEndMs: 1220,
    doneMs: 1560,
    sampleTarget: u =>
      u < 0.5
        ? sampleSegment({ x: -0.36, y: -0.36 }, { x: 0.36, y: 0.36 }, u * 2)
        : sampleSegment({ x: 0.36, y: -0.36 }, { x: -0.36, y: 0.36 }, (u - 0.5) * 2),
    drawShape(ctx, cx, cy, radius, scale, morphEase, pulseRaw, primary) {
      const p1 = Math.min(1, morphEase * 1.45);
      const p2 = Math.max(0, Math.min(1, (morphEase - 0.2) * 1.35));
      const shake =
        pulseRaw > 0 && pulseRaw < 0.65 ? Math.sin(pulseRaw * Math.PI * 4) * (1 - pulseRaw) * 0.7 * scale : 0;

      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = primary;
      ctx.lineWidth = scale * (1.3 + 0.85 * morphEase);
      ctx.globalAlpha = Math.min(1, morphEase * 1.4);

      ctx.beginPath();
      ctx.moveTo(cx + shake - 0.36 * radius, cy - 0.36 * radius);
      ctx.lineTo(cx + shake + (-0.36 + 0.72 * p1) * radius, cy + (-0.36 + 0.72 * p1) * radius);
      ctx.stroke();

      if (p2 > 0) {
        ctx.beginPath();
        ctx.moveTo(cx + shake + 0.36 * radius, cy - 0.36 * radius);
        ctx.lineTo(cx + shake + (0.36 - 0.72 * p2) * radius, cy + (-0.36 + 0.72 * p2) * radius);
        ctx.stroke();
      }
      ctx.restore();
    },
    fallbackSvg: size => (
      <svg width={size} height={size} viewBox="0 0 22 22" fill="none" aria-hidden="true">
        <path d="m7.5 7.5 7 7m0-7-7 7" stroke="currentColor" strokeWidth="2.15" strokeLinecap="round" />
      </svg>
    )
  },

  accent: {
    light: ['#e86c2c', '#fb923c'],
    dark: ['#fb923c', '#fdba74'],
    gatherMs: 900,
    morphStartMs: 760,
    morphEndMs: 1400,
    doneMs: 1700,
    sampleTarget: u =>
      u < 0.28 ? { x: 0, y: -0.44 } : sampleSegment({ x: 0, y: -0.1 }, { x: 0, y: 0.48 }, (u - 0.28) / 0.72),
    drawShape(ctx, cx, cy, radius, scale, morphEase, pulseRaw, primary) {
      const bounce = pulseRaw > 0 && pulseRaw < 1 ? Math.sin(pulseRaw * Math.PI) * 0.2 : 0;
      const dotProg = Math.min(1, morphEase * 1.45);
      const lineProg = Math.max(0, Math.min(1, (morphEase - 0.15) / 0.85));

      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = primary;
      ctx.fillStyle = primary;
      ctx.lineWidth = scale * (1.3 + 0.9 * morphEase + bounce);

      ctx.globalAlpha = dotProg;
      ctx.beginPath();
      ctx.arc(cx, cy - 0.44 * radius, scale * (1.25 * dotProg + bounce * 0.6), 0, Math.PI * 2);
      ctx.fill();

      if (lineProg > 0) {
        ctx.globalAlpha = Math.min(1, lineProg * 1.3);
        ctx.beginPath();
        ctx.moveTo(cx, cy - 0.1 * radius);
        ctx.lineTo(cx, cy + (-0.1 + 0.58 * lineProg) * radius);
        ctx.stroke();
      }
      ctx.restore();
    },
    fallbackSvg: size => (
      <svg width={size} height={size} viewBox="0 0 22 22" fill="none" aria-hidden="true">
        <circle cx="11" cy="6.8" r="1.25" fill="currentColor" />
        <path d="M11 10.1v5.6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    )
  },

  neutral: {
    light: ['#52525b', '#a1a1aa'],
    dark: ['#a1a1aa', '#d4d4d8'],
    gatherMs: 850,
    morphStartMs: 700,
    morphEndMs: 1320,
    doneMs: 1620,
    sampleTarget: u => {
      const ang = u * Math.PI * 2;
      return { x: Math.cos(ang) * 0.34, y: Math.sin(ang) * 0.34 };
    },
    drawShape(ctx, cx, cy, radius, scale, morphEase, pulseRaw, primary) {
      const bounce = pulseRaw > 0 && pulseRaw < 1 ? Math.sin(pulseRaw * Math.PI) * 0.15 : 0;
      ctx.save();
      ctx.strokeStyle = primary;
      ctx.fillStyle = primary;
      ctx.lineWidth = scale * 1.75;
      ctx.globalAlpha = Math.min(1, morphEase * 1.35);

      ctx.beginPath();
      ctx.arc(cx, cy, radius * (0.36 * morphEase + bounce * 0.18), 0, Math.PI * 2);
      ctx.stroke();

      ctx.globalAlpha = morphEase;
      ctx.beginPath();
      ctx.arc(cx, cy, scale * (1.8 * morphEase), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },
    fallbackSvg: size => (
      <svg width={size} height={size} viewBox="0 0 22 22" fill="none" aria-hidden="true">
        <circle cx="11" cy="11" r="4.2" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="11" cy="11" r="1.8" fill="currentColor" />
      </svg>
    )
  }
};

function hash(index: number) {
  const s = Math.sin(index * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

const BASE_PARTICLES: SwarmParticle[] = Array.from({ length: 26 }, (_, i) => {
  const isCore = i < 18;
  const ang = hash(i * 3 + 1) * Math.PI * 2;
  const dist = 0.58 + hash(i * 5 + 2) * 0.45;
  return {
    isCore,
    sx: Math.cos(ang) * dist,
    sy: Math.sin(ang) * dist,
    orbitDir: i % 2 === 0 ? 1 : -1,
    swirlAmount: (0.9 + hash(i + 9) * 1.1) * (i % 2 === 0 ? 1 : -1),
    wobbleFreq: 3.5 + hash(i + 13) * 3.0,
    driftAng: hash(i * 7 + 3) * Math.PI * 2,
    sizeFactor: isCore ? 0.85 + hash(i + 21) * 0.45 : 0.55 + hash(i + 33) * 0.45,
    delay: (i % 6) * 0.03
  };
});

const easeOutCubic = (x: number) => 1 - (1 - x) ** 3;
const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

function isDarkTheme(el: HTMLElement | null) {
  if (el?.closest('[data-ni-mode="dark"]')) return true;
  if (typeof document !== 'undefined') {
    if (document.documentElement.classList.contains('dark')) return true;
    if (document.documentElement.dataset.niMode === 'dark') return true;
  }
  return false;
}

function drawFrame(ctx: CanvasRenderingContext2D, size: number, elapsedMs: number, dark: boolean, spec: ToneSpec) {
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.44;
  const scale = size / 22;

  const [primary, highlight] = dark ? spec.dark : spec.light;
  const gatherRaw = Math.min(1, elapsedMs / spec.gatherMs);
  const morphRaw = Math.max(0, Math.min(1, (elapsedMs - spec.morphStartMs) / (spec.morphEndMs - spec.morphStartMs)));
  const morphEase = easeInOutCubic(morphRaw);
  const pulseRaw = Math.max(0, Math.min(1, (elapsedMs - spec.morphEndMs) / (spec.doneMs - spec.morphEndMs)));

  ctx.clearRect(0, 0, size, size);

  if (pulseRaw > 0 && pulseRaw < 1) {
    ctx.save();
    ctx.globalAlpha = (1 - pulseRaw) * 0.42;
    ctx.strokeStyle = highlight;
    ctx.lineWidth = 1.4 * scale;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * (0.72 + pulseRaw * 0.42), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  const particleVisibility = 1 - easeOutCubic(Math.max(0, (morphRaw - 0.15) / 0.85));
  if (particleVisibility > 0.01) {
    for (let i = 0; i < BASE_PARTICLES.length; i += 1) {
      const p = BASE_PARTICLES[i]!;
      const localP = Math.max(0, Math.min(1, (gatherRaw - p.delay) / (1 - p.delay)));
      const e = easeOutCubic(localP);

      if (p.isCore) {
        const target = spec.sampleTarget(i / 17);
        const swirlAngle = (1 - e) * p.swirlAmount;
        const cosA = Math.cos(swirlAngle);
        const sinA = Math.sin(swirlAngle);

        const curX = p.sx + (target.x - p.sx) * e;
        const curY = p.sy + (target.y - p.sy) * e;
        const wobble = (1 - e) * 0.16 * Math.sin(elapsedMs * 0.012 + p.wobbleFreq);
        const rx = (curX * cosA - curY * sinA) * (1 + wobble);
        const ry = (curX * sinA + curY * cosA) * (1 + wobble);

        const px = cx + rx * radius;
        const py = cy + ry * radius;
        const r = scale * p.sizeFactor * (0.9 + 0.35 * (1 - e)) * (0.55 + 0.45 * particleVisibility);

        ctx.globalAlpha = Math.min(1, (0.35 + 0.65 * e) * particleVisibility);
        ctx.fillStyle = i % 3 === 0 ? highlight : primary;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const fadeOut = 1 - morphEase;
        if (fadeOut > 0.02) {
          const ang = p.driftAng + elapsedMs * 0.0022 * p.orbitDir;
          const dist = (0.95 - 0.35 * e + morphEase * 0.3) * radius;
          const px = cx + Math.cos(ang) * dist;
          const py = cy + Math.sin(ang) * dist;
          ctx.globalAlpha = 0.55 * fadeOut * (0.5 + 0.5 * Math.sin(elapsedMs * 0.015 + i));
          ctx.fillStyle = highlight;
          ctx.beginPath();
          ctx.arc(px, py, scale * p.sizeFactor, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  if (morphEase > 0) {
    spec.drawShape(ctx, cx, cy, radius, scale, morphEase, pulseRaw, primary);
  }
}

export function ToastSwarmIcon({ tone = 'neutral', size = 22 }: { tone?: StatusTone; size?: number }) {
  const spec = TONE_SPECS[tone];
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [fallbackStatic, setFallbackStatic] = useState(() => {
    if (typeof window === 'undefined') return true;
    if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) return true;
    return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  });

  useEffect(() => {
    if (fallbackStatic) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setFallbackStatic(true);
      return;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const pixelSize = Math.round(size * dpr);
    canvas.width = pixelSize;
    canvas.height = pixelSize;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const start = performance.now();
    let rafId = 0;

    const tick = (now: number) => {
      const elapsed = now - start;
      const dark = isDarkTheme(canvas);
      drawFrame(ctx, size, Math.min(elapsed, spec.doneMs), dark, spec);
      if (elapsed < spec.doneMs) {
        rafId = window.requestAnimationFrame(tick);
      }
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [fallbackStatic, size, spec]);

  if (fallbackStatic) {
    return spec.fallbackSvg(size);
  }

  return (
    <canvas ref={canvasRef} style={{ width: `${size}px`, height: `${size}px`, display: 'block' }} aria-hidden="true" />
  );
}
