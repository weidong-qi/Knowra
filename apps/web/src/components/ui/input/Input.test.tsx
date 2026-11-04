import { createRef, useState } from 'react';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Checkbox, SearchBox, Select, TextAreaField, TextField } from './index';

describe('V4-04 TextField', () => {
  it('associates label and input', () => {
    render(<TextField label="标题" />);
    const input = screen.getByLabelText('标题');
    expect(input).toBeInTheDocument();
  });

  it('marks required fields with the asterisk and aria-required', () => {
    render(<TextField label="标题" isRequired />);
    const input = screen.getByLabelText(/标题/);
    expect(input).toBeRequired();
  });

  it('renders the error message when isInvalid is set', () => {
    render(<TextField label="标题" isInvalid errorMessage="标题已被占用" defaultValue="重复" />);
    expect(screen.getByText('标题已被占用')).toBeInTheDocument();
    expect(screen.getByLabelText('标题')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('标题')).toHaveAccessibleDescription('标题已被占用');
  });

  it('keeps shadow ownership on the outer shell, not the native input', () => {
    render(<TextField label="标题" />);
    const input = screen.getByLabelText('标题');
    const shell = input.closest('[data-input-shadow-owner="true"]');

    expect(shell).toBeTruthy();
    expect(shell).not.toBe(input);
    expect(input).toHaveAttribute('data-input-control', 'true');
  });

  it('keeps the invalid shell contract when the field also receives focus', async () => {
    const user = userEvent.setup();
    render(<TextField label="标题" isInvalid errorMessage="标题错误" />);
    const input = screen.getByLabelText('标题');
    await user.click(input);

    const field = input.closest('[data-invalid]');
    const shell = input.closest('[data-input-shadow-owner="true"]');
    expect(field).toBeTruthy();
    expect(shell).toBeTruthy();
    expect(input).toHaveAttribute('data-input-control', 'true');
  });
});

describe('共享多行字段', () => {
  it('keeps the label and controlled value connected during editing', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TextAreaField label="核心陈述" value="原文" onChange={onChange} rows={5} maxLength={2000} />);
    const input = screen.getByRole('textbox', { name: '核心陈述' });
    expect(input).toHaveValue('原文');
    expect(input).toHaveAttribute('rows', '5');
    expect(input).toHaveAttribute('maxLength', '2000');
    await user.type(input, '新');
    expect(onChange).toHaveBeenCalled();
  });
});

describe('V4-04 SearchBox', () => {
  it('uses the label as the searchbox accessible name', () => {
    render(<SearchBox label="搜索" size="field" placeholder="按标题、标签或正文" />);
    const input = screen.getByRole('searchbox', { name: '搜索' });
    expect(input).toHaveAccessibleName('搜索');
    expect(screen.getByLabelText('搜索')).toBe(input);
  });

  it('forwards native change events and keeps typed value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SearchBox label="搜索" size="field" placeholder="关键词" onChange={onChange} />);
    const input = screen.getByLabelText('搜索') as HTMLInputElement;
    await user.type(input, 'hello');
    expect(input.value).toBe('hello');
    expect(onChange).toHaveBeenCalledTimes(5);
  });

  it('shows the clear button only when the caller supplies onClear, and clears through it', async () => {
    const user = userEvent.setup();
    function Demo() {
      const [value, setValue] = useState('');
      return <SearchBox label="搜索" size="field" value={value} onChange={event => setValue(event.target.value)} onClear={value ? () => setValue('') : undefined} />;
    }
    render(<Demo />);
    const input = screen.getByLabelText('搜索') as HTMLInputElement;
    expect(screen.queryByTestId('search-clear')).toBeNull();
    await user.type(input, '印格');
    expect(input.value).toBe('印格');
    await user.click(screen.getByTestId('search-clear'));
    expect(input.value).toBe('');
    expect(screen.queryByTestId('search-clear')).toBeNull();
  });

  it('uses the search shell as the only shadow owner', () => {
    render(<SearchBox label="搜索" size="field" />);
    const input = screen.getByLabelText('搜索');
    const shell = input.closest('[data-input-shadow-owner="true"]');
    expect(shell).toBeTruthy();
    expect(shell).not.toBe(input);
    expect(input).toHaveAttribute('data-input-control', 'true');
  });
});

