import React from 'react';
import type { HardwareInfo } from './useHardwareInfo';

interface Props {
  hardware: HardwareInfo;
}

/** 处理器 (CPU) 信息卡片。 */
export const HardwareCpuCard: React.FC<Props> = ({ hardware }) => {
  const { cpu } = hardware;
  const pass = hardware.checks?.cpu_cores?.pass;
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="text-[10px] text-text-tertiary uppercase tracking-wide">处理器 (CPU)</div>
        {pass != null && (
          <span className={`text-[10px] font-medium ${pass ? 'text-ok' : 'text-ng'}`}>
            {pass ? '已达标' : '未达标'}
          </span>
        )}
      </div>
      <div className="bg-gray-50 rounded-md p-3 space-y-1.5">
        <div className="flex justify-between text-xs">
          <span className="text-text-tertiary">型号</span>
          <span className="text-text-primary font-medium truncate ml-4 max-w-[220px]">{cpu.model || cpu.arch || '未知'}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-text-tertiary">架构</span>
          <span className="text-text-primary font-medium">{cpu.arch || '--'}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-text-tertiary">物理核心</span>
          <span className="text-text-primary font-medium">{cpu.physical_cores ?? '--'} 核</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-text-tertiary">逻辑线程</span>
          <span className="text-text-primary font-medium">{cpu.logical_cores ?? '--'} 线程</span>
        </div>
        {cpu.max_freq_mhz && (
          <div className="flex justify-between text-xs">
            <span className="text-text-tertiary">最大频率</span>
            <span className="text-text-primary font-medium">{(cpu.max_freq_mhz / 1000).toFixed(1)} GHz</span>
          </div>
        )}
        {cpu.current_freq_mhz && (
          <div className="flex justify-between text-xs">
            <span className="text-text-tertiary">当前频率</span>
            <span className="text-text-primary font-medium">{(cpu.current_freq_mhz / 1000).toFixed(1)} GHz</span>
          </div>
        )}
        {cpu.usage_percent != null && (
          <div className="flex justify-between text-xs">
            <span className="text-text-tertiary">当前占用</span>
            <span className="text-text-primary font-medium">{cpu.usage_percent}%</span>
          </div>
        )}
      </div>
    </div>
  );
};
