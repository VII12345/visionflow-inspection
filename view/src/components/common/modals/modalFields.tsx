import React from 'react';
import { FieldHint } from '../FieldHint';

export const inputClass =
  'w-full bg-white border border-gray-300 rounded-md px-3 py-2 text-[13px] text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-colors placeholder:text-text-tertiary';

export const labelClass = 'text-xs text-text-secondary mb-1.5 block';

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
