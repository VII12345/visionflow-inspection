import React from 'react';
import type { HardwareInfo } from './useHardwareInfo';

interface Props {
  hardware: HardwareInfo;
}

/** 显卡 (GPU) 信息卡片。 */
export const HardwareGpuCard: React.FC<Props> = ({ hardware }) => {
  const { gpu } = hardware;
  const pass = hardware.checks?.gpu_cuda?.pass;
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="text-[10px] text-text-tertiary uppercase tracking-wide">显卡 (GPU)</div>
        {pass != null && (
          <span className={`text-[10px] font-medium ${pass ? 'text-ok' : 'text-ng'}`}>
            {pass ? '已达标' : '未达标'}
          </span>
        )}
      </div>
      <div className="bg-gray-50 rounded-md p-3 space-y-1.5">
        {gpu.cuda_available ? (
          <>
            <div className="flex justify-between text-xs">
              <span className="text-text-tertiary">型号</span>
              <span className="text-ok font-medium truncate ml-4 max-w-[200px]">{gpu.name || 'NVIDIA GPU'}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-text-tertiary">数量</span>
              <span className="text-text-primary font-medium">{gpu.count} 卡</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-text-tertiary">显存总量</span>
              <span className="text-text-primary font-medium">{gpu.memory_total_mb ? `${(gpu.memory_total_mb / 1024).toFixed(1)} GB` : '--'}</span>
            </div>
            {gpu.memory_used_mb != null && (
              <div className="flex justify-between text-xs">
                <span className="text-text-tertiary">显存已用</span>
                <span className="text-text-primary font-medium">{(gpu.memory_used_mb / 1024).toFixed(1)} GB</span>
              </div>
            )}
            {gpu.memory_free_mb != null && (
              <div className="flex justify-between text-xs">
                <span className="text-text-tertiary">显存空闲</span>
                <span className="text-text-primary font-medium">{(gpu.memory_free_mb / 1024).toFixed(1)} GB</span>
              </div>
            )}
            <div className="flex justify-between text-xs">
              <span className="text-text-tertiary">CUDA 版本</span>
              <span className="text-text-primary font-medium">{gpu.cuda_version || '--'}</span>
            </div>
            {gpu.compute_capability && (
              <div className="flex justify-between text-xs">
                <span className="text-text-tertiary">计算能力</span>
                <span className="text-text-primary font-medium">{gpu.compute_capability}</span>
              </div>
            )}
          </>
        ) : (
          <div className="text-xs text-ng font-medium text-center py-2">无可用 GPU (CUDA 不可用)</div>
        )}
      </div>
    </div>
  );
};
