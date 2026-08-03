import { useEffect, useRef } from 'react';
import { api } from '../../services/api';
import { useAppStore } from '../../store/useAppStore';
import { useTrainingStore } from '../../store/useTrainingStore';
import { resolveProductLabel } from '../../utils/productLabel';
import type { Product } from '../../types';

interface UseTrainingPanelOptions {
  products: Product[];
  selectedModel: { model: string; id: number } | null;
  /** 训练结束后同步产品学习状态。 */
  onTrainingComplete: () => void;
}

/** AI 训练控制：开始/确认/轮询/停止 + 训练状态。 */
export const useTrainingPanel = ({ products, selectedModel, onTrainingComplete }: UseTrainingPanelOptions) => {
  const user = useAppStore(s => s.user);
  const setModal = useAppStore(s => s.setModal);
  const showMessage = useAppStore(s => s.showMessage);
  const setLearnCallback = useAppStore(s => s.setLearnCallback);
  const setTrainingResult = useTrainingStore(s => s.setResult);
  const trainingRunning = useTrainingStore(s => s.running);
  const trainingProgress = useTrainingStore(s => s.progress);
  const trainingProgressLabel = useTrainingStore(s => s.progressLabel);
  const trainingMetrics = useTrainingStore(s => s.metrics);
  const setTrainingProgress = useTrainingStore(s => s.setProgress);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 轮询回调运行在定时器里，需始终读到最新的 selectedModel/onTrainingComplete，
  // 避免挂载恢复轮询时闭包捕获到旧值（如切换 Tab 后 selectedModel 为空）。
  const selectedModelRef = useRef(selectedModel);
  const onTrainingCompleteRef = useRef(onTrainingComplete);
  useEffect(() => { selectedModelRef.current = selectedModel; }, [selectedModel]);
  useEffect(() => { onTrainingCompleteRef.current = onTrainingComplete; }, [onTrainingComplete]);

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
            modelName: selectedModelRef.current?.model || '',
            modelPath: status.modelPath || null,
            evalResult: status.evalResult || null,
            errorMessage: isFailed ? status.message : null,
            trainCount: status.trainCount || 0,
            valCount: status.valCount || 0,
          });
          setModal('trainingComplete', true);
          onTrainingCompleteRef.current();
        }
      } catch { /* ignore */ }
    }, 500);
  };

  // Resume polling on mount if training was running (survives tab switch)
  useEffect(() => {
    if (trainingRunning && !pollRef.current) {
      pollTraining();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trainingRunning]);

  const confirmLearning = async (categoryRootPath: string) => {
    if (!categoryRootPath) {
      showMessage('请选择类别根目录');
      return;
    }
    const model = selectedModelRef.current;
    if (!model) {
      showMessage('请先选择一个产品');
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
        modelName: model.model,
      });
      if (!result.success) {
        const message = result.message || result.error || '后端拒绝启动训练';
        showMessage('启动训练失败: ' + message);
        return;
      }
      setModal('learnConfirm', false);
      setTrainingProgress({ running: true, progress: 0, label: '正在初始化...', metrics: '--' });
      pollTraining();
      showMessage(`开始学习 ${resolveProductLabel(products, model.id, model.model)}`);
    } catch (e) {
      showMessage('启动训练失败: ' + ((e as Error).message || '无法连接后端训练服务'));
    }
  };

  const startLearning = () => {
    if (!user) { setModal('login', true); return; }
    if (user.level !== 'admin') { showMessage('需要管理员权限才能进行AI学习'); return; }
    if (!selectedModel) { showMessage('请先在左侧选择一个产品'); return; }
    setLearnCallback(confirmLearning);
    setModal('learnConfirm', true);
  };

  const stopLearning = async () => {
    if (!trainingRunning) return;
    try { await api.stopTraining(); } catch { /* ignore */ }
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    setTrainingProgress({ running: false });
  };

  return {
    trainingRunning,
    trainingProgress,
    trainingProgressLabel,
    trainingMetrics,
    startLearning,
    stopLearning,
  };
};
