import { forwardRef } from 'react';
import { FieldError, Label, Text, TextArea as RATextArea, TextField as RATextField, type TextFieldProps as RATextFieldProps } from 'react-aria-components';
import { cx } from '../classnames';
import styles from './Input.module.css';

export interface TextAreaFieldProps extends Omit<RATextFieldProps, 'className' | 'children'> {
  label: string;
  presentation?: 'field' | 'composer';
  description?: string;
  errorMessage?: string;
  placeholder?: string;
  rows?: number;
  className?: string;
}

export const TextAreaField = forwardRef<HTMLDivElement, TextAreaFieldProps>(function TextAreaField(
  { label, presentation = 'field', description, errorMessage, placeholder, rows = 3, className, isRequired, ...rest }, ref
) {
  return <RATextField ref={ref} isRequired={isRequired} className={cx(styles.field, presentation === 'composer' && styles.composerField, className)} {...rest}>
    <Label className={cx(styles.label, presentation === 'composer' && styles.visuallyHidden)}>{label}{isRequired ? <span className={styles.required} aria-hidden="true">*</span> : null}</Label>
    {description ? <Text slot="description" className={styles.description}>{description}</Text> : null}
    <div className={cx(styles.inputShell, styles.textareaShell)} data-input-shadow-owner="true">
      <RATextArea className={styles.textarea} rows={rows} placeholder={placeholder} data-input-control="true" />
    </div>
    {errorMessage ? <FieldError className={styles.error}>{errorMessage}</FieldError> : null}
  </RATextField>;
});
