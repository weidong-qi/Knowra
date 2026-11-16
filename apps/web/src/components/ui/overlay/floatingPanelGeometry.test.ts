import { clampFloatingPoint } from './floatingPanelGeometry';

it('拖动坐标限制在阅读区内，缩小窗口后标题仍可达', () => {
  const bounds = { left: 100, top: 50, width: 800, height: 600 };
  expect(clampFloatingPoint({ x: -30, y: 900 }, { width: 320, height: 220 }, bounds)).toEqual({ x: 12, y: 368 });
  expect(
    clampFloatingPoint({ x: 600, y: 500 }, { width: 320, height: 220 }, { ...bounds, width: 300, height: 200 })
  ).toEqual({ x: 12, y: 12 });
});
