import React, { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { useAppStore } from '../../store/useAppStore';

/** 照片保存策略卡片：全局"仅保存剔除照片"开关。 */
export const SavePolicySection: React.FC = () => {
  const showMessage = useAppStore(s => s.showMessage);
  const [saveOnlyReject, setSaveOnlyReject] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.getSaveOnlyReject()
      .then(data => { if (data.success) setSaveOnlyReject(data.enabled); })
      .catch(() => { /* 后端不可达时保持默认 */ })
      .finally(() => setLoaded(true));
  }, []);

  const toggle = async (checked: boolean) => {
    setSaveOnlyReject(checked);
    try {
      const result = await api.saveOnlyReject(checked);
      if (!result.success) throw new Error(result.message || '保存失败');
      showMessage(checked ? '已开启：仅保存需剔除的照片' : '已关闭：按各相机开关保存照片');
    } catch (e) {
      setSaveOnlyReject(!checked);
      showMessage(`保存失败: ${(e as Error).message}`);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-card border border-gray-100 p-6">
      <h3 className="text-[15px] font-semibold text-text-primary mb-3">照片保存策略</h3>
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[13px] text-text-secondary">仅保存剔除照片</div>
          <p className="text-[11px] text-text-tertiary mt-1">开启后只保存需要剔除（NG）的产品照片，放行照片一律不保存，节省磁盘空间。</p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer shrink-0">
          <input type="checkbox" className="sr-only peer"
            checked={saveOnlyReject}
            disabled={!loaded}
            onChange={e => void toggle(e.target.checked)} />
          <div className="w-9 h-5 bg-gray-300 rounded-full peer peer-checked:bg-ng after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full" />
          <span className="ml-2 text-xs text-text-tertiary">{saveOnlyReject ? '开启' : '关闭'}</span>
        </label>
      </div>
    </div>
  );
};
