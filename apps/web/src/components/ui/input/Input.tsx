// V4-04 TextField + Input
//
// 1. Knowra TextField 接受 label / description / errorMessage / isRequired / isInvalid；
// 2. 视觉与 ARIA 完全交给 React Aria；
// 3. 业务代码只能使用本封装，**不直接使用 react-aria-components 的 TextField / Input**。

import { forwardRef, type ReactNode } from 'react';
import {
  FieldError,
  Input as RAInput,
  Label,
  Text,
  TextField as RATextField,
  type TextFieldProps as RATextFieldProps
} from 'react-aria-components';
import { cx } from '../classnames';
import { SearchSurface, searchBoxStyles } from './SearchBox';
import styles from './Input.module.css';

export interface TextFieldProps extends Omit<RATextFieldProps, 'className' | 'children'> {
  label: string;
  description?: string;
  errorMessage?: string | ((validation: { isInvalid: boolean; validationErrors?: string[] }) => string);
  placeholder?: string;
  isRequired?: boolean;
  isInvalid?: boolean;
  isDisabled?: boolean;
  className?: string;
  inputClassName?: string;
  type?: 'text' | 'email' | 'password' | 'number' | 'tel' | 'url' | 'search';
  children?: (childProps: { input: typeof RAInput; label: typeof Label; description: typeof Text; error: typeof FieldError }) => ReactNode;
}

export const TextField = forwardRef<HTMLDivElement, TextFieldProps>(function TextField(
  {
    label,
    description,
    errorMessage,
    isRequired = false,
    isInvalid,
    isDisabled,
    placeholder,
    className,
    inputClassName,
    type = 'text',
    children,
    ...rest
  },
  ref
) {
  return (
    <RATextField
      ref={ref}
      isRequired={isRequired}
      isInvalid={isInvalid}
      isDisabled={isDisabled}
      className={cx(styles.field, className)}
      {...rest}
    >
      <Label className={styles.label}>
        {label}
        {isRequired ? <span className={styles.required} aria-hidden="true">*</span> : null}
      </Label>
      {description ? (
        <Text slot="description" className={styles.description}>
          {description}
        </Text>
      ) : null}
      {type === 'search' ? <SearchSurface disabled={isDisabled} invalid={isInvalid}>
        {children ? children({ input: RAInput, label: Label, description: Text, error: FieldError }) :
          <RAInput type={type} placeholder={placeholder} className={cx(searchBoxStyles.input, inputClassName)} data-input-control="true" />}
      </SearchSurface> : <div className={styles.inputShell} data-input-shadow-owner="true">
        {children ? children({ input: RAInput, label: Label, description: Text, error: FieldError }) :
          <RAInput type={type} placeholder={placeholder} className={cx(styles.input, inputClassName)} data-input-control="true" />}
      </div>}
      {errorMessage ? (
        <FieldError className={styles.error}>{errorMessage}</FieldError>
      ) : null}
    </RATextField>
  );
});
