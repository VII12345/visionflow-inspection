/** 全项目共用表单/表格样式常量，避免各处复制字符串导致样式漂移。 */

export const inputClass =
  'w-full bg-white border border-gray-300 rounded-md px-3 py-2 text-[13px] text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-colors placeholder:text-text-tertiary';

export const labelClass = 'text-xs text-text-secondary mb-1.5 block';

export const thClass =
  'px-4 py-2.5 text-left text-[11px] font-medium text-text-tertiary uppercase tracking-wide';

export const editInputClass =
  'bg-white border border-gray-200 rounded-md px-2 py-1.5 text-[13px] text-text-primary outline-none focus:border-accent';

/** 紧凑输入框（工具栏筛选等小尺寸场景）。 */
export const inputClassCompact =
  'bg-white border border-gray-300 rounded-md px-2.5 py-1.5 text-[12px] text-text-primary outline-none focus:border-accent';

/** 紧凑标签（间距更小）。 */
export const labelClassCompact = 'text-xs text-text-secondary mb-1 block';
