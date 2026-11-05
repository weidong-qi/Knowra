import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TAG_PRESET_COLORS, parseTagColor } from '../src/tag-colors.js';

test('标签颜色保留预设、兼容旧名称并规范六位自定义色', () => {
  for (const color of TAG_PRESET_COLORS) assert.equal(parseTagColor(color), color);
  assert.equal(parseTagColor('CYAN'), 'blue');
  assert.equal(parseTagColor('slate'), 'neutral');
  assert.equal(parseTagColor('amber'), 'orange');
  for (const color of ['#3c68ff', '#000000', '#ffffff']) assert.equal(parseTagColor(color), color);
  assert.equal(parseTagColor(' #Ab12EF '), '#ab12ef');
});

test('标签颜色拒绝短码、透明度、CSS 表达式与非字符串', () => {
  for (const value of [
    '#fff',
    '#12345678',
    '#gg0000',
    'transparent',
    'rgb(1,2,3)',
    'var(--accent)',
    'url(x)',
    '__proto__',
    'constructor',
    '',
    null,
    undefined,
    123456,
    { toString: () => '#123456' }
  ]) {
    assert.equal(parseTagColor(value), null);
  }
});
