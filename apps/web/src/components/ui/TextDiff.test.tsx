import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextDiff } from './TextDiff';
import { buildTextDiff } from './textDiffModel';
import { downloadTextFile } from '../../browser/downloadFile';

vi.mock('../../browser/downloadFile', () => ({ downloadTextFile: vi.fn() }));

describe('正文差异', () => {
  it('保留增删顺序、空行和行号，双方均可从差异重建', () => {
    const examples = [
      ['共同开头\n旧段落\n\n保留\n结尾', '共同开头\n新段落\n\n新增\n保留\n结尾'],
      ['', '新建'], ['删除\n', ''], ['重复\n甲\n重复\n乙', '重复\n重复\n丙\n乙']
    ];
    for (const [before, after] of examples) {
      const diff = buildTextDiff(before, after);
      expect(diff.lines.filter(line => line.kind !== 'added').map(line => line.text).join('\n')).toBe(before);
      expect(diff.lines.filter(line => line.kind !== 'removed').map(line => line.text).join('\n')).toBe(after);
      expect(diff.limited).toBe(false);
    }
    expect(buildTextDiff('甲\n乙', '甲\n丙\n乙').lines).toContainEqual({ kind: 'added', text: '丙', afterLine: 2 });
  });

  it('同时显示文字增删标记，不执行正文中的 HTML', () => {
    const { container } = render(<TextDiff before={'共同\n旧内容'} after={'共同\n<img src=x onerror=alert(1)>'} beforeLabel="本机" afterLabel="云端" />);
    expect(container.querySelector('[data-diff="removed"]')).toHaveTextContent('旧内容');
    expect(container.querySelector('[data-diff="added"]')).toHaveTextContent('<img src=x onerror=alert(1)>');
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByLabelText('原文独有')).toHaveTextContent('−');
    expect(screen.getByLabelText('新文独有')).toHaveTextContent('+');
  });

  it('折叠长未变区域并保留末尾变动', async () => {
    const prefix = Array.from({ length: 40 }, (_, i) => `共同第${i}行`).join('\n');
    render(<TextDiff before={`${prefix}\n旧结尾`} after={`${prefix}\n新结尾`} />);
    expect(screen.queryByText('共同第20行')).not.toBeInTheDocument();
    expect(screen.getByText('新结尾')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '展开未变内容' }));
    expect(screen.getByText('共同第20行')).toBeInTheDocument();
  });

  it('大规模变更使用有界回退，部分对比明确提示且可下载完整正文', async () => {
    const before = '旧\n'.repeat(2_100);
    const after = '新\n'.repeat(2_100);
    const diff = buildTextDiff(before, after);
    expect(diff.simplified).toBe(true);
    expect(diff.limited).toBe(true);
    const { container } = render(<TextDiff before={before} after={after} beforeLabel="本机" afterLabel="云端" />);
    expect(container.querySelectorAll('[data-diff]').length).toBeLessThanOrEqual(500);
    expect(screen.getByText(/未显示的内容仍可能存在差异/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '下载云端正文' }));
    expect(downloadTextFile).toHaveBeenCalledWith('云端.md', after, 'text/markdown');
  });

  it('截断区外仍有差异时不会宣称正文一致', () => {
    const prefix = '甲'.repeat(120_001);
    render(<TextDiff before={`${prefix}乙`} after={`${prefix}丙`} />);
    expect(screen.queryByText('正文一致')).not.toBeInTheDocument();
    expect(screen.getByText(/当前仅展示部分对比/)).toBeInTheDocument();
  });
});
