import React, { useCallback, useEffect } from 'react';
import { useAppStore } from './store/useAppStore';
import { useTrainingStore } from './store/useTrainingStore';
import { TopBar } from './components/layout/TopBar';
import { TabBar } from './components/layout/TabBar';
import { TabRouter } from './components/layout/TabRouter';
import { CameraPopoutPage } from './components/camera/CameraPopoutPage';
import { CameraConfigModal } from './components/camera/CameraConfigModal';
import { ModalRouter } from './components/common/Modals';
import { InitialPasswordModal } from './components/common/modals/InitialPasswordModal';
import { EnvCheckModal } from './components/common/EnvCheckModal';
import { SystemAlarm } from './components/common/SystemAlarm';
import { TrainingCompleteModal } from './components/settings/TrainingCompleteModal';
import { storage } from './services/storage';
import { useHealthChecks } from './hooks/useHealthChecks';
import { useInitialPassword } from './hooks/useInitialPassword';
import { useSessionValidation } from './hooks/useSessionValidation';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useModelRefSync } from './hooks/useModelRefSync';
import { resolveProductLabel } from './utils/productLabel';

const MainApp: React.FC = () => {
  const envCheckModal = useAppStore(s => s.envCheckModal);
  const trainingCompleteModal = useAppStore(s => s.trainingCompleteModal);
  const trainingResult = useTrainingStore(s => s.result);
  const cameraConfigModal = useAppStore(s => s.cameraConfigModal);
  const cameraConfigCamId = useAppStore(s => s.cameraConfigCamId);
  const setCameraConfigCamId = useAppStore(s => s.setCameraConfigCamId);
  const setModal = useAppStore(s => s.setModal);
  const showMessage = useAppStore(s => s.showMessage);
  const statusMessage = useAppStore(s => s.statusMessage);
  const learnCallback = useAppStore(s => s.learnCallback);

  useHealthChecks();
  useSessionValidation();
  useKeyboardShortcuts();
  useModelRefSync();
  const initialPassword = useInitialPassword();

  // Storage info
  const storageInfo = storage.getStorageInfo();
  const storageInfoText = storageInfo.type === 'encrypted' ? `加密存储: ${storageInfo.path}` : `明文存储: ${storageInfo.path}`;
  useEffect(() => {
    showMessage(storageInfoText);
  }, [showMessage, storageInfoText]);

  const handleLearnConfirm = useCallback((categoryRoot: string) => {
    if (learnCallback) learnCallback(categoryRoot);
  }, [learnCallback]);

  return (
    <div className="app-shell w-full h-full flex flex-col text-text-primary font-sans overflow-hidden antialiased">
      <TopBar />
      <TabBar />

      {/* Content */}
      <main className="flex-1 overflow-hidden relative">
        <div className="content-shell w-full h-full overflow-auto">
          <TabRouter />
        </div>
      </main>

      {/* Status Bar */}
      <footer className="status-bar flex items-center justify-between gap-4 h-8 px-4 2xl:px-8 bg-surface border-t border-gray-200 shrink-0 text-[11px] text-text-tertiary relative">
        <span className="flex-1 min-w-0 truncate">{statusMessage}</span>
        <span className="shrink-0 max-w-[45%] truncate">{storageInfoText}</span>
      </footer>

      <SystemAlarm />

      {/* Modals */}
      <ModalRouter onLearnConfirm={handleLearnConfirm} />
      {envCheckModal && <EnvCheckModal />}
      {trainingCompleteModal && (
        <TrainingCompleteModal
          open={trainingCompleteModal}
          onClose={() => setModal('trainingComplete', false)}
          modelName={resolveProductLabel(storage.getProducts(), trainingResult.modelName, trainingResult.modelName)}
          modelPath={trainingResult.modelPath}
          evalResult={trainingResult.evalResult as { accuracy: number; precision: number; recall: number; f1: number; confusion_matrix: { TP: number; TN: number; FP: number; FN: number }; total: number } | null}
          errorMessage={trainingResult.errorMessage}
          trainCount={trainingResult.trainCount}
          valCount={trainingResult.valCount}
        />
      )}
      {cameraConfigModal && cameraConfigCamId !== null && (
        <CameraConfigModal
          camId={cameraConfigCamId}
          open={cameraConfigModal}
          onClose={() => setCameraConfigCamId(null)}
        />
      )}
      {initialPassword.password && (
        <InitialPasswordModal
          username={initialPassword.username || 'admin'}
          password={initialPassword.password}
          onClose={initialPassword.dismiss}
        />
      )}
    </div>
  );
};

const App: React.FC = () => {
  const match = window.location.hash.match(/^#\/camera-popout\/(\d+)$/);
  return match ? <CameraPopoutPage camId={Number(match[1])} /> : <MainApp />;
};

export default App;
