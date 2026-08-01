import React from 'react';
import { HardwareCheckSummary } from './hardware/HardwareCheckSummary';
import { HardwareCpuCard } from './hardware/HardwareCpuCard';
import { HardwareDiskCard } from './hardware/HardwareDiskCard';
import { HardwareGpuCard } from './hardware/HardwareGpuCard';
import { HardwareMemoryCard } from './hardware/HardwareMemoryCard';
import { HardwareNetworkCard } from './hardware/HardwareNetworkCard';
import { HardwareSystemCard } from './hardware/HardwareSystemCard';
import { useHardwareInfo } from './hardware/useHardwareInfo';

export const HardwarePanel: React.FC = () => {
  const hwInfo = useHardwareInfo();

  return (
    <>
      {/* Hardware & Device */}
      {hwInfo && (
        <div className="bg-white rounded-lg shadow-card border border-gray-100 p-6">
          <h3 className="text-[15px] font-semibold text-text-primary mb-4">系统信息</h3>

          <HardwareCheckSummary checks={hwInfo.checks} />
          <HardwareCpuCard hardware={hwInfo} />
          <HardwareMemoryCard hardware={hwInfo} />
          <HardwareGpuCard hardware={hwInfo} />
          <HardwareDiskCard hardware={hwInfo} />
          <HardwareSystemCard hardware={hwInfo} />
          <HardwareNetworkCard hardware={hwInfo} />
        </div>
      )}
    </>
  );
};
