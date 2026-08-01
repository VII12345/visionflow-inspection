import React from 'react';
import type { HardwareInfo } from './useHardwareInfo';

interface Props {
  checks: HardwareInfo['checks'];
}

/** 硬件达标检测汇总。 */
export const HardwareCheckSummary: React.FC<Props> = ({ checks }) => {
  if (!checks) return null;
  return (
    <div className="mb-4">
      <div className="text-[10px] text-text-tertiary uppercase tracking-wide mb-2">达标检测</div>
      <div className="bg-gray-50 rounded-md p-3 space-y-1.5">
        {Object.entries(checks)
          .filter(([k]) => k !== '_all_pass')
          .map(([key, check]) => (
            <div key={key} className="flex justify-between items-center text-xs">
              <span className="text-text-secondary">{check.label}</span>
              <span className={`font-medium ${check.pass ? 'text-ok' : 'text-ng'}`}>
                {check.pass ? '通过' : '未达标'}
              </span>
            </div>
          ))}
        <div className="border-t border-gray-200 pt-1.5 mt-1 flex justify-between items-center text-xs">
          <span className="text-text-primary font-semibold">综合评估</span>
          <span className={`font-semibold ${checks._all_pass ? 'text-ok' : 'text-ng'}`}>
            {checks._all_pass ? '全部通过' : '部分未达标'}
          </span>
        </div>
      </div>
    </div>
  );
};
