import React from 'react';

/** 表格空数据提示行。 */
export const EmptyState: React.FC<{ colSpan: number; message: string }> = ({ colSpan, message }) => (
  <tr>
    <td colSpan={colSpan} className="px-4 py-8 text-center text-text-tertiary text-xs">
      {message}
    </td>
  </tr>
);
