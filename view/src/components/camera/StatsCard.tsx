import React from 'react';
import type { CameraStats } from '../../types';
import { Button } from '../common/Modal';

interface Props {
  camId: number;
  stats: Record<number, CameraStats>;
  onResetStats: () => void;
  onRefresh: () => void;
}

/** 相机统计卡片：OK/NG/总计 + 清零/刷新。 */
export const StatsCard: React.FC<Props> = ({ camId, stats, onResetStats, onRefresh }) => {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 bg-white rounded-lg shadow-card border border-gray-100 p-4">
      <div className="text-[13px]"><span className="text-text-tertiary">线体</span><span className="text-text-primary ml-1 font-medium">{camId}</span></div>
      <div className="text-[13px]"><span className="text-text-tertiary">OK</span><span className="text-ok ml-1 font-semibold">{(stats[camId]?.detected || 0) - (stats[camId]?.defective || 0)}</span></div>
      <div className="text-[13px]"><span className="text-text-tertiary">NG</span><span className="text-ng ml-1 font-semibold">{stats[camId]?.defective || 0}</span></div>
      <div className="text-[13px]"><span className="text-text-tertiary">总计</span><span className="text-text-primary ml-1 font-semibold">{stats[camId]?.detected || 0}</span></div>
      <div className="flex-1" />
      <Button variant="secondary" size="sm" onClick={onResetStats}>清零统计</Button>
      <Button variant="ghost" size="sm" onClick={onRefresh}>刷新</Button>
    </div>
  );
};
