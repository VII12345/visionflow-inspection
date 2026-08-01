import React from 'react';
import type { Photo } from '../../types';
import { PhotoContextMenu } from './PhotoContextMenu';
import type { FilterTab } from './useCameraPhotos';

interface Props {
  camId: number;
  filteredPhotos: Photo[];
  filterTabs: { id: FilterTab; label: string; count: number }[];
  filterTab: FilterTab;
  onFilterTabChange: (tab: FilterTab) => void;
  selectedPhoto: string | null;
  onSelectPhoto: (id: string | null) => void;
  isRunning: boolean;
}

/** 相机照片列表卡片：筛选页签 + 照片列表（单击预览/右键另存）。 */
export const PhotoListCard: React.FC<Props> = ({
  camId,
  filteredPhotos,
  filterTabs,
  filterTab,
  onFilterTabChange,
  selectedPhoto,
  onSelectPhoto,
  isRunning,
}) => {
  return (
    <div className="flex-1 bg-white rounded-lg shadow-card border border-gray-100 flex flex-col min-h-0">
      <div className="flex border-b border-gray-200 shrink-0">
        {filterTabs.map(tab => (
          <button key={tab.id} onClick={() => { onFilterTabChange(tab.id); onSelectPhoto(null); }}
            className={`flex-1 py-2.5 text-xs font-medium transition-colors relative ${
              filterTab === tab.id
                ? 'text-accent after:absolute after:bottom-0 after:left-[25%] after:right-[25%] after:h-[2px] after:bg-accent after:rounded-full'
                : 'text-text-tertiary hover:text-text-secondary'
            }`}>
            {tab.label} <span className="ml-1 opacity-60">({tab.count})</span>
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto p-3">
        <div className="text-[11px] text-text-tertiary mb-2">单击预览 | 右键另存 | {isRunning ? '实时更新中' : '已暂停'}</div>
        {filteredPhotos.length === 0 ? (
          <p className="text-text-tertiary text-xs py-8 text-center">
            {filterTab === 'all' ? '暂无检测记录' : filterTab === 'pass' ? '暂无放行结果照片' : '暂无剔除结果照片'}
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {filteredPhotos.map(p => {
              const isOk = p.result === 'OK';
              const isNg = p.result === 'NG';
              const badge = isOk
                ? { text: p.subdir || '放行', cls: 'bg-emerald-50 text-ok' }
                : isNg
                ? { text: p.subdir || '剔除', cls: 'bg-red-50 text-ng' }
                : { text: p.subdir || '--', cls: 'bg-gray-100 text-text-tertiary' };
              return (
                <PhotoContextMenu key={p.id} camId={camId} photoId={p.id}>
                  <div onClick={() => onSelectPhoto(p.id)}
                    className={`flex items-center gap-2 px-3 py-2 rounded cursor-pointer text-xs transition-colors border ${
                      selectedPhoto === p.id
                        ? 'bg-blue-50 border-accent/20'
                        : 'border-transparent hover:bg-gray-50'
                    }`}
                  >
                    <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${badge.cls}`}>{badge.text}</span>
                    <span className="flex-1 truncate text-text-secondary">{p.id}</span>
                    <span className="text-text-tertiary shrink-0">{p.size ? `${(p.size / 1024).toFixed(0)}K` : ''}</span>
                  </div>
                </PhotoContextMenu>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
