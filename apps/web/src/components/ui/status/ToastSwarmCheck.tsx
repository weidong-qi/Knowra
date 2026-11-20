// 成功状态粒子汇聚→矢量对勾图标：标准舒缓节奏（约 1.75s），无外圈纯矢量定格。

import { useEffect, useRef, useState } from 'react';

interface Point {
  x: number;
  y: number;
}

interface SwarmParticle {
  isCore: boolean;
  tx: number;
  ty: number;
  sx: number;
  sy: number;
  orbitDir: number;
  swirlAmount: number;
  wobbleFreq: number;
  driftAng: number;
  sizeFactor: number;
  delay: number;
}

const V0: Point = { x: -0.44, y: 0.04 };
const V1: Point = { x: -0.1, y: 0.38 };
const V2: Point = { x: 0.48, y: -0.32 };

const T_GATHER_END = 950;
const T_MORPH_START = 800;
const T_MORPH_END = 1480;
const T_DONE_END = 1780;

function sampleCheckPoint(u: number): Point {
  const len1 = Math.hypot(V1.x - V0.x, V1.y - V0.y);
  const len2 = Math.hypot(V2.x - V1.x, V2.y - V1.y);
  const total = len1 + len2;
  const d = u * total;
  if (d <= len1) {
    const k = d / len1;
    return { x: V0.x + (V1.x - V0.x) * k, y: V0.y + (V1.y - V0.y) * k };
  }
  const k = (d - len1) / len2;
  return { x: V1.x + (V2.x - V1.x) * k, y: V1.y + (V2.y - V1.y) * k };
}

function hash(index: number) {
  const s = Math.sin(index * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

const PARTICLES: SwarmParticle[] = Array.from({ length: 26 }, (_, i) => {
  const isCore = i < 18;
  const target = isCore ? sampleCheckPoint(i / 17) : { x: 0, y: 0 };
  const ang = hash(i * 3 + 1) * Math.PI * 2;
  const dist = 0.58 + hash(i * 5 + 2) * 0.45;
  return {
    isCore,
    tx: target.x,
    ty: target.y,
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

function drawFrame(ctx: CanvasRenderingContext2D, size: number, elapsedMs: number, dark: boolean) {
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.44;
  const scale = size / 22;

  const vividGreen = dark ? '#34d399' : '#16c765';
  const brightMint = dark ? '#6ee7b7' : '#4ade80';

  const gatherRaw = Math.min(1, elapsedMs / T_GATHER_END);
  const morphRaw = Math.max(0, Math.min(1, (elapsedMs - T_MORPH_START) / (T_MORPH_END - T_MORPH_START)));
  const morphEase = easeInOutCubic(morphRaw);
  const pulseRaw = Math.max(0, Math.min(1, (elapsedMs - T_MORPH_END) / (T_DONE_END - T_MORPH_END)));

  ctx.clearRect(0, 0, size, size);

  if (pulseRaw > 0 && pulseRaw < 1) {
    ctx.save();
    ctx.globalAlpha = (1 - pulseRaw) * 0.42;
    ctx.strokeStyle = brightMint;
    ctx.lineWidth = 1.4 * scale;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * (0.72 + pulseRaw * 0.42), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  const particleVisibility = 1 - easeOutCubic(Math.max(0, (morphRaw - 0.15) / 0.85));
  if (particleVisibility > 0.01) {
    for (let i = 0; i < PARTICLES.length; i += 1) {
      const p = PARTICLES[i]!;
      const localP = Math.max(0, Math.min(1, (gatherRaw - p.delay) / (1 - p.delay)));
      const e = easeOutCubic(localP);

      if (p.isCore) {
        const swirlAngle = (1 - e) * p.swirlAmount;
        const cosA = Math.cos(swirlAngle);
        const sinA = Math.sin(swirlAngle);
        const curX = p.sx + (p.tx - p.sx) * e;
        const curY = p.sy + (p.ty - p.sy) * e;
        const wobble = (1 - e) * 0.16 * Math.sin(elapsedMs * 0.012 + p.wobbleFreq);
        const rx = (curX * cosA - curY * sinA) * (1 + wobble);
        const ry = (curX * sinA + curY * cosA) * (1 + wobble);

        const px = cx + rx * radius;
        const py = cy + ry * radius;
        const r = scale * p.sizeFactor * (0.9 + 0.35 * (1 - e)) * (0.55 + 0.45 * particleVisibility);

        ctx.globalAlpha = Math.min(1, (0.35 + 0.65 * e) * particleVisibility);
        ctx.fillStyle = i % 3 === 0 ? brightMint : vividGreen;
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
          ctx.fillStyle = brightMint;
          ctx.beginPath();
          ctx.arc(px, py, scale * p.sizeFactor, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  if (morphEase > 0) {
    const len1 = Math.hypot(V1.x - V0.x, V1.y - V0.y);
    const len2 = Math.hypot(V2.x - V1.x, V2.y - V1.y);
    const total = len1 + len2;
    const drawProg = Math.min(1, morphEase * 1.25);
    const targetDist = drawProg * total;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = vividGreen;
    const bounce = pulseRaw > 0 && pulseRaw < 1 ? Math.sin(pulseRaw * Math.PI) * 0.25 : 0;
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
  }
}

export function ToastSwarmCheck({ size = 22 }: { size?: number }) {
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
      drawFrame(ctx, size, Math.min(elapsed, T_DONE_END), dark);
      if (elapsed < T_DONE_END) {
        rafId = window.requestAnimationFrame(tick);
      }
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [fallbackStatic, size]);

  if (fallbackStatic) {
    return (
      <svg width={size} height={size} viewBox="0 0 22 22" fill="none" aria-hidden="true">
        <path
          d="m6.7 11.4 3.3 3.3 5.6-6.8"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <canvas ref={canvasRef} style={{ width: `${size}px`, height: `${size}px`, display: 'block' }} aria-hidden="true" />
  );
}
