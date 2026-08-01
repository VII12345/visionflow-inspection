import React from 'react';

interface Props {
  saveGood: boolean;
  saveBad: boolean;
  onToggleGood: (val: boolean) => void;
  onToggleBad: (val: boolean) => void;
}

/** 保存设置卡片：放行/剔除照片开关。 */
export const SaveSettingsCard: React.FC<Props> = ({ saveGood, saveBad, onToggleGood, onToggleBad }) => {
  return (
    <div className="bg-white rounded-lg shadow-card border border-gray-100 p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[13px] text-text-secondary">保存放行结果照片</span>
        <label className="relative inline-flex items-center cursor-pointer">
          <input type="checkbox" className="sr-only peer"
            checked={saveGood}
            onChange={e => onToggleGood(e.target.checked)} />
          <div className="w-9 h-5 bg-gray-300 rounded-full peer peer-checked:bg-ok after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full" />
          <span className="ml-2 text-xs text-text-tertiary">{saveGood ? '开启' : '关闭'}</span>
        </label>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-text-secondary">保存剔除结果照片</span>
        <label className="relative inline-flex items-center cursor-pointer">
          <input type="checkbox" className="sr-only peer"
            checked={saveBad}
            onChange={e => onToggleBad(e.target.checked)} />
          <div className="w-9 h-5 bg-gray-300 rounded-full peer peer-checked:bg-ng after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full" />
          <span className="ml-2 text-xs text-text-tertiary">{saveBad ? '开启' : '关闭'}</span>
        </label>
      </div>
    </div>
  );
};
