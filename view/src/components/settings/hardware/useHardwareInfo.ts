import { useEffect, useState } from 'react';
import { api } from '../../../services/api';
import type { HardwareInfoResponse } from '../../../types/api';

export type HardwareInfo = HardwareInfoResponse['hardware'];

/** 加载后端硬件信息，成功前返回 null。 */
export const useHardwareInfo = (): HardwareInfo | null => {
  const [hwInfo, setHwInfo] = useState<HardwareInfo | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const hw = await api.getHardware();
        if (hw.success) setHwInfo(hw.hardware);
      } catch { /* ignore */ }
    })();
  }, []);

  return hwInfo;
};
