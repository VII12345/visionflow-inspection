import React from 'react';

interface FieldHintProps {
  text: string;
  children: React.ReactNode;
}

/** 用户可见字段的轻量说明气泡，悬停标签或字段名即可查看填写建议。 */
export const FieldHint: React.FC<FieldHintProps> = ({ text, children }) => (
  <span className="group relative inline-flex items-center gap-1 cursor-help">
    <span>{children}</span>
    <span className="inline-flex w-3.5 h-3.5 items-center justify-center rounded-full border border-gray-300 text-[9px] text-text-tertiary">?</span>
    <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden w-64 rounded-md bg-gray-900 px-3 py-2 text-[11px] font-normal leading-5 text-white shadow-lg group-hover:block">
      {text}
    </span>
  </span>
);
