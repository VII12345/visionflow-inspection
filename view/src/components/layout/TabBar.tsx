import React, { useEffect, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { api } from '../../services/api';
import type { TabId } from '../../types';

const TABS: { id: TabId; label: string; fixed: boolean }[] = [
  { id: 'run', label: '运行', fixed: true },
  { id: 'file', label: '文件', fixed: true },
  { id: 'settings', label: '设置', fixed: true },
  { id: 'test', label: '测试', fixed: true },
  { id: 'user', label: '用户', fixed: true },
];

const selectClass = 'device-select bg-white/90 border border-gray-200 rounded-md px-2.5 py-1.5 text-[12px] text-text-primary outline-none focus:border-accent transition-colors';

export const TabBar: React.FC = () => {
  const activeTab = useAppStore(s => s.activeTab);
  const setActiveTab = useAppStore(s => s.setActiveTab);
  const dynamicTabs = useAppStore(s => s.dynamicTabs);
  const closeDynamicTab = useAppStore(s => s.closeDynamicTab);
  const showMessage = useAppStore(s => s.showMessage);

  const [gpuAvailable, setGpuAvailable] = useState(false);
  const [trainingDevice, setTrainingDevice] = useState('cpu');
  const [inferenceDevice, setInferenceDevice] = useState('cpu');

  useEffect(() => {
    (async () => {
      try {
        const dev = await api.getDeviceConfig();
        if ((dev as { success: boolean }).success && (dev as { config: Record<string, string> }).config) {
          const cfg = (dev as { config: Record<string, string> }).config;
          setTrainingDevice(cfg.training_device || 'cpu');
          setInferenceDevice(cfg.inference_device || 'cpu');
        }
        const hw = await api.getHardware();
        if ((hw as { success: boolean }).success) {
          setGpuAvailable((hw as { hardware: { gpu: { cuda_available: boolean } } }).hardware.gpu.cuda_available);
        }
      } catch { /* backend may not be ready */ }
    })();
  }, []);

  const saveDevice = async (key: string, value: string) => {
    const newTraining = key === 'training' ? value : trainingDevice;
    const newInference = key === 'inference' ? value : inferenceDevice;
    try {
      await api.saveDeviceConfig({ training_device: newTraining, inference_device: newInference });
      if (key === 'training') setTrainingDevice(value);
      else setInferenceDevice(value);
      showMessage(`设备已切换: ${value}`);
    } catch { showMessage('保存失败'); }
  };

  return (
    <nav className="tab-bar flex items-center border-b shrink-0 px-6 relative">
      <div className="tab-list flex gap-0 flex-1 overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`relative inline-flex items-center px-5 py-3 text-[13px] font-medium transition-colors select-none ${
              activeTab === tab.id
                ? 'tab-item is-active text-accent'
                : 'tab-item text-text-secondary hover:text-text-primary'
            }`}
          >
            {tab.label}
          </button>
        ))}

        {Array.from(dynamicTabs).map(tabId => {
          const camId = tabId.replace('cam-detail-', '');
          return (
            <button
              key={tabId}
              onClick={() => setActiveTab(tabId as TabId)}
              className={`relative inline-flex items-center gap-1.5 px-5 py-3 text-[13px] font-medium transition-colors select-none ${
                activeTab === tabId
                  ? 'tab-item is-active text-accent'
                  : 'tab-item text-text-secondary hover:text-text-primary'
              }`}
            >
              Cam {camId} 详情
              <span
                className="ml-1 text-sm text-text-tertiary hover:text-ng px-1 transition-colors"
                onClick={(e) => { e.stopPropagation(); closeDynamicTab(tabId); }}
              >&times;</span>
            </button>
          );
        })}
      </div>
      <div className="device-panel flex items-center gap-3 shrink-0 pr-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-text-tertiary font-medium">训练</span>
          <select value={trainingDevice} onChange={e => saveDevice('training', e.target.value)} className={selectClass}>
            <option value="cpu">CPU</option>
            {gpuAvailable && <option value="cuda">GPU</option>}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-text-tertiary font-medium">推理</span>
          <select value={inferenceDevice} onChange={e => saveDevice('inference', e.target.value)} className={selectClass}>
            <option value="cpu">CPU</option>
            {gpuAvailable && <option value="cuda">GPU</option>}
          </select>
        </div>
      </div>
    </nav>
  );
};

