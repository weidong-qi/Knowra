import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TagGroup } from './index';

describe('V4-04 TagGroup', () => {
  it('renders the tag list and exposes the tags', () => {
    render(
      <TagGroup
        label="标签"
        items={[
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' }
        ]}
      />
    );
    // React Aria 的 TagGroup 渲染为 role="listbox" 的容器；这里只断言内容。
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('toggles selection on click', async () => {
    const user = userEvent.setup();
    render(
      <TagGroup
        label="标签"
        items={[{ id: 'a', label: 'A' }]}
        selectionMode="single"
      />
    );
    const tag = screen.getByText('A');
    await user.click(tag);
    expect(tag.closest('[data-selected]')).toBeTruthy();
  });

  it('renders a visible header by default and respects visibleLabel=false', () => {
    const { rerender } = render(<TagGroup label="资料标签" items={[{ id: 'a', label: 'A' }]} />);
    expect(screen.getByText('资料标签')).toBeInTheDocument();

    rerender(
      <TagGroup label="资料标签" visibleLabel={false} items={[{ id: 'a', label: 'A' }]} />
    );
    // visibleLabel=false 时，标签仍作为 aria-label 存在但 DOM 文本不再出现
    expect(screen.queryByText('资料标签')).toBeNull();
  });

  it('renders trailing slot only when provided', () => {
    const { rerender } = render(
      <TagGroup label="标签" items={[{ id: 'a', label: 'A' }]} trailing="3 / 4" />
    );
    expect(screen.getByText('3 / 4')).toBeInTheDocument();

    rerender(<TagGroup label="标签" items={[{ id: 'a', label: 'A' }]} />);
    expect(screen.queryByText('3 / 4')).toBeNull();
  });

  it('renders the count badge when count is provided', () => {
    render(
      <TagGroup
        label="标签"
        items={[
          { id: 'a', label: 'A', count: 12 },
          { id: 'b', label: 'B' }
        ]}
      />
    );
    expect(screen.getByText('12')).toBeInTheDocument();
    // B 没有 count，不应渲染数字 0
    expect(screen.queryByText('0')).toBeNull();
  });

  it('hides the leading dot when hideDot is true', () => {
    const { container } = render(
      <TagGroup
        label="标签"
        items={[
          { id: 'a', label: '带点' },
          { id: 'b', label: '无点', hideDot: true }
        ]}
      />
    );
    const tagButtons = container.querySelectorAll('[data-rac][role="presentation"], [class*="tag"]');
    // 直接通过 class 计数来断言：tagDot 只出现在第一个 tag 内
    const dots = container.querySelectorAll('[class*="tagDot"]');
    expect(dots.length).toBe(1);
  });

  it('applies tone class based on item.tone', () => {
    const { container } = render(
      <TagGroup
        label="标签"
        items={[
          { id: 'a', label: '主色', tone: 'accent' },
          { id: 'b', label: '危险', tone: 'danger' }
        ]}
      />
    );
    expect(container.querySelector('[class*="toneAccent"]')).toBeInTheDocument();
    expect(container.querySelector('[class*="toneDanger"]')).toBeInTheDocument();
  });
});
