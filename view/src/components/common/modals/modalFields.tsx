import React from 'react';
import { FieldHint } from '../FieldHint';
import { inputClass, labelClass } from '../uiClasses';

export { inputClass, labelClass };

interface ModalTextFieldProps {
  label: string;
  hint: string;
  type?: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  onEnter?: () => void;
}

/** 带说明提示的单行文本输入字段。 */
export const ModalTextField: React.FC<ModalTextFieldProps> = ({
  label,
  hint,
  type = 'text',
  placeholder,
  value,
  onChange,
  onEnter,
}) => (
  <div>
    <label className={labelClass}><FieldHint text={hint}>{label}</FieldHint></label>
    <input
      type={type}
      placeholder={placeholder}
      value={value}
      onChange={e => onChange(e.target.value)}
      onKeyDown={e => e.key === 'Enter' && onEnter && onEnter()}
      className={inputClass}
    />
  </div>
);