describe('共享搜索框', () => {
  it('lets page search and form search use the same visual shell while preserving native input focus', async () => {
    const ref = createRef<HTMLInputElement>();
    render(<><SearchBox ref={ref} label="搜索笔记索引" shortcut="⌘ K" /><SearchBox label="搜索标签" size="field" /></>);

    const pageInput = screen.getByRole('searchbox', { name: '搜索笔记索引' });
    const fieldInput = screen.getByRole('searchbox', { name: /搜索标签/ });
    const pageShell = pageInput.closest('[data-input-shadow-owner="true"]');
    const fieldShell = fieldInput.closest('[data-input-shadow-owner="true"]');
    expect(pageShell).toHaveAttribute('data-size', 'toolbar');
    expect(fieldShell).toHaveAttribute('data-size', 'field');
    expect(pageShell?.className).toBe(fieldShell?.className);
    expect(screen.getByText('⌘ K')).toBeInTheDocument();
    expect(ref.current).toBe(pageInput);
    const user = userEvent.setup();
    await user.click(pageShell as HTMLElement);
    expect(pageInput).toHaveFocus();
  });
});

it('仅在共享清除按钮存在时标记隐藏原生清除入口', () => {
  const { rerender } = render(<SearchBox label="搜索" />);
  const shell = screen.getByRole('searchbox').parentElement;
  expect(shell).not.toHaveAttribute('data-custom-clear');
  rerender(<SearchBox label="搜索" onClear={() => undefined} />);
  expect(shell).toHaveAttribute('data-custom-clear', 'true');
  expect(screen.getAllByRole('button', { name: '清除搜索' })).toHaveLength(1);
  rerender(<SearchBox label="搜索" />);
  expect(shell).not.toHaveAttribute('data-custom-clear');
});

describe('V4-04 Checkbox', () => {
  it('toggles selected state on click', async () => {
    const user = userEvent.setup();
    render(<Checkbox>记住我</Checkbox>);
    const checkbox = screen.getByRole('checkbox', { name: '记住我' });
    expect(checkbox).not.toBeChecked();
    await user.click(checkbox);
    expect(checkbox).toBeChecked();
  });

  it('exposes indeterminate state when isIndeterminate is set', () => {
    render(<Checkbox isIndeterminate>混合</Checkbox>);
    const checkbox = screen.getByRole('checkbox', { name: '混合' });
    // React Aria 通过 data-indeterminate 表达未决状态，aria-checked 仍可能为 false。
    const wrapper = checkbox.closest('[data-indeterminate]');
    expect(wrapper).toBeTruthy();
  });
});

describe('V4-04 Select', () => {
  it('keeps a toolbar filter accessible and updates its selection', async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    render(<Select presentation="toolbar" label="按分组筛选" selectedKey="all" onSelectionChange={onSelectionChange} options={[{ id: 'all', label: '全部分组' }, { id: 'one', label: '普通标签' }]} />);
    const trigger = screen.getByRole('button', { name: /按分组筛选/ });
    await user.click(trigger);
    await user.click(screen.getByRole('option', { name: '普通标签' }));
    expect(onSelectionChange).toHaveBeenCalledWith('one');
  });
  it('opens a listbox popover and selects an option', async () => {
    const user = userEvent.setup();
    render(
      <Select
        label="排序"
        defaultSelectedKey="updated"
        options={[
          { id: 'updated', label: '按更新时间' },
          { id: 'created', label: '按创建时间' }
        ]}
      />
    );

    const trigger = screen.getByRole('button', { name: /排序/ });
    await user.click(trigger);
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    const option = screen.getByRole('option', { name: '按创建时间' });
    await user.click(option);
    expect(trigger).toHaveTextContent('按创建时间');
  });

  it('uses the select trigger as its single visible input shadow owner', () => {
    render(
      <Select
        label="排序"
        isInvalid
        errorMessage="排序无效"
        options={[{ id: 'updated', label: '按更新时间' }]}
      />
    );
    const trigger = screen.getByRole('button', { name: /排序/ });
    expect(trigger).toHaveAttribute('data-input-shadow-owner', 'true');
    expect(trigger.closest('[data-invalid]')).toBeTruthy();
  });
});
