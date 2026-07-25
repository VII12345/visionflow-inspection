import React, { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from './store/useAppStore';
import { TopBar } from './components/layout/TopBar';
import { TabBar } from './components/layout/TabBar';
import { RunTab } from './components/run/RunTab';
import { FileTab } from './components/file/FileTab';
import { SettingsTab } from './components/settings/SettingsTab';
import { UserTab } from './components/user/UserTab';
import { TestTab } from './components/test/TestTab';
import { CameraDetailTab } from './components/camera/CameraDetailTab';
import { CameraConfigModal } from './components/camera/CameraConfigModal';
import { LoginModal, ChangePwdModal, AddProductModal, LearnConfirmModal } from './components/common/Modals';
import { EnvCheckModal } from './components/common/EnvCheckModal';
import { TrainingCompleteModal } from './components/settings/TrainingCompleteModal';
import { api } from './services/api';
import { storage } from './services/storage';
import type { TabId } from './types';

const App: React.FC = () => {
  const activeTab = useAppStore(s => s.activeTab);
  const loginModal = useAppStore(s => s.loginModal);
  const changePwdModal = useAppStore(s => s.changePwdModal);
  const addProductModal = useAppStore(s => s.addProductModal);
  const learnConfirmModal = useAppStore(s => s.learnConfirmModal);
  const envCheckModal = useAppStore(s => s.envCheckModal);
  const trainingCompleteModal = useAppStore(s => s.trainingCompleteModal);
  const trainingResult = useAppStore(s => s.trainingResult);
  const cameraConfigModal = useAppStore(s => s.cameraConfigModal);
  const cameraConfigCamId = useAppStore(s => s.cameraConfigCamId);
  const setCameraConfigCamId = useAppStore(s => s.setCameraConfigCamId);
  const setModal = useAppStore(s => s.setModal);
  const showMessage = useAppStore(s => s.showMessage);
  const statusMessage = useAppStore(s => s.statusMessage);
  const setEnvResult = useAppStore(s => s.setEnvResult);
  const dynamicTabs = useAppStore(s => s.dynamicTabs);
  const learnCallback = useAppStore(s => s.learnCallback);

  // Environment check on mount
  useEffect(() => {
    api.envCheck().then(data => {
      setEnvResult(data);
      if (!(data as { passed: boolean }).passed) {
        showMessage(`环境检测: ${(data as { summary: string }).summary}`);
      }
    }).catch(() => {});
  }, []);

  // Storage info
  useEffect(() => {
    const info = storage.getStorageInfo();
    showMessage(info.type === 'encrypted' ? `加密存储: ${info.path}` : `明文存储: ${info.path}`);
  }, []);

  // ESC key handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModal('all', false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleLearnConfirm = useCallback((upright: string, inverted: string) => {
    if (learnCallback) learnCallback(upright, inverted);
  }, [learnCallback]);

  const renderTabContent = () => {
    if (activeTab === 'run') return <RunTab />;
    if (activeTab === 'file') return <FileTab />;
    if (activeTab === 'settings') return <SettingsTab />;
    if (activeTab === 'user') return <UserTab />;
    if (activeTab === 'test') return <TestTab />;
    if (activeTab.startsWith('cam-detail-')) {
      const camId = parseInt(activeTab.replace('cam-detail-', ''));
      return <CameraDetailTab camId={camId} />;
    }
    return <RunTab />;
  };

  return (
    <div className="app-shell w-full h-full flex flex-col text-text-primary font-sans overflow-hidden antialiased">
      <TopBar />
      <TabBar />

      {/* Content */}
      <main className="flex-1 overflow-hidden relative">
        <div className="content-shell w-full h-full overflow-auto p-8">
          {renderTabContent()}
        </div>
      </main>

      {/* Status Bar */}
      <footer className="status-bar flex items-center justify-between h-8 px-8 bg-surface border-t border-gray-200 shrink-0 text-[11px] text-text-tertiary relative">
        <span>{statusMessage}</span>
        <span>{storage.getStorageInfo().type === 'encrypted' ? `加密存储: ${storage.getStorageInfo().path}` : `明文存储: ${storage.getStorageInfo().path}`}</span>
      </footer>

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
          modelName={trainingResult.modelName}
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

export default App;
