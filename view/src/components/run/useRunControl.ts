import { useCallback, useState } from 'react';
import { api } from '../../services/api';
import { storage } from '../../services/storage';
import { useAppStore } from '../../store/useAppStore';

/** 运行控制：启动/停止/线路启停 + 线路启用状态。 */
export const useRunControl = (lineCount: number) => {
  const isRunning = useAppStore(s => s.isRunning);
  const setRunning = useAppStore(s => s.setRunning);
  const showMessage = useAppStore(s => s.showMessage);
  const setModal = useAppStore(s => s.setModal);
  const raiseAlarm = useAppStore(s => s.raiseAlarm);
  const user = useAppStore(s => s.user);
  const canEditRun = user?.level !== 'operator';

  const [lineEnabled, setLineEnabled] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(Array.from({ length: lineCount }, (_, index) => [index + 1, true]))
  );

  const startSystem = useCallback(async () => {
    if (!user) { setModal('login', true); return; }
    if (isRunning) { showMessage('系统已在运行中'); return; }
    try {
      const cfg = storage.getLineConfig(lineCount);
      const prods = storage.getProducts();
      const camProducts: Record<number, string> = {};
      for (const item of cfg) {
        if (item.productId) {
          const prod = prods.find(p => p.id === item.productId);
          if (prod?.learned) {
            camProducts[item.line] = prod.model;
          }
        }
      }
      const activeLineIds = Array.from({ length: lineCount }, (_, index) => index + 1).filter(camId => lineEnabled[camId] !== false);
      if (activeLineIds.length === 0) {
        showMessage('请至少启用一条线路');
        return;
      }
      const result = await api.start(camProducts, lineCount, activeLineIds);
      const startResult = result as { success: boolean; message?: string; errors?: string[] };
      if (startResult.success) {
        setRunning(true);
        showMessage('系统已启动，开始检测');
        if (startResult.errors && startResult.errors.length > 0) {
          raiseAlarm({
            title: '部分相机连接异常',
            message: startResult.message || '系统已启动，但有相机未能连接。',
            severity: 'warning',
            details: startResult.errors,
          });
        }
      } else {
        const message = startResult.message || '未知启动错误';
        showMessage('启动失败: ' + message);
        raiseAlarm({ title: '系统启动失败', message, severity: 'error', details: startResult.errors });
      }
    } catch (e) {
      const message = (e as Error).message || '检测服务无响应';
      showMessage('启动失败: ' + message);
      raiseAlarm({
        title: '系统启动连接异常',
        message: '启动过程中无法连接检测服务或相机，请检查网络和设备连接。',
        severity: 'error',
        details: [message],
      });
    }
  }, [user, isRunning, lineCount, lineEnabled, setModal, showMessage, raiseAlarm, setRunning]);

  const stopSystem = useCallback(async () => {
    if (!isRunning) { showMessage('系统已停止'); return; }
    try {
      const result = await api.stop();
      if ((result as { success: boolean }).success) {
        setRunning(false);
        showMessage('系统已停止检测');
      } else {
        showMessage('停止失败: ' + (result as { message?: string }).message);
      }
    } catch (e) {
      showMessage('停止失败: ' + (e as Error).message);
    }
  }, [isRunning, setRunning, showMessage]);

  const toggleLine = useCallback(async (camId: number) => {
    if (!canEditRun) return;
    const nextEnabled = lineEnabled[camId] === false;
    try {
      const result = await api.setLineEnabled(camId, nextEnabled);
      if (result.success) {
        setLineEnabled(previous => ({ ...previous, [camId]: nextEnabled }));
        if (typeof result.running === 'boolean') setRunning(result.running);
        showMessage(nextEnabled ? `线路 ${camId} 已启用` : `线路 ${camId} 已停用`);
      } else {
        showMessage(result.message || `线路 ${camId} 操作失败`);
      }
    } catch (error) {
      showMessage(`线路 ${camId} 操作失败: ${(error as Error).message}`);
    }
  }, [canEditRun, lineEnabled, setRunning, showMessage]);

  return { lineEnabled, canEditRun, startSystem, stopSystem, toggleLine };
};
