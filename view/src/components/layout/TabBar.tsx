import React, { useEffect, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { api } from '../../services/api';
import type { TabId } from '../../types';
import { canAccessTab } from '../../services/permissions';

const TABS: { id: TabId; label: string; fixed: boolean }[] = [
  { id: 'run', label: '运行', fixed: true },
  { id: 'file', label: '文件', fixed: true },
  { id: 'settings', label: '设置', fixed: true },
  { id: 'models', label: '模型设置', fixed: true },
  { id: 'test', label: '测试', fixed: true },
  { id: 'user', label: '用户', fixed: true },
  { id: 'plc', label: 'PLC', fixed: true },
  { id: 'logs', label: '日志', fixed: true },
  { id: 'help', label: '说明书', fixed: true },
];

const selectClass = 'device-select bg-white/90 border border-gray-200 rounded-md px-2.5 py-1.5 text-[12px] text-text-primary outline-none focus:border-accent transition-colors';

export const TabBar: React.FC = () => {
  const activeTab = useAppStore(s => s.activeTab);
  const user = useAppStore(s => s.user);
  const canEditDevice = user?.level !== 'operator';
  const setActiveTab = useAppStore(s => s.setActiveTab);
  const dynamicTabs = useAppStore(s => s.dynamicTabs);
  const closeDynamicTab = useAppStore(s => s.closeDynamicTab);
  const showMessage = useAppStore(s => s.showMessage);

  const [gpuAvailable, setGpuAvailable] = useState(false);
  const [trainingDevice, setTrainingDevice] = useState('cpu');
  const [inferenceDevice, setInferenceDevice] = useState('cpu');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 先读取已保存配置：如果用户此前已经选择了 GPU，即使硬件详情接口
      // 暂时失败/返回旧格式，也不能把当前选项从下拉框中隐藏掉。
      try {
        const dev = await api.getDeviceConfig();
        const response = dev as { success?: boolean; config?: { training_device?: string; inference_device?: string } };
        const cfg = response.config;
        if (!cancelled && response.success && cfg) {
          const nextTraining = cfg.training_device || 'cpu';
          const nextInference = cfg.inference_device || 'cpu';
          setTrainingDevice(nextTraining);
          setInferenceDevice(nextInference);
          if (nextTraining === 'cuda' || nextInference === 'cuda') setGpuAvailable(true);
        }
      } catch { /* 后端尚未就绪时继续尝试硬件检测 */ }

      try {
        const hw = await api.getHardware();
        const response = hw as { success?: boolean; hardware?: { gpu?: { cuda_available?: boolean } } };
        if (!cancelled && response.success && response.hardware?.gpu) {
          // 只要 CUDA 可用就显示 GPU；GPU 名称/显存信息不是选择器显示的前置条件。
          setGpuAvailable(previous => previous || response.hardware!.gpu!.cuda_available === true);
        }
      } catch { /* backend may not be ready */ }
    })();
    return () => { cancelled = true; };
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
    <nav className="tab-bar flex items-center border-b shrink-0 px-3 2xl:px-6 relative">
      <div className="tab-list flex gap-0 flex-1 overflow-x-auto">
        {TABS.filter(tab => canAccessTab(user?.level || null, tab.id)).map(tab => (
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
      {canEditDevice && <div className="device-panel flex items-center gap-3 shrink-0 pr-2">
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
      </div>}
    </nav>
  );
};

