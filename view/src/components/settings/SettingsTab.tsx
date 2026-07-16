import React, { useEffect, useState, useRef, useCallback } from 'react';
import { storage } from '../../services/storage';
import { api } from '../../services/api';
import { useAppStore } from '../../store/useAppStore';
import { Button, Badge } from '../common/Modal';
import type { Product } from '../../types';

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

  // 自动刷新模型列表（每10秒）
  useEffect(() => {
    const interval = setInterval(refresh, 10000);
    return () => clearInterval(interval);
  }, [refresh]);

  const filtered = products.filter(p => p.model.toLowerCase().includes(filter.toLowerCase()));

  const startLearning = () => {
    if (!user) { setModal('login', true); return; }
    if (user.level !== 'admin') { showMessage('需要管理员权限才能进行AI学习'); return; }
    if (!selectedModel) { showMessage('请先在左侧选择一个产品型号'); return; }
    // Set the callback that LearnConfirmModal will invoke
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
        <h3 className="text-sm font-semibold text-white mb-3">已建立产品型号</h3>
        <input
          type="text"
          placeholder="输入型号筛选..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="bg-[#171d2b] border border-white/[0.09] rounded-lg px-3.5 py-2.5 text-[13px] text-white outline-none focus:border-[#5b6ef5] focus:shadow-[0_0_0_3px_rgba(91,110,245,0.25)] mb-3"
        />
        <div className="border border-white/[0.06] rounded-xl overflow-auto flex-1 bg-[#171d2b]">
          <table className="w-full text-[13px] border-collapse">
            <thead className="bg-[#1e2534] sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 text-left text-gray-400 font-medium">型号</th>
                <th className="px-4 py-3 text-left text-gray-400 font-medium">尺寸</th>
                <th className="px-4 py-3 text-left text-gray-400 font-medium">状态</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr
                  key={p.id}
                  onClick={() => setSelectedModel({ model: p.model, id: p.id })}
                  className={`border-t border-white/[0.04] cursor-pointer transition-colors ${
                    selectedModel?.id === p.id ? 'bg-[#5b6ef5]/[0.08]' : 'hover:bg-white/[0.02]'
                  }`}
                >
                  <td className="px-4 py-3 font-semibold text-white">{p.model}</td>
                  <td className="px-4 py-3 text-gray-400">{p.size}</td>
                  <td className="px-4 py-3">
                    {p.learned ? <Badge variant="learned">已学习</Badge> : <Badge variant="unlearned">未学习</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Right: AI Controls + Camera Config */}
      <div className="w-1/2 flex flex-col gap-6">
        {/* AI Learning */}
        <div className="bg-[#171d2b] border border-white/[0.06] rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-4">AI 学习控制</h3>
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <span className="text-gray-400 text-[13px] w-16">当前型号</span>
              <span className="text-white font-semibold text-[13px] bg-[#111620] px-3 py-2 rounded-lg border border-white/[0.06] flex-1">
                {selectedModel?.model || '未选择'}
              </span>
            </div>
            <div className="flex gap-3">
              <Button variant="learn" onClick={startLearning} disabled={learning}>开始学习</Button>
              <Button variant="secondary" size="sm" onClick={stopLearning} disabled={!learning}>停止</Button>
            </div>
            {learning && (
              <div className="mt-2">
                <div className="w-full bg-[#111620] rounded-full h-2 overflow-hidden">
                  <div
                    className="h-full bg-violet-500 rounded-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="text-xs text-gray-400 mt-2">{progressLabel}</p>
                <p className="text-[11px] text-gray-500 mt-1">{metrics}</p>
              </div>
            )}
          </div>
        </div>

        {/* Camera Config */}
        <div className="bg-[#171d2b] border border-white/[0.06] rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-4">相机参数设置</h3>
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map(camId => (
              <Button
                key={camId}
                variant="secondary"
                onClick={() => setCameraConfigCamId(camId)}
                className="!py-4 !text-sm !font-semibold !justify-start"
              >
                📷 Cam {camId}
              </Button>
            ))}
          </div>
          <p className="text-[11px] text-gray-600 mt-3">需要技术员或以上权限</p>
        </div>
      </div>
    </div>
  );
};

export const settingsConfirmLearning = (uprightPath: string, invertedPath: string, folderPath: string) => {
  // This will be connected via the LearnConfirmModal
  return { uprightPath, invertedPath, folderPath };
};
