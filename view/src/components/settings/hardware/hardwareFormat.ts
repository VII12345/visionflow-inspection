/** 硬件信息展示辅助函数。 */

export interface RxTxInterface {
  speed_rx_mbps?: number | null;
  speed_tx_mbps?: number | null;
}

export const formatSpeed = (mbps: number | null | undefined): string | null => {
  if (mbps == null) return null;
  return mbps >= 1000 ? `${(mbps / 1000).toFixed(1)} Gbps` : `${mbps} Mbps`;
};

export const hasRxTx = (iface: RxTxInterface): boolean =>
  iface.speed_rx_mbps != null || iface.speed_tx_mbps != null;
