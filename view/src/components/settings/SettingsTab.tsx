import React, { useEffect, useState, useRef, useCallback } from 'react';
import { storage } from '../../services/storage';
import { api } from '../../services/api';
import { useAppStore } from '../../store/useAppStore';
import { useTrainingStore } from '../../store/useTrainingStore';
import { Button, Badge } from '../common/Modal';
import { HardwarePanel } from './HardwarePanel';
import type { Product } from '../../types';

const inputClass = 'w-full bg-white border border-gray-300 rounded-md px-3 py-2 text-[13px] text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-colors placeholder:text-text-tertiary';
const thClass = 'px-4 py-2.5 text-left text-[11px] font-medium text-text-tertiary uppercase tracking-wide';

export const SettingsTab: React.FC = () => {
  const user = useAppStore(s => s.user);
  const setModal = useAppStore(s => s.setModal);
  const setCameraConfigCamId = useAppStore(s => s.setCameraConfigCamId);
  const isRunning = useAppStore(s => s.isRunning);
  const lineCount = useAppStore(s => s.lineCount);
  const setLineCount = useAppStore(s => s.setLineCount);
  const showMessage = useAppStore(s => s.showMessage);
  const setLearnCallback = useAppStore(s => s.setLearnCallback);
  const setTrainingResult = useTrainingStore(s => s.setResult);
  const [products, setProducts] = useState<Product[]>(storage.getProducts());
  const [filter, setFilter] = useState('');
  const [selectedModel, setSelectedModel] = useState<{ model: string; id: number } | null>(null);
  const [lineCountDraft, setLineCountDraft] = useState(String(lineCount));

  // Training progress from store (persists across tab switches)
  const trainingRunning = useTrainingStore(s => s.running);
  const trainingProgress = useTrainingStore(s => s.progress);
  const trainingProgressLabel = useTrainingStore(s => s.progressLabel);
  const trainingMetrics = useTrainingStore(s => s.metrics);
  const setTrainingProgress = useTrainingStore(s => s.setProgress);
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

  // Resume polling on mount if training was running (survives tab switch)
  useEffect(() => {
    if (trainingRunning && !pollRef.current) {
      pollTraining();
    }
  }, [trainingRunning]);



  useEffect(() => {
    const interval = setInterval(refresh, 10000);
    return () => clearInterval(interval);
  }, [refresh]);

  const saveLineCount = async () => {
    const nextCount = Number(lineCountDraft);
    if (!Number.isInteger(nextCount) || nextCount < 1 || nextCount > 16) {
      showMessage('线体数量请输入 1-16 的整数');
      return;
    }
    if (isRunning) {
      showMessage('系统运行中不能修改线体数量');
      return;
    }
    try {
      const result = await api.saveLineCount(nextCount);
      if (!result.success) {
        showMessage('保存线体数量失败: ' + (result.message || '未知错误'));
        return;
      }
      setLineCount(result.line_count || nextCount);
      setLineCountDraft(String(result.line_count || nextCount));
      showMessage(`已设置为 ${result.line_count || nextCount} 条线体，运行页 CAM 数量已同步`);
    } catch (e) {
      showMessage('保存线体数量失败: ' + (e as Error).message);
    }
  };
  const filtered = products.filter(p => `${p.name || ''} ${p.model}`.toLowerCase().includes(filter.toLowerCase()));

  const startLearning = () => {
    if (!user) { setModal('login', true); return; }
    if (user.level !== 'admin') { showMessage('需要管理员权限才能进行AI学习'); return; }
    if (!selectedModel) { showMessage('请先在左侧选择一个产品'); return; }
    setLearnCallback(confirmLearning);
    setModal('learnConfirm', true);
  };

  const confirmLearning = async (categoryRootPath: string) => {
    if (!categoryRootPath) {
      showMessage('请选择类别根目录');
      return;
    }
    try {
      const currentStatus = await api.trainingStatus();
      if (currentStatus.running) {
        setModal('learnConfirm', false);
        setTrainingProgress({ running: true, progress: currentStatus.progress, label: currentStatus.message || '训练已在运行中...', metrics: '--' });
        pollTraining();
        showMessage('检测到已有训练任务，已恢复训练进度');
        return;
      }
    } catch {
      // 状态查询失败时继续尝试启动，并由后端返回具体错误。
    }

    try {
      const result = await api.startTraining({
        categoryRootPath, folderPath: categoryRootPath,
        modelName: selectedModel!.model,
      });
      if (!result.success) {
        const message = result.message || result.error || '后端拒绝启动训练';
        showMessage('启动训练失败: ' + message);
        return;
      }
      setModal('learnConfirm', false);
      setTrainingProgress({ running: true, progress: 0, label: '正在初始化...', metrics: '--' });
      pollTraining();
      showMessage(`开始学习 ${products.find(p => p.id === selectedModel!.id)?.name || selectedModel!.model}`);
    } catch (e) {
      showMessage('启动训练失败: ' + ((e as Error).message || '无法连接后端训练服务'));
    }
  };

  const pollTraining = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const status = await api.trainingStatus();
        const label = status.message || `学习中... ${status.progress}%`;
        let metricsText = '--';
        if (status.epoch > 0) {
          metricsText = `Epoch ${status.epoch}/${status.total_epochs} | 训练Loss: ${status.train_loss.toFixed(4)} | 验证Loss: ${status.val_loss.toFixed(4)} | 验证Acc: ${(status.val_acc * 100).toFixed(1)}%`;
        } else {
          metricsText = status.message || '准备中...';
        }
        setTrainingProgress({ progress: status.progress, label, metrics: metricsText });

        if (!status.running) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setTrainingProgress({ running: false });
          const isFailed = status.message && status.message.includes('失败');
          setTrainingResult({
            modelName: selectedModel?.model || '',
            modelPath: status.modelPath || null,
            evalResult: status.evalResult || null,
            errorMessage: isFailed ? status.message : null,
            trainCount: status.trainCount || 0,
            valCount: status.valCount || 0,
          });
          setModal('trainingComplete', true);
          refresh();
        }
      } catch { /* ignore */ }
    }, 500);
  };

  const stopLearning = async () => {
    if (!trainingRunning) return;
    try { await api.stopTraining(); } catch { /* ignore */ }
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    setTrainingProgress({ running: false });
  };

  return (
    <div className="flex gap-6 h-full overflow-auto">
      {/* Left: Model List */}
      <div className="w-1/2 flex flex-col">
        <h3 className="text-[15px] font-semibold text-text-primary mb-4">已建立产品</h3>
        <input
          type="text"
          placeholder="输入产品名称或模型标识筛选..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className={`${inputClass} mb-4`}
        />
        <div className="bg-white rounded-lg shadow-card border border-gray-100 overflow-auto flex-1">
          <table className="w-full text-[13px] border-collapse">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className={thClass}>产品名称</th>
                <th className={thClass}>模型标识</th>
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
                {products.find(p => p.id === selectedModel?.id)?.name || selectedModel?.model || '未选择'}
              </span>
            </div>
            <div className="flex gap-3">
              <Button variant="learn" onClick={startLearning} disabled={trainingRunning}>开始学习</Button>
              <Button variant="secondary" size="sm" onClick={stopLearning} disabled={!trainingRunning}>停止</Button>
            </div>
            {trainingRunning && (
              <div>
                <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                  <div
                    className="h-full bg-accent rounded-full transition-all duration-300"
                    style={{ width: `${trainingProgress}%` }}
                  />
                </div>
                <p className="text-xs text-text-secondary mt-2">{trainingProgressLabel}</p>
                <p className="text-[11px] text-text-tertiary mt-1">{trainingMetrics}</p>
              </div>
            )}
          </div>
        </div>

        {/* Line Count */}
        <div className="bg-white rounded-lg shadow-card border border-gray-100 p-6">
          <h3 className="text-[15px] font-semibold text-text-primary mb-3">线体数量</h3>
          <div className="flex items-center gap-3">
            <label className="text-[13px] text-text-secondary whitespace-nowrap">运行线体 / CAM</label>
            <input
              type="number"
              min={1}
              max={16}
              value={lineCountDraft}
              onChange={e => setLineCountDraft(e.target.value)}
              disabled={isRunning}
              className={`${inputClass} !w-24`}
            />
            <Button variant="primary" size="sm" onClick={saveLineCount} disabled={isRunning}>保存</Button>
          </div>
          <p className="text-[11px] text-text-tertiary mt-3">支持 1-16 条线体；保存后运行界面 CAM 数量、帧轮询和相机配置入口同步更新。</p>
        </div>
        {/* Camera Config */}
        <div className="bg-white rounded-lg shadow-card border border-gray-100 p-6">
          <h3 className="text-[15px] font-semibold text-text-primary mb-4">相机参数设置</h3>
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: lineCount }, (_, i) => i + 1).map(camId => (
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

        <HardwarePanel />
      </div>
    </div>
  );
};
