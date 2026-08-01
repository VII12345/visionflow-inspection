import React from 'react';
import type { HardwareInfo } from './useHardwareInfo';
import { formatSpeed, hasRxTx } from './hardwareFormat';

interface Props {
  hardware: HardwareInfo;
}

/** 网络接口信息卡片。 */
export const HardwareNetworkCard: React.FC<Props> = ({ hardware }) => {
  const { network, checks } = hardware;
  if (!network || network.length === 0) return null;
  const pass = checks?.network_speed?.pass;
  const interfaces = network.filter(iface => iface.type === '以太网' || iface.type === 'WiFi');
  if (interfaces.length === 0) return null;
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="text-[10px] text-text-tertiary uppercase tracking-wide">网络接口</div>
        {pass != null && (
          <span className={`text-[10px] font-medium ${pass ? 'text-ok' : 'text-ng'}`}>
            {pass ? '已达标' : '未达标'}
          </span>
        )}
      </div>
      <div className="bg-gray-50 rounded-md p-3 space-y-2">
        {interfaces.map((iface, i, arr) => {
          const rxTx = hasRxTx(iface);
          return (
            <div key={i} className={`flex items-center justify-between text-xs py-1 ${i < arr.length - 1 ? 'border-b border-gray-100' : ''}`}>
              <div className="flex items-center gap-2 min-w-0">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${iface.up ? 'bg-ok' : 'bg-gray-300'}`} />
                <span className="text-text-primary font-medium truncate">{iface.name}</span>
                <span className="text-[10px] text-text-tertiary bg-gray-200 rounded px-1.5 py-0.5 shrink-0">{iface.type}</span>
              </div>
              <span className="text-text-primary font-medium shrink-0 ml-3 text-right">
                {rxTx ? (
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
  );
};
