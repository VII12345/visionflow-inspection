import { useEffect, useState } from 'react';
import { api } from '../services/api';

const MAX_ATTEMPTS = 6;
const BASE_DELAY_MS = 2500;

/** 拉取尚未被消费的首次启动初始管理员密码；后端未就绪时带退避重试。 */
export const useInitialPassword = () => {
  const [password, setPassword] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let attempts = 0;

    const tryFetch = async () => {
      try {
        const data = await api.getInitialPassword();
        if (cancelled) return;
        if (data.success && data.password) {
          setPassword(data.password);
          setUsername(data.username || null);
        }
      } catch {
        if (cancelled) return;
        attempts += 1;
        if (attempts < MAX_ATTEMPTS) {
          timer = window.setTimeout(tryFetch, BASE_DELAY_MS * attempts);
        }
      }
    };

    timer = window.setTimeout(tryFetch, 1500);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  const dismiss = () => {
    setPassword(null);
    setUsername(null);
  };

  return { password, username, dismiss };
};
