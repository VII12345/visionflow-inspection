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

  // 后端是线体数量的最终来源：启动时同步，避免本地缓存与实际相机槽位不一致。
  useEffect(() => {
    let cancelled = false;
    api.getLineCount().then(data => {
      if (!cancelled && data.success && Number.isInteger(data.line_count)) {
        setLineCount(data.line_count);
      }
    }).catch(() => { /* 后端健康检查会提示连接异常 */ });
    return () => { cancelled = true; };
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
