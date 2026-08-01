import React, { useCallback, useEffect } from 'react';
import { useAppStore } from './store/useAppStore';
import { useTrainingStore } from './store/useTrainingStore';
import { TopBar } from './components/layout/TopBar';
import { TabBar } from './components/layout/TabBar';
import { TabRouter } from './components/layout/TabRouter';
import { CameraPopoutPage } from './components/camera/CameraPopoutPage';
import { CameraConfigModal } from './components/camera/CameraConfigModal';
import { LoginModal, ChangePwdModal, AddProductModal, LearnConfirmModal } from './components/common/Modals';
import { EnvCheckModal } from './components/common/EnvCheckModal';
import { SystemAlarm } from './components/common/SystemAlarm';
import { TrainingCompleteModal } from './components/settings/TrainingCompleteModal';
import { storage } from './services/storage';
import { useHealthChecks } from './hooks/useHealthChecks';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

const MainApp: React.FC = () => {
  const loginModal = useAppStore(s => s.loginModal);
  const changePwdModal = useAppStore(s => s.changePwdModal);
  const addProductModal = useAppStore(s => s.addProductModal);
  const learnConfirmModal = useAppStore(s => s.learnConfirmModal);
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
  useKeyboardShortcuts();

  // Storage info
  useEffect(() => {
    const info = storage.getStorageInfo();
    showMessage(info.type === 'encrypted' ? `加密存储: ${info.path}` : `明文存储: ${info.path}`);
  }, [showMessage]);

  const handleLearnConfirm = useCallback((categoryRoot: string) => {
    if (learnCallback) learnCallback(categoryRoot);
  }, [learnCallback]);

  return (
    <div className="app-shell w-full h-full flex flex-col text-text-primary font-sans overflow-hidden antialiased">
      <TopBar />
      <TabBar />

      {/* Content */}
      <main className="flex-1 overflow-hidden relative">
        <div className="content-shell w-full h-full overflow-auto p-8">
          <TabRouter />
        </div>
      </main>

      {/* Status Bar */}
      <footer className="status-bar flex items-center justify-between h-8 px-8 bg-surface border-t border-gray-200 shrink-0 text-[11px] text-text-tertiary relative">
        <span>{statusMessage}</span>
        <span>{storage.getStorageInfo().type === 'encrypted' ? `加密存储: ${storage.getStorageInfo().path}` : `明文存储: ${storage.getStorageInfo().path}`}</span>
      </footer>

      <SystemAlarm />

      {/* Modals */}
      {loginModal && <LoginModal />}
      {changePwdModal && <ChangePwdModal />}
      {addProductModal && <AddProductModal />}
      {learnConfirmModal && <LearnConfirmModal onConfirm={handleLearnConfirm} />}
      {envCheckModal && <EnvCheckModal />}
      {trainingCompleteModal && (
        <TrainingCompleteModal
          open={trainingCompleteModal}
          onClose={() => setModal('trainingComplete', false)}
          modelName={storage.getProducts().find(product => product.model === trainingResult.modelName)?.name || trainingResult.modelName}
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
    </div>
  );
};

const App: React.FC = () => {
  const match = window.location.hash.match(/^#\/camera-popout\/(\d+)$/);
  return match ? <CameraPopoutPage camId={Number(match[1])} /> : <MainApp />;
};

export default App;
