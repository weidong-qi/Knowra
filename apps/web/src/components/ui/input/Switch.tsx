// Switch：显示选项等即时生效的开关；选中态沿用主色。

import { forwardRef, type ReactNode } from 'react';
import { Switch as RASwitch, type SwitchProps as RASwitchProps } from 'react-aria-components';
import { cx } from '../classnames';
import styles from './Input.module.css';

export interface SwitchProps extends Omit<RASwitchProps, 'className' | 'children'> {
  children: ReactNode;
  className?: string;
}

export const Switch = forwardRef<HTMLLabelElement, SwitchProps>(function Switch({ children, className, ...rest }, ref) {
  return <RASwitch ref={ref} className={cx(styles.switch, className)} {...rest}>
    <span className={styles.switchLabel}>{children}</span>
    <span className={styles.switchTrack} aria-hidden="true"><span className={styles.switchThumb} /></span>
  </RASwitch>;
});
