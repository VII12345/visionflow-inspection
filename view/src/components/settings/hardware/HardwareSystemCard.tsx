import React from 'react';
import type { HardwareInfo } from './useHardwareInfo';

interface Props {
  hardware: HardwareInfo;
}

/** 系统环境信息卡片。 */
export const HardwareSystemCard: React.FC<Props> = ({ hardware }) => {
  const { system } = hardware;
  return (
    <div className="mb-4">
      <div className="text-[10px] text-text-tertiary uppercase tracking-wide mb-2">系统环境</div>
      <div className="bg-gray-50 rounded-md p-3 space-y-1.5">
        <div className="flex justify-between text-xs">
          <span className="text-text-tertiary">操作系统</span>
          <span className="text-text-primary font-medium">{system.os ?? '--'} {system.os_release ?? ''}</span>
        </div>
        {system.hostname && (
          <div className="flex justify-between text-xs">
            <span className="text-text-tertiary">主机名</span>
            <span className="text-text-primary font-medium">{system.hostname}</span>
          </div>
        )}
        <div className="flex justify-between text-xs">
          <span className="text-text-tertiary">Python</span>
          <span className="text-text-primary font-medium">{system.python_version ?? '--'}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-text-tertiary">PyTorch</span>
          <span className="text-text-primary font-medium">{hardware.pytorch_version}</span>
        </div>
      </div>
    </div>
  );
};
