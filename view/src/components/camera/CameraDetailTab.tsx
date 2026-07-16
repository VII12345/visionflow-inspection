import React, { useEffect, useState, useRef, useCallback } from 'react';
import { api } from '../../services/api';
import { storage } from '../../services/storage';
import { useAppStore } from '../../store/useAppStore';
import { Button, Badge } from '../common/Modal';
import type { Photo } from '../../types';

interface Props {
  camId: number;
}

type FilterTab = 'all' | 'ok' | 'ng';

export const CameraDetailTab: React.FC<Props> = ({ camId }) => {
  const showMessage = useAppStore(s => s.showMessage);
  const isRunning = useAppStore(s => s.isRunning);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const [saveSettings, setSaveSettings] = useState(storage.getSaveSettings());
  const [filterTab, setFilterTab] = useState<FilterTab>('all');
  const [stats, setStats] = useState(storage.getCameraStats());
  const [photoStats, setPhotoStats] = useState({ ok: 0, ng: 0, unk: 0 });
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadPhotos = useCallback(async () => {
    // 从后端同步实时统计
    try {
      const statusData = await api.status();
      const cams = (statusData as Record<string, unknown>).cameras as Record<string, { stats?: { detected: number; defective: number } }>;
      if (cams && cams[camId]?.stats) {
        const s = storage.getCameraStats();
        s[camId] = cams[camId].stats!;
        storage.saveCameraStats(s);
        setStats({ ...s });
      }
    } catch { /* ignore */ }

    // 加载照片列表
    try {
      const data = await api.getPhotos(camId);
      if (data.success && data.photos) {
        const photosData: Photo[] = data.photos.map((p: { filename: string; mtime: string; size: number; result: string; timestamp: number; subdir?: string }) => ({
          id: p.filename,
          time: p.mtime,
          result: p.result || '--',
          filename: p.filename,
          size: p.size,
          timestamp: p.timestamp,
          subdir: p.subdir,
        }));
        setPhotos(photosData);
        let ok = 0, ng = 0, unk = 0;
        for (const p of photosData) {
          if (p.result === 'OK') ok++;
          else if (p.result === 'NG') ng++;
          else unk++;
        }
        setPhotoStats({ ok, ng, unk });
      }
    } catch {
      setPhotos(storage.getPhotos(camId));
    }
  }, [camId]);

  useEffect(() => { loadPhotos(); }, [loadPhotos]);

  useEffect(() => {
    if (isRunning) {
      refreshRef.current = setInterval(loadPhotos, 2000);
    } else {
      if (refreshRef.current) { clearInterval(refreshRef.current); refreshRef.current = null; }
    }
    return () => { if (refreshRef.current) clearInterval(refreshRef.current); };
  }, [isRunning, loadPhotos]);

  const toggleSaveGood = (val: boolean) => {
    const s = storage.getSaveSettings();
    s[camId] = { ...s[camId], saveGood: val };
    storage.saveSaveSettings(s);
    setSaveSettings({ ...s });
  };

  const toggleSaveBad = (val: boolean) => {
    const s = storage.getSaveSettings();
    s[camId] = { ...s[camId], saveBad: val };
    storage.saveSaveSettings(s);
    setSaveSettings({ ...s });
  };

  const resetStats = () => {
    storage.resetCameraStats(camId);
    setStats({ ...storage.getCameraStats() });
    showMessage(`Cam${camId} 统计已清零`);
  };

  const handleRightClick = (e: React.MouseEvent, photoId: string) => {
    e.preventDefault();
    const url = api.getPhotoUrl(camId, photoId);
    const a = document.createElement('a');
    a.href = url;
    a.download = photoId;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showMessage(`图片已下载: ${photoId}`);
  };

  const filteredPhotos = filterTab === 'all'
    ? photos
    : photos.filter(p => p.result === (filterTab === 'ok' ? 'OK' : 'NG'));

  const filterTabs: { id: FilterTab; label: string; count: number; color: string }[] = [
    { id: 'all', label: '全部', count: photos.length, color: 'text-gray-400' },
    { id: 'ok', label: '✅ 正罐', count: photoStats.ok, color: 'text-emerald-400' },
    { id: 'ng', label: '❌ 倒罐', count: photoStats.ng, color: 'text-rose-400' },
  ];

  return (
    <div className="flex gap-6 h-full overflow-auto">
      <div className="flex-1 flex flex-col gap-4">
        <div className="flex-1 bg-[#0d1117] border border-white/[0.06] rounded-xl flex items-center justify-center relative min-h-[300px]">
          {selectedPhoto ? (
            <>
              <img src={api.getPhotoUrl(camId, selectedPhoto)} alt={selectedPhoto}
                className="max-w-[90%] max-h-[90%] object-contain rounded-lg"
                onError={(e) => { (e.target as HTMLImageElement).alt = '加载失败'; }} />
              <span className="absolute bottom-3 left-3 text-xs text-gray-500 bg-[#0d1117]/80 px-2 py-1 rounded">{selectedPhoto}</span>
            </>
          ) : (
            <span className="text-gray-600 text-sm">选择右侧照片预览</span>
          )}
        </div>
        <div className="flex items-center gap-6 bg-[#171d2b] border border-white/[0.06] rounded-xl p-4">
          <div className="text-[13px]"><span className="text-gray-400">线体：</span><span className="text-white ml-1 font-semibold">{camId}</span></div>
          <div className="text-[13px]"><span className="text-gray-400">OK：</span><span className="text-emerald-400 ml-1 font-semibold">{(stats[camId]?.detected || 0) - (stats[camId]?.defective || 0)}</span></div>
          <div className="text-[13px]"><span className="text-gray-400">NG：</span><span className="text-rose-400 ml-1 font-semibold">{stats[camId]?.defective || 0}</span></div>
          <div className="text-[13px]"><span className="text-gray-400">总计：</span><span className="text-white ml-1 font-semibold">{stats[camId]?.detected || 0}</span></div>
          <div className="flex-1" />
          <Button variant="secondary" size="sm" onClick={resetStats}>清零统计</Button>
          <Button variant="secondary" size="sm" onClick={loadPhotos}>🔄 刷新</Button>
        </div>
      </div>

      <div className="w-[360px] shrink-0 flex flex-col gap-4">
        <div className="bg-[#171d2b] border border-white/[0.06] rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[13px] text-gray-400">保存正罐照片</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer"
                checked={saveSettings[camId]?.saveGood ?? true}
                onChange={e => toggleSaveGood(e.target.checked)} />
              <div className="w-9 h-5 bg-gray-700 rounded-full peer peer-checked:bg-emerald-500 peer-focus:ring-2 peer-focus:ring-emerald-500/30 after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full" />
              <span className="ml-2 text-xs text-gray-500">{saveSettings[camId]?.saveGood ? '是' : '否'}</span>
            </label>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-gray-400">保存倒罐照片</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer"
                checked={saveSettings[camId]?.saveBad ?? true}
                onChange={e => toggleSaveBad(e.target.checked)} />
              <div className="w-9 h-5 bg-gray-700 rounded-full peer peer-checked:bg-rose-500 peer-focus:ring-2 peer-focus:ring-rose-500/30 after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full" />
              <span className="ml-2 text-xs text-gray-500">{saveSettings[camId]?.saveBad ? '是' : '否'}</span>
            </label>
          </div>
        </div>

        <div className="flex-1 bg-[#171d2b] border border-white/[0.06] rounded-xl flex flex-col min-h-0">
          <div className="flex border-b border-white/[0.06] shrink-0">
            {filterTabs.map(tab => (
              <button key={tab.id} onClick={() => { setFilterTab(tab.id); setSelectedPhoto(null); }}
                className={`flex-1 py-2.5 text-xs font-semibold transition-all relative ${
                  filterTab === tab.id
                    ? `${tab.color} after:absolute after:bottom-0 after:left-[20%] after:right-[20%] after:h-0.5 after:rounded-sm after:bg-current`
                    : 'text-gray-600 hover:text-gray-400'
                }`}>
                {tab.label}<span className="ml-1 opacity-70">({tab.count})</span>
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-auto p-3">
            <h4 className="text-[11px] text-gray-500 mb-2">📷 单击预览 | 右键另存 | {isRunning ? '🟢 实时更新中' : '⏸ 已暂停'}</h4>
            {filteredPhotos.length === 0 ? (
              <p className="text-gray-600 text-xs py-8 text-center">
                {filterTab === 'all' ? '暂无检测记录' : filterTab === 'ok' ? '暂无正罐照片' : '暂无倒罐照片'}
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {filteredPhotos.map(p => {
                  const isOk = p.result === 'OK';
                  const isNg = p.result === 'NG';
                  const badge = isOk
                    ? { text: '正', cls: 'bg-emerald-500/15 text-emerald-400' }
                    : isNg
                    ? { text: '反', cls: 'bg-rose-500/15 text-rose-400' }
                    : { text: '--', cls: 'bg-gray-500/15 text-gray-500' };
                  return (
                    <div key={p.id} onClick={() => setSelectedPhoto(p.id)}
                      onContextMenu={(e) => handleRightClick(e, p.id)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-xs transition-all border ${
                        selectedPhoto === p.id
                          ? 'bg-[#5b6ef5]/[0.12] border-[#5b6ef5]/20'
                          : 'hover:bg-white/[0.03] border-transparent'
                      }`}>
                      <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold ${badge.cls}`}>{badge.text}</span>
                      <span className="text-gray-500 w-20 shrink-0 text-[11px]">{p.time}</span>
                      <span className="text-gray-400 flex-1 truncate text-[11px]">{p.filename}</span>
                      {p.size && (
                        <span className="text-gray-600 text-[10px] shrink-0">
                          {p.size > 1024 * 1024 ? `${(p.size / 1024 / 1024).toFixed(1)}M` : `${(p.size / 1024).toFixed(0)}K`}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
