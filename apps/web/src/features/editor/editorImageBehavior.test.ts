import { expect, it, vi } from 'vitest';
import { imageHtmlWithRenderedSizes } from './editorImageBehavior';

it('HTML 导出保留同一附件多次插入的独立实际尺寸和替代说明', () => {
  const dom = document.createElement('div');
  dom.innerHTML = '<img src="/same" data-editor-image><img src="/same" data-editor-image>';
  const images = dom.querySelectorAll('img');
  vi.spyOn(images[0], 'getBoundingClientRect').mockReturnValue({ width: 40 } as DOMRect);
  vi.spyOn(images[1], 'getBoundingClientRect').mockReturnValue({ width: 66 } as DOMRect);
  const html = imageHtmlWithRenderedSizes('<p>正文<img src="/same" alt="第一张" style="width:40%;max-width:100%;height:auto"><img src="/same" alt="第二张" style="width:66%;max-width:100%;height:auto"></p>', { dom });
  const exported = new DOMParser().parseFromString(html, 'text/html').querySelectorAll('img');
  expect(exported[0].style.width).toBe('40px');
  expect(exported[1].style.width).toBe('66px');
  expect(exported[0].alt).toBe('第一张'); expect(exported[1].alt).toBe('第二张');
  expect(exported[0].style.maxWidth).toBe('100%');
});
