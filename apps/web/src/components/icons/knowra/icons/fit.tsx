import type { ReactNode } from 'react';

/** 自绘图标统一放大 1.12 倍，配合 1.45 的描边，视觉上约等于 1.6 的线宽并撑满 24 的画布。 */
export const OWN_STROKE = 1.45;

export function Fit({ children }: { children: ReactNode }) {
  return <g transform="translate(12 12) scale(1.12) translate(-12 -12)">{children}</g>;
}
