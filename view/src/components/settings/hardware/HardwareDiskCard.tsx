import React from 'react';
import type { HardwareInfo } from './useHardwareInfo';

interface Props {
  hardware: HardwareInfo;
}

/** 项目硬盘信息卡片。 */
export const HardwareDiskCard: React.FC<Props> = ({ hardware }) => {
  const { disk } = hardware;
  const pass = hardware.checks?.disk_free?.pass;
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="text-[10px] text-text-tertiary uppercase tracking-wide">项目硬盘</div>
        {pass != null && (
          <span className={`text-[10px] font-medium ${pass ? 'text-ok' : 'text-ng'}`}>
            {pass ? '已达标' : '未达标'}
          </span>
        )}
      </div>
      <div className="bg-gray-50 rounded-md p-3 space-y-1.5">
        {disk.project_drive && (
          <div className="flex justify-between text-xs">
            <span className="text-text-tertiary">路径</span>
            <span className="text-text-primary font-medium truncate ml-4 max-w-[180px]">{disk.project_drive}</span>
          </div>
        )}
        {disk.filesystem && (
          <div className="flex justify-between text-xs">
            <span className="text-text-tertiary">文件系统</span>
            <span className="text-text-primary font-medium">{disk.filesystem}</span>
          </div>
        )}
        <div className="flex justify-between text-xs">
          <span className="text-text-tertiary">总容量</span>
          <span className="text-text-primary font-medium">{disk.total_gb ?? '--'} GB</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-text-tertiary">已使用</span>
          <span className="text-text-primary font-medium">{disk.used_gb ?? '--'} GB</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-text-tertiary">可用空间</span>
          <span className={`font-medium ${disk.free_gb != null && disk.free_gb < 10 ? 'text-warn' : 'text-text-primary'}`}>{disk.free_gb ?? '--'} GB</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-text-tertiary">使用率</span>
          <span className={`font-medium ${disk.percent != null && disk.percent > 80 ? 'text-warn' : 'text-text-primary'}`}>{disk.percent ?? '--'}%</span>
        </div>
      </div>
    </div>
  );
};
