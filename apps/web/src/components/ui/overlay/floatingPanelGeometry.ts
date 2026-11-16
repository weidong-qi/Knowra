export interface FloatingPoint {
  x: number;
  y: number;
}
export interface FloatingBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 坐标属于阅读视口，不属于滚动的 PDF 页面。窄窗口也保留可达的标题栏。 */
export function clampFloatingPoint(
  point: FloatingPoint,
  size: { width: number; height: number },
  bounds: FloatingBounds
): FloatingPoint {
  const inset = 12;
  return {
    x: Math.max(inset, Math.min(point.x, Math.max(inset, bounds.width - size.width - inset))),
    y: Math.max(inset, Math.min(point.y, Math.max(inset, bounds.height - size.height - inset)))
  };
}
