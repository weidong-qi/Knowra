import { forwardRef } from 'react';
import { Button as RAButton, type ButtonProps } from 'react-aria-components';
import styles from './CardButton.module.css';

/** 内容卡片的单一整卡操作；子内容不得包含其它交互控件。 */
export const CardButton = forwardRef<HTMLButtonElement, ButtonProps>(function CardButton({ className, ...props }, ref) {
  return <RAButton {...props} ref={ref} className={state => `${styles.card} ${typeof className === 'function' ? className(state) : className ?? ''}`} />;
});
