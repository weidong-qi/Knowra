import { expect, it, vi } from 'vitest';
import { downloadReview } from './downloadReview';
it('下载为 JSON Blob，固定安全文件名且回收对象 URL', () => {
  vi.useFakeTimers();
  const create = vi.fn((_blob: Blob) => 'blob:synthetic'); const revoke = vi.fn();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
  let filename = ''; const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { filename = this.download; });
  try {
    downloadReview('{"approval":"not-granted"}');
    expect(create.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(filename).toBe('knowra-unapproved-review-draft.json');
    expect(document.querySelector('a[download]')).toBeNull();
    vi.runAllTimers(); expect(revoke).toHaveBeenCalledWith('blob:synthetic');
  } finally { click.mockRestore(); vi.unstubAllGlobals(); vi.useRealTimers(); }
});
