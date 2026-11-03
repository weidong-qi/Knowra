// V4 PixelFace —— 极简抽象的像素五官装饰
//
// 行为规范：
// - 90% 时间保持静止
// - 10% 时间随机眨眼 / 鼠标跟随 / idle 渐变
// - 暴露 setState / getState 给上层主动控制
// - 鼠标跟随用 rAF 平滑插值
// - 不在 useState 每帧更新坐标——直接写 style.transform
// - useImperativeHandle 暴露 imperative API
// - 严格 React 18 Strict Mode 兼容：useEffect 清理 rAF + mousemove + timer

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties
} from 'react';
import { cx } from '../ui/classnames';
import styles from './PixelFace.module.css';

export type PixelFaceState =
  | 'idle'
  | 'thinking'
  | 'happy'
  | 'success'
  | 'error'
  | 'sleep';

export interface PixelFaceHandle {
  setState(state: PixelFaceState, holdMs?: number): void;
  getState(): PixelFaceState;
}

export interface PixelFaceProps {
  className?: string;
  style?: CSSProperties;
  /** 鼠标"近距"半径（px），默认 80。 */
  proximity?: number;
  /** 多久没活动进入 idle 渐变（ms），默认 25000。 */
  idleAfterMs?: number;
  /** 鼠标视线的最大位移（px），默认 3.5。 */
  maxLookOffset?: number;
}

interface MutableRefs {
  face: HTMLDivElement;
  leftEye: HTMLDivElement;
  rightEye: HTMLDivElement;
  mouth: HTMLDivElement;
}

