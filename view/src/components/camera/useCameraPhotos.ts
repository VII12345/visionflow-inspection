import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../services/api';
import { storage } from '../../services/storage';
import { useAppStore } from '../../store/useAppStore';
import type { Photo } from '../../types';

export type FilterTab = 'all' | 'pass' | 'reject';

type SaveSettingsMap = Record<number, { saveGood: boolean; saveBad: boolean }>;

/** 相机照片列表、统计与轮询加载。 */
export const useCameraPhotos = (
  camId: number,
  isRunning: boolean,
  onSaveSettingsLoaded: (settings: SaveSettingsMap) => void,
) => {
  const showMessage = useAppStore(s => s.showMessage);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<FilterTab>('all');
  const [stats, setStats] = useState(storage.getCameraStats());
  const [photoStats, setPhotoStats] = useState({ ok: 0, ng: 0, unk: 0 });
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadPhotos = useCallback(async () => {
    try {
      const settingsData = await api.getSaveSettings();
      if (settingsData.success && settingsData.settings) {
        onSaveSettingsLoaded(settingsData.settings);
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
  }, [camId, onSaveSettingsLoaded]);

  useEffect(() => { loadPhotos(); }, [loadPhotos]);

  useEffect(() => {
    if (isRunning) {
      refreshRef.current = setInterval(loadPhotos, 2000);
    } else {
      if (refreshRef.current) { clearInterval(refreshRef.current); refreshRef.current = null; }
    }
    return () => { if (refreshRef.current) clearInterval(refreshRef.current); };
  }, [isRunning, loadPhotos]);

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

  const filteredPhotos = filterTab === 'all'
    ? photos
    : photos.filter(p => p.result === (filterTab === 'pass' ? 'OK' : 'NG'));

  const filterTabs: { id: FilterTab; label: string; count: number }[] = [
    { id: 'all', label: '全部', count: photos.length },
    { id: 'pass', label: '放行结果', count: photoStats.ok },
    { id: 'reject', label: '剔除结果', count: photoStats.ng },
  ];

  return {
    photos,
    selectedPhoto,
    setSelectedPhoto,
    filterTab,
    setFilterTab,
    stats,
    photoStats,
    loadPhotos,
    resetStats,
    filteredPhotos,
    filterTabs,
  };
};
