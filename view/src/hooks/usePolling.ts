import { useEffect, useRef } from 'react';

/**
 * 通用轮询 hook：启用时立即执行一次并按 `ms` 间隔轮询，禁用或卸载时清理。
 * 内置 in-flight 互斥：上一轮尚未返回时跳过本轮，避免慢速请求多轮叠加。
 * `fn` 通过 ref 保存，不会因每次渲染重建而重启定时器。
 */
export function usePolling(fn: () => void | Promise<void>, ms: number, enabled = true) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const busyRef = useRef(false);

  useEffect(() => {
    if (!enabled) return undefined;

    let cancelled = false;
    const run = async () => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        await fnRef.current();
      } catch {
        // 轮询失败不向上抛，交由各轮询体自行处理错误
      } finally {
        busyRef.current = false;
        if (cancelled) return;
      }
    };

    void run();
    const interval = setInterval(() => { void run(); }, ms);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [ms, enabled]);
}
