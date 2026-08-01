import { useState } from 'react';
import { api } from '../../services/api';
import { storage } from '../../services/storage';
import { useAppStore } from '../../store/useAppStore';

/** 保存设置（放行/剔除照片开关）状态与更新逻辑。 */
export const useSaveSettings = (camId: number) => {
  const showMessage = useAppStore(s => s.showMessage);
  const [saveSettings, setSaveSettings] = useState<Record<number, { saveGood: boolean; saveBad: boolean }>>(storage.getSaveSettings());

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

  return { saveSettings, setSaveSettings, toggleSaveGood, toggleSaveBad };
};
