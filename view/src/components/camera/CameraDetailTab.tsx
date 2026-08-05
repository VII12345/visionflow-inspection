import React from 'react';
import { useAppStore } from '../../store/useAppStore';
import { api } from '../../services/api';
import { PhotoListCard } from './PhotoListCard';
import { SaveSettingsCard } from './SaveSettingsCard';
import { StatsCard } from './StatsCard';
import { useCameraPhotos } from './useCameraPhotos';
import { useSaveSettings } from './useSaveSettings';

interface Props {
  camId: number;
}

export const CameraDetailTab: React.FC<Props> = ({ camId }) => {
  const isRunning = useAppStore(s => s.isRunning);
  const { saveSettings, setSaveSettings, toggleSaveGood, toggleSaveBad } = useSaveSettings(camId);
  const photos = useCameraPhotos(camId, isRunning, setSaveSettings);
  const currentSettings = saveSettings[camId] || { saveGood: true, saveBad: true };
  const selectedPhotoData = photos.selectedPhoto
    ? photos.photos.find(p => p.id === photos.selectedPhoto)
    : undefined;
  const isOk = selectedPhotoData?.result === 'OK';
  const isNg = selectedPhotoData?.result === 'NG';
  const resultBadge = isOk
    ? { text: selectedPhotoData.subdir || '放行', cls: 'bg-emerald-50 text-ok' }
    : isNg
    ? { text: selectedPhotoData.subdir || '剔除', cls: 'bg-red-50 text-ng' }
    : { text: selectedPhotoData?.subdir || '--', cls: 'bg-gray-100 text-text-tertiary' };

  return (
    <div className="flex flex-col xl:flex-row gap-5 xl:gap-6 h-full overflow-auto">
      <div className="flex-1 flex flex-col gap-4 min-w-0">
        <div className="flex-1 bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-center relative min-h-[280px]">
          {photos.selectedPhoto ? (
            <>
              <img src={api.getPhotoUrl(camId, photos.selectedPhoto)} alt={photos.selectedPhoto}
                className="max-w-[90%] max-h-[90%] object-contain rounded"
                onError={(e) => { (e.target as HTMLImageElement).alt = '加载失败'; }} />
              <span className={`absolute top-3 left-3 px-3 py-1.5 rounded-md text-sm font-semibold ${resultBadge.cls}`}>{resultBadge.text}</span>
              <span className="absolute bottom-3 left-3 text-xs text-text-tertiary bg-white/80 px-2 py-1 rounded">{photos.selectedPhoto}</span>
            </>
          ) : (
            <span className="text-text-tertiary text-sm">选择右侧照片预览</span>
          )}
        </div>
        <StatsCard camId={camId} stats={photos.stats} onResetStats={photos.resetStats} onRefresh={photos.loadPhotos} />
      </div>

      <div className="w-full xl:w-[340px] xl:shrink-0 flex flex-col gap-4 min-w-0">
        <SaveSettingsCard
          saveGood={currentSettings.saveGood}
          saveBad={currentSettings.saveBad}
          onToggleGood={toggleSaveGood}
          onToggleBad={toggleSaveBad}
        />
        <PhotoListCard
          camId={camId}
          filteredPhotos={photos.filteredPhotos}
          filterTabs={photos.filterTabs}
          filterTab={photos.filterTab}
          onFilterTabChange={photos.setFilterTab}
          selectedPhoto={photos.selectedPhoto}
          onSelectPhoto={photos.setSelectedPhoto}
          isRunning={isRunning}
        />
      </div>
    </div>
  );
};
