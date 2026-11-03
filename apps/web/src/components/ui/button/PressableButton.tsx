import { forwardRef, useEffect, useImperativeHandle, useRef, type AriaRole, type ReactNode } from 'react';
import { Button as RAButton, type ButtonProps as RAButtonProps } from 'react-aria-components';

export interface PressableButtonProps extends Omit<RAButtonProps, 'className' | 'children'> {
  children: ReactNode;
  className?: string;
  /** 业务需要组合 tab/treeitem 等原生语义时显式透传。 */
  role?: AriaRole;
  tabIndex?: number;
  title?: string;
  'aria-selected'?: boolean;
  /** menuitemcheckbox / menuitemradio 的选中状态。 */
  'aria-checked'?: boolean;
}

/**
 * 仅提供 React Aria 的按压与焦点契约，不附加任何视觉样式。
 * 适用于目录树、列表行等由业务 CSS Module 完整定义外观的按钮。
 */
export const PressableButton = forwardRef<HTMLButtonElement, PressableButtonProps>(
  function PressableButton({ children, type, role, tabIndex, title, 'aria-selected': ariaSelected, 'aria-checked': ariaChecked, ...rest }, ref) {
    const buttonRef = useRef<HTMLButtonElement>(null);
    useImperativeHandle(ref, () => buttonRef.current as HTMLButtonElement);
    useEffect(() => {
      const button = buttonRef.current;
      if (!button) return;
      if (role) button.setAttribute('role', role);
      else button.removeAttribute('role');
      if (tabIndex !== undefined) button.tabIndex = tabIndex;
      if (title) button.title = title;
      else button.removeAttribute('title');
      if (ariaSelected !== undefined) button.setAttribute('aria-selected', String(ariaSelected));
      else button.removeAttribute('aria-selected');
      if (ariaChecked !== undefined) button.setAttribute('aria-checked', String(ariaChecked));
      else button.removeAttribute('aria-checked');
    }, [ariaChecked, ariaSelected, role, tabIndex, title]);
    return (
      <RAButton ref={buttonRef} type={type ?? 'button'} {...rest}>
        {children}
      </RAButton>
    );
  }
);
