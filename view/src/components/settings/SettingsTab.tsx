import React, { useEffect, useState, useRef, useCallback } from 'react';
import { storage } from '../../services/storage';
import { api } from '../../services/api';
import { useAppStore } from '../../store/useAppStore';
import { Button, Badge } from '../common/Modal';
import type { Product } from '../../types';

const inputClass = 'w-full bg-white border border-gray-300 rounded-md px-3 py-2 text-[13px] text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-colors placeholder:text-text-tertiary';
const thClass = 'px-4 py-2.5 text-left text-[11px] font-medium text-text-tertiary uppercase tracking-wide';

export const SettingsTab: React.FC = () => {
  const user = useAppStore(s => s.user);
  const setModal = useAppStore(s => s.setModal);
  const setCameraConfigCamId = useAppStore(s => s.setCameraConfigCamId);
  const showMessage = useAppStore(s => s.showMessage);
  const setLearnCallback = useAppStore(s => s.setLearnCallback);
  const setTrainingResult = useAppStore(s => s.setTrainingResult);
  const [products, setProducts] = useState<Product[]>(storage.getProducts());
  const [filter, setFilter] = useState('');
  const [selectedModel, setSelectedModel] = useState<{ model: string; id: number } | null>(null);
  const [learning, setLearning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('准备中...');
  const [metrics, setMetrics] = useState('--');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [hwInfo, setHwInfo] = useState<{ cpu: { model: string | null; cores: number | null; arch: string | null }; gpu: { name: string | null; memory_mb: number | null; cuda_available: boolean; cuda_version: string | null; count: number }; pytorch_version: string } | null>(null);
  const [trainingDevice, setTrainingDevice] = useState('cpu');
  const [inferenceDevice, setInferenceDevice] = useState('cpu');
  const [deviceSaving, setDeviceSaving] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await api.getModels();
      if ((data as { success: boolean }).success && (data as { models: { name: string }[] }).models) {
        const trainedNames = new Set((data as { models: { name: string }[] }).models.map(m => m.name));
        const prods = storage.getProducts();
        let changed = false;
        for (const p of prods) {
          const was = p.learned;
          p.learned = trainedNames.has(p.model);
          if (p.learned !== was) changed = true;
        }
        if (changed) storage.saveProducts(prods);
        setProducts([...prods]);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    (async () => {
      try {
        const hw = await api.getHardware();
        if (hw.success) setHwInfo(hw.hardware);
        const dev = await api.getDeviceConfig();
        if (dev.success) {
          setTrainingDevice(dev.config.training_device || 'cpu');
          setInferenceDevice(dev.config.inference_device || 'cpu');
        }
      } catch { /* ignore */ }
    })();
  }, []);

  useEffect(() => {
    const interval = setInterval(refresh, 10000);
    return () => clearInterval(interval);
  }, [refresh]);

  const filtered = products.filter(p => p.model.toLowerCase().includes(filter.toLowerCase()));

  const saveDeviceConfig = async () => {
    if (!user || user.level !== 'admin') { showMessage('需要管理员权限才能修改设备配置'); return; }
    setDeviceSaving(true);
    try {
      const r = await api.saveDeviceConfig({ training_device: trainingDevice, inference_device: inferenceDevice });
      if (r.success) showMessage('设备配置已保存');
      else showMessage('保存失败: ' + (r as { message?: string }).message);
    } catch (e) { showMessage('保存失败: ' + (e as Error).message); }
    finally { setDeviceSaving(false); }
  };

  const startLearning = () => {
    if (!user) { setModal('login', true); return; }
    if (user.level !== 'admin') { showMessage('需要管理员权限才能进行AI学习'); return; }
    if (!selectedModel) { showMessage('请先在左侧选择一个产品型号'); return; }
    setLearnCallback(confirmLearning);
    setModal('learnConfirm', true);
  };

  const confirmLearning = async (uprightPath: string, invertedPath: string, folderPath: string) => {
    if (!uprightPath && !invertedPath && !folderPath) {
      showMessage('请至少选择正罐/倒罐图片目录，或指定父目录');
      return;
    }
    if ((uprightPath && !invertedPath) || (!uprightPath && invertedPath)) {
      showMessage('正罐和倒罐目录需要同时指定');
      return;
    }
    setModal('learnConfirm', false);
    try {
      const result = await api.startTraining({
        uprightPath, invertedPath, folderPath,
        modelName: selectedModel!.model,
      });
      if (!(result as { success: boolean }).success) {
        showMessage('启动训练失败: ' + (result as { message?: string }).message);
        return;
      }
      setLearning(true);
      setProgress(0);
      setProgressLabel('正在初始化...');
      setMetrics('--');
      pollTraining();
      showMessage(`开始学习 ${selectedModel!.model}`);
    } catch (e) {
      showMessage('启动训练失败: ' + (e as Error).message);
    }
  };

  const pollTraining = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const status = await api.trainingStatus();
        setProgress(status.progress);
        setProgressLabel(status.message || `学习中... ${status.progress}%`);
        if (status.epoch > 0) {
          setMetrics(`Epoch ${status.epoch}/${status.total_epochs} | 训练Loss: ${status.train_loss.toFixed(4)} | 验证Loss: ${status.val_loss.toFixed(4)} | 验证Acc: ${(status.val_acc * 100).toFixed(1)}%`);
        } else {
          setMetrics(status.message || '准备中...');
        }
        if (!status.running) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setLearning(false);
          const isFailed = status.message && status.message.includes('失败');
          setTrainingResult({
            modelName: selectedModel?.model || '',
            modelPath: (status as Record<string, unknown>).modelPath as string | null || null,
            evalResult: (status as Record<string, unknown>).evalResult as Record<string, unknown> | null || null,
            errorMessage: isFailed ? status.message : null,
            trainCount: (status as Record<string, unknown>).trainCount as number || 0,
            valCount: (status as Record<string, unknown>).valCount as number || 0,
          });
          setModal('trainingComplete', true);
          refresh();
        }
      } catch { /* ignore */ }
    }, 500);
  };

  const stopLearning = async () => {
    if (!learning) return;
    try { await api.stopTraining(); } catch { /* ignore */ }
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    setLearning(false);
  };

  return (
    <div className="flex gap-6 h-full overflow-auto">
      {/* Left: Model List */}
      <div className="w-1/2 flex flex-col">
        <h3 className="text-[15px] font-semibold text-text-primary mb-4">已建立产品型号</h3>
        <input
          type="text"
          placeholder="输入型号筛选..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className={`${inputClass} mb-4`}
        />
        <div className="bg-white rounded-lg shadow-card border border-gray-100 overflow-auto flex-1">
          <table className="w-full text-[13px] border-collapse">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className={thClass}>型号</th>
                <th className={thClass}>尺寸</th>
                <th className={thClass}>状态</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr
                  key={p.id}
                  onClick={() => setSelectedModel({ model: p.model, id: p.id })}
                  className={`border-t border-gray-100 cursor-pointer transition-colors ${
                    selectedModel?.id === p.id ? 'bg-blue-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <td className="px-4 py-3 font-medium text-text-primary">{p.model}</td>
                  <td className="px-4 py-3 text-text-secondary">{p.size}</td>
                  <td className="px-4 py-3">
                    {p.learned ? <Badge variant="learned">已学习</Badge> : <Badge variant="unlearned">未学习</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Right: AI Controls + Camera Config + Hardware */}
      <div className="w-1/2 flex flex-col gap-5">
        {/* AI Learning */}
        <div className="bg-white rounded-lg shadow-card border border-gray-100 p-6">
          <h3 className="text-[15px] font-semibold text-text-primary mb-4">AI 学习控制</h3>
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <span className="text-text-secondary text-[13px] w-16">当前型号</span>
              <span className="text-text-primary font-medium text-[13px] bg-gray-50 px-3 py-2 rounded-md flex-1">
                {selectedModel?.model || '未选择'}
              </span>
            </div>
            <div className="flex gap-3">
              <Button variant="learn" onClick={startLearning} disabled={learning}>开始学习</Button>
              <Button variant="secondary" size="sm" onClick={stopLearning} disabled={!learning}>停止</Button>
            </div>
            {learning && (
              <div>
                <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                  <div
                    className="h-full bg-accent rounded-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="text-xs text-text-secondary mt-2">{progressLabel}</p>
                <p className="text-[11px] text-text-tertiary mt-1">{metrics}</p>
              </div>
            )}
          </div>
        </div>

        {/* Camera Config */}
        <div className="bg-white rounded-lg shadow-card border border-gray-100 p-6">
          <h3 className="text-[15px] font-semibold text-text-primary mb-4">相机参数设置</h3>
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map(camId => (
              <Button
                key={camId}
                variant="secondary"
                onClick={() => setCameraConfigCamId(camId)}
                className="!py-3 !text-sm !font-medium !justify-start"
              >
                相机 {camId}
              </Button>
            ))}
          </div>
          <p className="text-[11px] text-text-tertiary mt-3">需要技术员或以上权限</p>
        </div>

        {/* Hardware & Device */}
        {hwInfo && (
          <div className="bg-white rounded-lg shadow-card border border-gray-100 p-6">
            <h3 className="text-[15px] font-semibold text-text-primary mb-4">硬件 & 运行设备</h3>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-gray-50 rounded-md p-3">
                <div className="text-[10px] text-text-tertiary uppercase tracking-wide mb-1">CPU</div>
                <div className="text-xs text-text-primary font-medium truncate">{hwInfo.cpu.model || hwInfo.cpu.arch || '未知'}</div>
                {hwInfo.cpu.cores && <div className="text-[10px] text-text-tertiary mt-0.5">{hwInfo.cpu.cores} 核</div>}
              </div>
              <div className="bg-gray-50 rounded-md p-3">
                <div className="text-[10px] text-text-tertiary uppercase tracking-wide mb-1">GPU</div>
                {hwInfo.gpu.cuda_available ? (
                  <>
                    <div className="text-xs text-ok font-medium truncate">{hwInfo.gpu.name || 'NVIDIA GPU'}</div>
                    <div className="text-[10px] text-text-tertiary mt-0.5">
                      CUDA {hwInfo.gpu.cuda_version} · {hwInfo.gpu.memory_mb ? `${(hwInfo.gpu.memory_mb / 1024).toFixed(1)} GB` : ''} · {hwInfo.gpu.count} 卡
                    </div>
                  </>
                ) : (
                  <div className="text-xs text-ng font-medium">不可用</div>
                )}
              </div>
            </div>

            <div className="text-[10px] text-text-tertiary mb-4">PyTorch {hwInfo.pytorch_version}</div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <span className="text-text-secondary text-xs w-14 shrink-0">训练设备</span>
                <select
                  value={trainingDevice}
                  onChange={e => setTrainingDevice(e.target.value)}
                  className="bg-white border border-gray-300 rounded-md px-3 py-2 text-xs text-text-primary flex-1 outline-none focus:border-accent"
                >
                  <option value="cpu">CPU</option>
                  {hwInfo.gpu.cuda_available && <option value="cuda">GPU (CUDA)</option>}
                </select>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-text-secondary text-xs w-14 shrink-0">推理设备</span>
                <select
                  value={inferenceDevice}
                  onChange={e => setInferenceDevice(e.target.value)}
                  className="bg-white border border-gray-300 rounded-md px-3 py-2 text-xs text-text-primary flex-1 outline-none focus:border-accent"
                >
                  <option value="cpu">CPU</option>
                  {hwInfo.gpu.cuda_available && <option value="cuda">GPU (CUDA)</option>}
                </select>
              </div>
              <Button variant="secondary" size="sm" onClick={saveDeviceConfig} disabled={deviceSaving}>
                {deviceSaving ? '保存中...' : '保存设备设置'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
