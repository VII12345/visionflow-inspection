import { useEffect } from 'react';
import { api } from '../services/api';
import { useAppStore } from '../store/useAppStore';

const STARTUP_CHECK_DELAY_MS = 7000;

/** 启动期健康与环境检查（线体数同步 + 环境检测 + 健康轮询）。 */
export const useHealthChecks = () => {
  const showMessage = useAppStore(s => s.showMessage);
  const setEnvResult = useAppStore(s => s.setEnvResult);
  const setLineCount = useAppStore(s => s.setLineCount);
  const raiseAlarm = useAppStore(s => s.raiseAlarm);

  // 后端启动可能晚于 Tauri 前端（首次模型预加载尤其明显）。持续重试，
  // 避免唯一一次启动请求过早失败后所有界面一直保留默认的 4 条线体。
  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;

    const syncLineCount = async () => {
      try {
        const data = await api.getLineCount();
        if (cancelled) return;
        if (data.success && Number.isInteger(data.line_count) && data.line_count >= 1 && data.line_count <= 16) {
          setLineCount(data.line_count);
          return;
        }
      } catch { /* 后端尚未就绪，稍后重试 */ }
      if (!cancelled) retryTimer = window.setTimeout(syncLineCount, 1000);
    };

    void syncLineCount();
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [setLineCount]);

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
    const startupTimer = window.setTimeout(checkEnvironment, STARTUP_CHECK_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(startupTimer);
    };
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
    let interval: number | undefined;
    const startupTimer = window.setTimeout(() => {
      checkHealth();
      interval = window.setInterval(checkHealth, 5000);
    }, STARTUP_CHECK_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(startupTimer);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, [raiseAlarm]);
};
