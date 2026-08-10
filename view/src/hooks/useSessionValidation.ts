import { useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { api } from '../services/api';

const MAX_ATTEMPTS = 6;
const BASE_DELAY_MS = 2500;
const FIRST_DELAY_MS = 1000;

/** 启动时校验"保持登录"恢复的会话是否仍有效。
 *
 * 会话信息只存在前端 localStorage（独立于后端 data 目录），数据目录被清空/密钥轮换、
 * 用户被删、token 过期都不会自动失效，导致界面残留已不存在的登录态。
 * 这里用 /api/auth/me 无条件校验 token：401 时由 backendFetch 触发 handleUnauthorized
 * 清会话并弹登录框；后端未就绪的网络错误则退避重试，不误登出。
 */
export const useSessionValidation = () => {
  useEffect(() => {
    const token = useAppStore.getState().authToken;
    if (!token) return;

    let cancelled = false;
    let attempts = 0;

    const check = async () => {
      if (cancelled) return;
      if (!useAppStore.getState().authToken) return; // 已被 401 清空，无需继续
      try {
        const data = await api.me();
        if (cancelled) return;
        if (data.success && data.user) {
          useAppStore.getState().setAuthUser(data.user, token);
        }
      } catch (error) {
        if (cancelled) return;
        if ((error as { status?: number }).status === 401) return; // 已触发 handleUnauthorized
        attempts += 1;
        if (attempts < MAX_ATTEMPTS) {
          window.setTimeout(check, BASE_DELAY_MS * attempts);
        }
      }
    };

    const timer = window.setTimeout(check, FIRST_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);
};