export const PixelFace = forwardRef<PixelFaceHandle, PixelFaceProps>(function PixelFace(
  { className, style, proximity = 80, idleAfterMs = 25000, maxLookOffset = 3.5 },
  forwardedRef
) {
  const [state, setState] = useState<PixelFaceState>('idle');
  const stateRef = useRef<PixelFaceState>('idle');
  const holdUntilRef = useRef<number>(0);

  const faceRef = useRef<HTMLDivElement>(null);
  const leftEyeRef = useRef<HTMLDivElement>(null);
  const rightEyeRef = useRef<HTMLDivElement>(null);
  const mouthRef = useRef<HTMLDivElement>(null);

  stateRef.current = state;

  useImperativeHandle(
    forwardedRef,
    () => ({
      setState(next, holdMs) {
        stateRef.current = next;
        setState(next);
        if (typeof holdMs === 'number' && holdMs > 0) {
          holdUntilRef.current = Date.now() + holdMs;
        } else {
          holdUntilRef.current = 0;
        }
      },
      getState() {
        return stateRef.current;
      }
    }),
    []
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const face = faceRef.current;
    const leftEye = leftEyeRef.current;
    const rightEye = rightEyeRef.current;
    const mouth = mouthRef.current;
    if (!face || !leftEye || !rightEye || !mouth) return;

    const reduced = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;

    let rafId = 0;
    let blinkRaf = 0;
    let mouseX = 0;
    let mouseY = 0;
    let smoothX = 0;
    let smoothY = 0;
    let lastMoveAt = Date.now();
    let nextBlinkAt = Date.now() + (reduced ? 12000 : 3000) + Math.random() * (reduced ? 10000 : 5000);
    let isBlinking = false;
    let blinkPhase: 'idle' | 'closing' | 'closed' | 'opening' = 'idle';
    let blinkStart = 0;
    let thinkPhase = 0;
    let lastThinkSwap = Date.now();
    let lastActivityAt = Date.now();
    let hoverHoldUntil = 0;

    const onMouseMove = (event: MouseEvent) => {
      mouseX = event.clientX;
      mouseY = event.clientY;
      lastMoveAt = Date.now();
      lastActivityAt = Date.now();
    };
    window.addEventListener('mousemove', onMouseMove, { passive: true });

    const applyEyes = (x: number, y: number, scaleY: number) => {
      const transform =
        `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scaleY(${scaleY.toFixed(3)})`;
      leftEye.style.transform = transform;
      rightEye.style.transform = transform;
    };

    const applyMouth = (extra: string) => {
      mouth.style.transform = extra;
    };

    const tick = () => {
      const now = Date.now();
      const rect = face.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = mouseX - cx;
      const dy = mouseY - cy;
      const distance = Math.hypot(dx, dy);
      const isNear = distance < proximity;
      if (isNear) {
        hoverHoldUntil = now + 250;
      }

      // 平滑插值
      const ease = reduced ? 1 : 0.18;
      smoothX += (dx - smoothX) * ease;
      smoothY += (dy - smoothY) * ease;

      const current = stateRef.current;
      const effectiveMaxLook =
        current === 'thinking' ? maxLookOffset * 1.5 : current === 'sleep' ? 0 : maxLookOffset;
      const mag = Math.min(Math.hypot(smoothX, smoothY) / 120, 1);
      const angle = Math.atan2(smoothY, smoothX || 0.0001);
      const lookX = Math.cos(angle) * effectiveMaxLook * mag;
      const lookY = Math.sin(angle) * effectiveMaxLook * mag;

      // thinking：眼睛在 X 方向慢速左右摆动
      if (current === 'thinking') {
        if (now - lastThinkSwap > 900) {
          thinkPhase = thinkPhase === -1 ? 1 : thinkPhase === 1 ? 0 : -1;
          lastThinkSwap = now;
        }
      } else {
        thinkPhase = 0;
      }
      const thinkOffset = current === 'thinking' ? thinkPhase * 3 : 0;

      let eyeScaleY = 1;
      if (current === 'sleep') eyeScaleY = 0.12;
      else if (current === 'happy') eyeScaleY = 0.6;
      else if (current === 'thinking') eyeScaleY = 1;
      else if (current === 'error') eyeScaleY = 0.85;
      else if (current === 'success') eyeScaleY = 1;

      if (isNear && current === 'idle') {
        eyeScaleY = Math.max(eyeScaleY, 1.12);
      }

      // 眨眼状态机：closing → closed → opening → idle
      if (blinkPhase === 'closing') {
        const t = (now - blinkStart) / 50;
        eyeScaleY *= Math.max(1 - t, 0);
        if (t >= 1) {
          blinkPhase = 'closed';
          blinkStart = now;
        }
      } else if (blinkPhase === 'closed') {
        eyeScaleY *= 0;
        if (now - blinkStart > 30) {
          blinkPhase = 'opening';
          blinkStart = now;
        }
      } else if (blinkPhase === 'opening') {
        const t = (now - blinkStart) / 60;
        eyeScaleY *= Math.min(t, 1);
        if (t >= 1) {
          blinkPhase = 'idle';
          isBlinking = false;
        }
      } else if (isBlinking) {
        blinkPhase = 'closing';
        blinkStart = now;
      }

      if (now - lastActivityAt > idleAfterMs && current === 'idle') {
        eyeScaleY = Math.min(eyeScaleY, 0.7);
      }

      applyEyes(lookX + thinkOffset, lookY, eyeScaleY);

      // mouth 视觉：CSS 已用 data-state 切换；这里只覆盖 transform
      if (current === 'error') {
        applyMouth('translateX(-50%) rotate(-8deg)');
      } else {
        applyMouth('translateX(-50%)');
      }

      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    // 眨眼调度：随机间隔
    const blinkLoop = () => {
      const now = Date.now();
      if (now >= nextBlinkAt && !isBlinking && blinkPhase === 'idle') {
        isBlinking = true;
        blinkPhase = 'closing';
        blinkStart = now;
        // 10% 概率连续眨两次
        if (!reduced && Math.random() < 0.1) {
          window.setTimeout(() => {
            if (!isBlinking && blinkPhase === 'idle') {
              isBlinking = true;
              blinkPhase = 'closing';
              blinkStart = Date.now();
            }
          }, 200);
        }
        nextBlinkAt = now + (reduced ? 10000 : 3000) + Math.random() * (reduced ? 10000 : 5000);
      }
      blinkRaf = requestAnimationFrame(blinkLoop);
    };
    blinkRaf = requestAnimationFrame(blinkLoop);

    // hold 状态自动恢复
    const holdChecker = window.setInterval(() => {
      if (holdUntilRef.current > 0 && Date.now() >= holdUntilRef.current) {
        setState('idle');
        holdUntilRef.current = 0;
      }
    }, 500);

    return () => {
      cancelAnimationFrame(rafId);
      if (blinkRaf) cancelAnimationFrame(blinkRaf);
      window.clearInterval(holdChecker);
      window.removeEventListener('mousemove', onMouseMove);
    };
  }, [proximity, idleAfterMs, maxLookOffset]);

  return (
    <div
      ref={faceRef}
      className={cx(styles.face, className)}
      style={style}
      data-state={state}
      role="img"
      aria-label="AI 助手"
      title={titleFor(state)}
    >
      <div ref={leftEyeRef} data-pf="eye" data-side="left" className={styles.eye} aria-hidden="true" />
      <div ref={rightEyeRef} data-pf="eye" data-side="right" className={styles.eye} aria-hidden="true" />
      <div ref={mouthRef} data-pf="mouth" className={styles.mouth} aria-hidden="true" />
    </div>
  );
});

function titleFor(state: PixelFaceState): string {
  switch (state) {
    case 'idle':
      return 'AI 助手 · 安静';
    case 'thinking':
      return 'AI 助手 · 思考中';
    case 'happy':
      return 'AI 助手 · 高兴';
    case 'success':
      return 'AI 助手 · 成功';
    case 'error':
      return 'AI 助手 · 出错';
    case 'sleep':
      return 'AI 助手 · 已休眠';
    default:
      return 'AI 助手';
  }
}
