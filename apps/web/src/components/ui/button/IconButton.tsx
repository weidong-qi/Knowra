// 图标按钮：tone=ghost 透明（密集工具栏/行内）、floating 通透玻璃圆形（新建/编辑入口）、primary 柔橙实心（主操作）。
// 通过背景与光影反馈状态，不移动控件；保留键盘焦点与触屏点击区域。

import { forwardRef, useEffect, useImperativeHandle, useRef, type ReactNode } from 'react';
import { Button as RAButton, type ButtonProps as RAButtonProps } from 'react-aria-components';
import { cx } from '../classnames';
import styles from './IconButton.module.css';

export interface IconButtonProps
  extends Omit<RAButtonProps, 'children' | 'aria-label' | 'className'> {
  /**
   * 必填：a11y 标签。按钮内容只有图标，必须有 aria-label 才能被屏读器识别。
   * （HTML 原生 aria-label 是 string|undefined，这里收紧为 string 强制填写。）
   */
  'aria-label': string;
  /** 必填：图标 SVG。业务代码统一从 `components/icons/knowra` 选择。 */
  children: ReactNode;
  /**
   * 容器尺寸（px），决定方块边长。常见值：
   * - 30：侧栏头部、Tab 端点；
   * - 28：顶部浏览历史；
   * - 40：与左轨 ModuleRail 内部网格对齐；
   * - 24：紧凑列表行内嵌。
   * @default 30
   */
  size?: 24 | 28 | 30 | 40;
  tone?: 'ghost' | 'floating' | 'primary';
  /** 与 Button 一致的禁用入口。 */
  isDisabled?: boolean;
  /** 兼容原生按钮调用方式；内部映射为 React Aria 的 isDisabled。 */
  disabled?: boolean;
  className?: string;
  title?: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      'aria-label': ariaLabel,
      children,
      size = 30,
      tone = 'ghost',
      disabled,
      isDisabled,
      className,
      title,
      type,
      ...rest
    },
    ref
  ) {
    const buttonRef = useRef<HTMLButtonElement>(null);
    useImperativeHandle(ref, () => buttonRef.current as HTMLButtonElement);
    useEffect(() => {
      if (!buttonRef.current) return;
      if (title) buttonRef.current.title = title;
      else buttonRef.current.removeAttribute('title');
    }, [title]);
    return (
      <RAButton
        ref={buttonRef}
        type={type ?? 'button'}
        className={cx(styles.base, styles[`size${size}`], tone !== 'ghost' && styles[tone], className)}
        isDisabled={disabled ?? isDisabled}
        aria-label={ariaLabel}
        {...rest}
      >
        {children}
      </RAButton>
    );
  }
);
