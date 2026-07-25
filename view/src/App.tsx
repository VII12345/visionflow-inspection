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
import { SystemAlarm } from './components/common/SystemAlarm';
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
  const raiseAlarm = useAppStore(s => s.raiseAlarm);
  const dynamicTabs = useAppStore(s => s.dynamicTabs);
  const learnCallback = useAppStore(s => s.learnCallback);

  // Startup health and environment checks. Failures are visible as a popup plus a restrained full-screen flash.
  useEffect(() => {
    let cancelled = false;
    const checkEnvironment = async () => {
      try {
        const data = await api.envCheck();
        if (cancelled) return;
        setEnvResult(data);
        const result = data as { passed: boolean; summary: string; results?: { name: string; message: string; detail?: string; level: string; passed: boolean }[] };
        if (!result.passed) {
          showMessage(`环境检测: ${result.summary}`);
          const abnormal = (result.results || []).filter(item =>
            !item.passed && (item.level === 'error' || /网络|连接|相机|MVS|SDK|导入|初始化/i.test(`${item.name}${item.message}`))
          );
          if (abnormal.length > 0) {
            raiseAlarm({
              title: '启动环境异常',
              message: result.summary || '系统启动检测发现异常，请检查设备和网络连接。',
              severity: 'error',
              details: abnormal.map(item => `${item.name}：${item.message}`),
            });
          }
        }
      } catch (error) {
        if (!cancelled) {
          raiseAlarm({
            title: '检测引擎连接失败',
            message: '系统启动时无法连接本地检测服务，请检查后端进程和 5000 端口。',
            severity: 'error',
            details: [(error as Error).message || '本地服务无响应'],
          });
        }
      }
    };
    checkEnvironment();
    return () => { cancelled = true; };
  }, [raiseAlarm, setEnvResult, showMessage]);

  useEffect(() => {
    let cancelled = false;
    let failed = false;
    const checkHealth = async () => {
      try {
        const data = await api.health();
        if (cancelled) return;
        if (data.status !== 'ok') throw new Error(`服务状态: ${data.status || '未知'}`);
        failed = false;
      } catch (error) {
        if (cancelled || failed) return;
        failed = true;
        raiseAlarm({
          title: '检测服务连接中断',
          message: '无法连接本地检测引擎，系统当前不能正常工作。',
          severity: 'error',
          details: [(error as Error).message || '健康检查失败'],
        });
      }
    };
    checkHealth();
    const interval = window.setInterval(checkHealth, 5000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [raiseAlarm]);

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

