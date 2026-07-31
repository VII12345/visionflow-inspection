import { isTauri } from './native';

const isWebPage = typeof window !== 'undefined' && window.location.protocol !== 'file:' && !isTauri();
const configuredBackend = typeof window !== 'undefined'
  ? new URLSearchParams(window.location.search).get('backend')
  : null;

// Web 模式优先使用同源 /api，由 Vite web:dev/web:preview 代理到后端。
// Tauri 模式使用本机 Flask 服务。
export const API_BASE = isTauri()
  ? 'http://127.0.0.1:5000'
  : isWebPage
    ? (configuredBackend || '')
    : 'http://127.0.0.1:5000';

export async function backendFetch<T = unknown>(url: string, options?: {
  method?: string;
  body?: unknown;
  responseType?: 'blob' | string;
}): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    method: options?.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });

  if (options?.responseType === 'blob') {
    if (!res.ok) throw new Error(`后端请求失败 (${res.status})`);
    return res.blob() as Promise<T>;
  }

  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`后端返回了无效响应 (${res.status})`);
  }
  if (!res.ok) {
    const errorData = data as { message?: string; error?: string };
    throw new Error(errorData.message || errorData.error || `后端请求失败 (${res.status})`);
  }
  return data as T;
}
