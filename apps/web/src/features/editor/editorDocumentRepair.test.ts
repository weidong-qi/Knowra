import { describe, expect, it } from 'vitest';
import { inspectAndRepairMarkdown } from './editorDocumentRepair';

describe('editorDocumentRepair', () => {
  it('removes standalone backslashes and collapses excessive blank lines', () => {
    const result = inspectAndRepairMarkdown('正文\n\n\n\\\n\n\n结尾');
    expect(result.markdown).toBe('正文\n\n结尾');
    expect(result.report).toEqual({
      excessiveBlankLines: 3,
      standaloneBackslashes: 1,
      total: 4
    });
    expect(result.changed).toBe(true);
  });

  it('preserves fenced code content and valid hard breaks', () => {
    const markdown = ['正文\\', '换行', '', '```txt', '```not-a-closing-fence', '\\', '', '', '```'].join('\n');
    expect(inspectAndRepairMarkdown(markdown)).toEqual({
      markdown,
      changed: false,
      report: { excessiveBlankLines: 0, standaloneBackslashes: 0, total: 0 }
    });
  });

  it('keeps the original CRLF convention', () => {
    expect(inspectAndRepairMarkdown('A\r\n\r\n\r\nB').markdown).toBe('A\r\n\r\nB');
  });
});
