import React, { useEffect, useState, useRef, useCallback } from 'react';
import { api } from '../../services/api';
import { storage } from '../../services/storage';
import { useAppStore } from '../../store/useAppStore';
import { Button, Badge } from '../common/Modal';
import type { Photo } from '../../types';

interface Props {
  camId: number;
}

type FilterTab = 'all' | 'pass' | 'reject';

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
    try {
      const settingsData = await api.getSaveSettings();
      if (settingsData.success && settingsData.settings) {
        setSaveSettings(settingsData.settings);
      }
    } catch { /* keep local settings as a fallback */ }

    try {
      const statusData = await api.status();
      const cams = statusData.cameras;
      if (cams && cams[camId]?.stats) {
        const s = storage.getCameraStats();
        s[camId] = cams[camId].stats!;
        storage.saveCameraStats(s);
        setStats({ ...s });
      }
    } catch { /* ignore */ }

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

  const updateSaveSettings = async (next: { saveGood: boolean; saveBad: boolean }) => {
    const previous = saveSettings[camId] || { saveGood: true, saveBad: true };
    setSaveSettings(current => ({ ...current, [camId]: next }));
    try {
      const response = await api.saveSaveSettings(camId, next);
      if (!response.success) throw new Error(response.error || '后端保存失败');
      const persisted = storage.getSaveSettings();
      persisted[camId] = next;
      storage.saveSaveSettings(persisted);
    } catch (error) {
      setSaveSettings(current => ({ ...current, [camId]: previous }));
      showMessage(`保存照片开关失败: ${(error as Error).message}`);
    }
  };

  const toggleSaveGood = (val: boolean) => {
    const current = saveSettings[camId] || { saveGood: true, saveBad: true };
    void updateSaveSettings({ ...current, saveGood: val });
  };

  const toggleSaveBad = (val: boolean) => {
    const current = saveSettings[camId] || { saveGood: true, saveBad: true };
    void updateSaveSettings({ ...current, saveBad: val });
  };

  const resetStats = async () => {
    try {
      const response = await api.resetStats(camId);
      if (!response.success) throw new Error('后端清零失败');
      const current = storage.getCameraStats();
      current[camId] = response.stats || { detected: 0, defective: 0 };
      storage.saveCameraStats(current);
      setStats({ ...current });
      showMessage(`Cam ${camId} 统计已清零`);
    } catch (error) {
      showMessage(`Cam ${camId} 统计清零失败: ${(error as Error).message}`);
    }
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
    : photos.filter(p => p.result === (filterTab === 'pass' ? 'OK' : 'NG'));

  const filterTabs: { id: FilterTab; label: string; count: number }[] = [
    { id: 'all', label: '全部', count: photos.length },
    { id: 'pass', label: '放行结果', count: photoStats.ok },
    { id: 'reject', label: '剔除结果', count: photoStats.ng },
  ];

  return (
    <div className="flex gap-6 h-full overflow-auto">
      <div className="flex-1 flex flex-col gap-4">
        <div className="flex-1 bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-center relative min-h-[300px]">
          {selectedPhoto ? (
            <>
              <img src={api.getPhotoUrl(camId, selectedPhoto)} alt={selectedPhoto}
                className="max-w-[90%] max-h-[90%] object-contain rounded"
                onError={(e) => { (e.target as HTMLImageElement).alt = '加载失败'; }} />
              <span className="absolute bottom-3 left-3 text-xs text-text-tertiary bg-white/80 px-2 py-1 rounded">{selectedPhoto}</span>
            </>
          ) : (
            <span className="text-text-tertiary text-sm">选择右侧照片预览</span>
          )}
        </div>
        <div className="flex items-center gap-6 bg-white rounded-lg shadow-card border border-gray-100 p-4">
          <div className="text-[13px]"><span className="text-text-tertiary">线体</span><span className="text-text-primary ml-1 font-medium">{camId}</span></div>
          <div className="text-[13px]"><span className="text-text-tertiary">OK</span><span className="text-ok ml-1 font-semibold">{(stats[camId]?.detected || 0) - (stats[camId]?.defective || 0)}</span></div>
          <div className="text-[13px]"><span className="text-text-tertiary">NG</span><span className="text-ng ml-1 font-semibold">{stats[camId]?.defective || 0}</span></div>
          <div className="text-[13px]"><span className="text-text-tertiary">总计</span><span className="text-text-primary ml-1 font-semibold">{stats[camId]?.detected || 0}</span></div>
          <div className="flex-1" />
          <Button variant="secondary" size="sm" onClick={resetStats}>清零统计</Button>
          <Button variant="ghost" size="sm" onClick={loadPhotos}>刷新</Button>
        </div>
      </div>

      <div className="w-[340px] shrink-0 flex flex-col gap-4">
        <div className="bg-white rounded-lg shadow-card border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[13px] text-text-secondary">保存放行结果照片</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer"
                checked={saveSettings[camId]?.saveGood ?? true}
                onChange={e => toggleSaveGood(e.target.checked)} />
              <div className="w-9 h-5 bg-gray-300 rounded-full peer peer-checked:bg-ok after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full" />
              <span className="ml-2 text-xs text-text-tertiary">{saveSettings[camId]?.saveGood ? '开启' : '关闭'}</span>
            </label>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-text-secondary">保存剔除结果照片</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer"
                checked={saveSettings[camId]?.saveBad ?? true}
                onChange={e => toggleSaveBad(e.target.checked)} />
              <div className="w-9 h-5 bg-gray-300 rounded-full peer peer-checked:bg-ng after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full" />
              <span className="ml-2 text-xs text-text-tertiary">{saveSettings[camId]?.saveBad ? '开启' : '关闭'}</span>
            </label>
          </div>
        </div>

        <div className="flex-1 bg-white rounded-lg shadow-card border border-gray-100 flex flex-col min-h-0">
          <div className="flex border-b border-gray-200 shrink-0">
            {filterTabs.map(tab => (
              <button key={tab.id} onClick={() => { setFilterTab(tab.id); setSelectedPhoto(null); }}
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
                    <div key={p.id} onClick={() => setSelectedPhoto(p.id)}
                      onContextMenu={(e) => handleRightClick(e, p.id)}
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
