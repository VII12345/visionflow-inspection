import React, { useEffect, useState } from 'react';
import { api } from '../../services/api';
import type { HardwareInfoResponse } from '../../types/api';

export const HardwarePanel: React.FC = () => {
  const [hwInfo, setHwInfo] = useState<HardwareInfoResponse['hardware'] | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const hw = await api.getHardware();
        if (hw.success) setHwInfo(hw.hardware);
      } catch { /* ignore */ }
    })();
  }, []);

  return (
    <>
      {/* Hardware & Device */}
      {hwInfo && (
        <div className="bg-white rounded-lg shadow-card border border-gray-100 p-6">
          <h3 className="text-[15px] font-semibold text-text-primary mb-4">系统信息</h3>

          {/* Hardware Check */}
          {hwInfo.checks && (
            <div className="mb-4">
              <div className="text-[10px] text-text-tertiary uppercase tracking-wide mb-2">达标检测</div>
              <div className="bg-gray-50 rounded-md p-3 space-y-1.5">
                {Object.entries(hwInfo.checks)
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
                  <span className={`font-semibold ${hwInfo.checks._all_pass ? 'text-ok' : 'text-ng'}`}>
                    {hwInfo.checks._all_pass ? '全部通过' : '部分未达标'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* CPU */}
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="text-[10px] text-text-tertiary uppercase tracking-wide">处理器 (CPU)</div>
              {hwInfo.checks?.cpu_cores && (
                <span className={`text-[10px] font-medium ${hwInfo.checks.cpu_cores.pass ? 'text-ok' : 'text-ng'}`}>
                  {hwInfo.checks.cpu_cores.pass ? '已达标' : '未达标'}
                </span>
              )}
            </div>
            <div className="bg-gray-50 rounded-md p-3 space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-text-tertiary">型号</span>
                <span className="text-text-primary font-medium truncate ml-4 max-w-[220px]">{hwInfo.cpu.model || hwInfo.cpu.arch || '未知'}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-text-tertiary">架构</span>
                <span className="text-text-primary font-medium">{hwInfo.cpu.arch || '--'}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-text-tertiary">物理核心</span>
                <span className="text-text-primary font-medium">{hwInfo.cpu.physical_cores ?? '--'} 核</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-text-tertiary">逻辑线程</span>
                <span className="text-text-primary font-medium">{hwInfo.cpu.logical_cores ?? '--'} 线程</span>
              </div>
              {hwInfo.cpu.max_freq_mhz && (
                <div className="flex justify-between text-xs">
                  <span className="text-text-tertiary">最大频率</span>
                  <span className="text-text-primary font-medium">{(hwInfo.cpu.max_freq_mhz / 1000).toFixed(1)} GHz</span>
                </div>
              )}
              {hwInfo.cpu.current_freq_mhz && (
                <div className="flex justify-between text-xs">
                  <span className="text-text-tertiary">当前频率</span>
                  <span className="text-text-primary font-medium">{(hwInfo.cpu.current_freq_mhz / 1000).toFixed(1)} GHz</span>
                </div>
              )}
              {hwInfo.cpu.usage_percent != null && (
                <div className="flex justify-between text-xs">
                  <span className="text-text-tertiary">当前占用</span>
                  <span className="text-text-primary font-medium">{hwInfo.cpu.usage_percent}%</span>
                </div>
              )}
            </div>
          </div>

          {/* Memory */}
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="text-[10px] text-text-tertiary uppercase tracking-wide">内存 (RAM)</div>
              {hwInfo.checks?.memory_total && (
                <span className={`text-[10px] font-medium ${hwInfo.checks.memory_total.pass ? 'text-ok' : 'text-ng'}`}>
                  {hwInfo.checks.memory_total.pass ? '已达标' : '未达标'}
                </span>
              )}
            </div>
            <div className="bg-gray-50 rounded-md p-3 space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-text-tertiary">总容量</span>
                <span className="text-text-primary font-medium">{hwInfo.memory.total_gb ?? '--'} GB</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-text-tertiary">已使用</span>
                <span className="text-text-primary font-medium">{hwInfo.memory.used_gb ?? '--'} GB</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-text-tertiary">可用</span>
                <span className="text-text-primary font-medium">{hwInfo.memory.available_gb ?? '--'} GB</span>
              </div>
              {hwInfo.memory.speed_mhz && (
                <div className="flex justify-between text-xs">
                  <span className="text-text-tertiary">频率</span>
                  <span className="text-text-primary font-medium">{hwInfo.memory.speed_mhz} MHz</span>
                </div>
              )}
              <div className="flex justify-between text-xs">
                <span className="text-text-tertiary">使用率</span>
                <span className={`font-medium ${hwInfo.memory.percent != null && hwInfo.memory.percent > 80 ? 'text-warn' : 'text-text-primary'}`}>{hwInfo.memory.percent ?? '--'}%</span>
              </div>
            </div>
          </div>

          {/* GPU */}
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="text-[10px] text-text-tertiary uppercase tracking-wide">显卡 (GPU)</div>
              {hwInfo.checks?.gpu_cuda && (
                <span className={`text-[10px] font-medium ${hwInfo.checks.gpu_cuda.pass ? 'text-ok' : 'text-ng'}`}>
                  {hwInfo.checks.gpu_cuda.pass ? '已达标' : '未达标'}
                </span>
              )}
            </div>
            <div className="bg-gray-50 rounded-md p-3 space-y-1.5">
              {hwInfo.gpu.cuda_available ? (
                <>
                  <div className="flex justify-between text-xs">
                    <span className="text-text-tertiary">型号</span>
                    <span className="text-ok font-medium truncate ml-4 max-w-[200px]">{hwInfo.gpu.name || 'NVIDIA GPU'}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-text-tertiary">数量</span>
                    <span className="text-text-primary font-medium">{hwInfo.gpu.count} 卡</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-text-tertiary">显存总量</span>
                    <span className="text-text-primary font-medium">{hwInfo.gpu.memory_total_mb ? `${(hwInfo.gpu.memory_total_mb / 1024).toFixed(1)} GB` : '--'}</span>
                  </div>
                  {hwInfo.gpu.memory_used_mb != null && (
                    <div className="flex justify-between text-xs">
                      <span className="text-text-tertiary">显存已用</span>
                      <span className="text-text-primary font-medium">{(hwInfo.gpu.memory_used_mb / 1024).toFixed(1)} GB</span>
                    </div>
                  )}
                  {hwInfo.gpu.memory_free_mb != null && (
                    <div className="flex justify-between text-xs">
                      <span className="text-text-tertiary">显存空闲</span>
                      <span className="text-text-primary font-medium">{(hwInfo.gpu.memory_free_mb / 1024).toFixed(1)} GB</span>
                    </div>
                  )}
                  <div className="flex justify-between text-xs">
                    <span className="text-text-tertiary">CUDA 版本</span>
                    <span className="text-text-primary font-medium">{hwInfo.gpu.cuda_version || '--'}</span>
                  </div>
                  {hwInfo.gpu.compute_capability && (
                    <div className="flex justify-between text-xs">
                      <span className="text-text-tertiary">计算能力</span>
                      <span className="text-text-primary font-medium">{hwInfo.gpu.compute_capability}</span>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-xs text-ng font-medium text-center py-2">无可用 GPU (CUDA 不可用)</div>
              )}
            </div>
          </div>

          {/* Disk */}
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="text-[10px] text-text-tertiary uppercase tracking-wide">项目硬盘</div>
              {hwInfo.checks?.disk_free && (
                <span className={`text-[10px] font-medium ${hwInfo.checks.disk_free.pass ? 'text-ok' : 'text-ng'}`}>
                  {hwInfo.checks.disk_free.pass ? '已达标' : '未达标'}
                </span>
              )}
            </div>
            <div className="bg-gray-50 rounded-md p-3 space-y-1.5">
              {hwInfo.disk.project_drive && (
                <div className="flex justify-between text-xs">
                  <span className="text-text-tertiary">路径</span>
                  <span className="text-text-primary font-medium truncate ml-4 max-w-[180px]">{hwInfo.disk.project_drive}</span>
                </div>
              )}
              {hwInfo.disk.filesystem && (
                <div className="flex justify-between text-xs">
                  <span className="text-text-tertiary">文件系统</span>
                  <span className="text-text-primary font-medium">{hwInfo.disk.filesystem}</span>
                </div>
              )}
              <div className="flex justify-between text-xs">
                <span className="text-text-tertiary">总容量</span>
                <span className="text-text-primary font-medium">{hwInfo.disk.total_gb ?? '--'} GB</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-text-tertiary">已使用</span>
                <span className="text-text-primary font-medium">{hwInfo.disk.used_gb ?? '--'} GB</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-text-tertiary">可用空间</span>
                <span className={`font-medium ${hwInfo.disk.free_gb != null && hwInfo.disk.free_gb < 10 ? 'text-warn' : 'text-text-primary'}`}>{hwInfo.disk.free_gb ?? '--'} GB</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-text-tertiary">使用率</span>
                <span className={`font-medium ${hwInfo.disk.percent != null && hwInfo.disk.percent > 80 ? 'text-warn' : 'text-text-primary'}`}>{hwInfo.disk.percent ?? '--'}%</span>
              </div>
            </div>
          </div>

          {/* System */}
          <div className="mb-4">
            <div className="text-[10px] text-text-tertiary uppercase tracking-wide mb-2">系统环境</div>
            <div className="bg-gray-50 rounded-md p-3 space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-text-tertiary">操作系统</span>
                <span className="text-text-primary font-medium">{hwInfo.system.os ?? '--'} {hwInfo.system.os_release ?? ''}</span>
              </div>
              {hwInfo.system.hostname && (
                <div className="flex justify-between text-xs">
                  <span className="text-text-tertiary">主机名</span>
                  <span className="text-text-primary font-medium">{hwInfo.system.hostname}</span>
                </div>
              )}
              <div className="flex justify-between text-xs">
                <span className="text-text-tertiary">Python</span>
                <span className="text-text-primary font-medium">{hwInfo.system.python_version ?? '--'}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-text-tertiary">PyTorch</span>
                <span className="text-text-primary font-medium">{hwInfo.pytorch_version}</span>
              </div>
            </div>
          </div>

          {/* Network */}
          {hwInfo.network && hwInfo.network.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="text-[10px] text-text-tertiary uppercase tracking-wide">网络接口</div>
                {hwInfo.checks?.network_speed && (
                  <span className={`text-[10px] font-medium ${hwInfo.checks.network_speed.pass ? 'text-ok' : 'text-ng'}`}>
                    {hwInfo.checks.network_speed.pass ? '已达标' : '未达标'}
                  </span>
                )}
              </div>
              <div className="bg-gray-50 rounded-md p-3 space-y-2">
                {hwInfo.network
                  .filter(iface => iface.type === '以太网' || iface.type === 'WiFi')
                  .map((iface, i, arr) => {
                  const formatSpeed = (mbps: number | null | undefined) => {
                    if (mbps == null) return null;
                    return mbps >= 1000 ? `${(mbps / 1000).toFixed(1)} Gbps` : `${mbps} Mbps`;
                  };
                  const hasRxTx = iface.speed_rx_mbps != null || iface.speed_tx_mbps != null;
                  return (
                    <div key={i} className={`flex items-center justify-between text-xs py-1 ${i < arr.length - 1 ? 'border-b border-gray-100' : ''}`}>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${iface.up ? 'bg-ok' : 'bg-gray-300'}`} />
                        <span className="text-text-primary font-medium truncate">{iface.name}</span>
                        <span className="text-[10px] text-text-tertiary bg-gray-200 rounded px-1.5 py-0.5 shrink-0">{iface.type}</span>
                      </div>
                      <span className="text-text-primary font-medium shrink-0 ml-3 text-right">
                        {hasRxTx ? (
                          <span>
                            <span className="text-text-tertiary text-[10px]">RX </span>
                            {formatSpeed(iface.speed_rx_mbps) ?? '--'}
                            <span className="text-text-tertiary text-[10px]"> TX </span>
                            {formatSpeed(iface.speed_tx_mbps) ?? '--'}
                          </span>
                        ) : (
                          formatSpeed(iface.speed_mbps) ?? (iface.up ? '已连接' : '未连接')
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      )}
    </>
  );
};
