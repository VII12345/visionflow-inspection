import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../services/api';
import { useAppStore } from '../../store/useAppStore';
import { Button } from '../common/Modal';
import type { PhotoItem, TrendPoint } from '../../types/api';
import { TrendChart } from './TrendChart';

const inputClass = 'bg-white border border-gray-300 rounded-md px-2.5 py-1.5 text-[12px] text-text-primary outline-none focus:border-accent';
const thClass = 'px-4 py-2.5 text-left text-[11px] font-medium text-text-tertiary uppercase tracking-wide';

/** 照片浏览：分页/筛选/批量导出/良率趋势。 */
export const PhotoBrowser: React.FC = () => {
  const lineCount = useAppStore(s => s.lineCount);
  const showMessage = useAppStore(s => s.showMessage);
  const [items, setItems] = useState<PhotoItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [cameraId, setCameraId] = useState<number | undefined>(undefined);
  const [category, setCategory] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [trendInterval, setTrendInterval] = useState<'day' | 'hour'>('day');
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const firstFiltersRun = useRef(true);

  const filters = useMemo(() => {
    const start = startDate ? new Date(`${startDate}T00:00:00`).getTime() / 1000 : undefined;
    const end = endDate ? new Date(`${endDate}T23:59:59`).getTime() / 1000 : undefined;
    return { camera_id: cameraId, category: category || undefined, start, end };
  }, [cameraId, category, startDate, endDate]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.listPhotos({ ...filters, page, page_size: pageSize });
      if (result.success) {
        setItems(result.items);
        setTotal(result.total);
      }
    } catch (e) {
      showMessage(`照片列表加载失败: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [filters, page, pageSize, showMessage]);

  const loadTrend = useCallback(async () => {
    try {
      const result = await api.photoTrend({ ...filters, interval: trendInterval });
      if (result.success) setTrend(result.points);
    } catch { /* 趋势加载失败时保留上次数据 */ }
  }, [filters, trendInterval]);

  useEffect(() => { void loadTrend(); }, [loadTrend]);

  // 筛选条件变化：重置到第一页并触发一次加载，避免先用旧页码发一次无效请求
  useEffect(() => {
    if (firstFiltersRun.current) { firstFiltersRun.current = false; return; }
    setPage(1);
    setRefreshKey(k => k + 1);
  }, [filters]);

  useEffect(() => { void load(); }, [refreshKey]);

  const changePage = (next: number) => {
    const clamped = Math.min(totalPages, Math.max(1, next));
    if (clamped === page) return;
    setPage(clamped);
    setRefreshKey(k => k + 1);
  };

  const exportZip = async () => {
    setExporting(true);
    try {
      const blob = await api.exportPhotos(filters);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'photos_export.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showMessage('照片导出完成');
    } catch (e) {
      showMessage(`导出失败: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex flex-col gap-5">
      {/* 筛选条件 */}
      <div className="bg-white rounded-lg shadow-card border border-gray-100 p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-xs text-text-secondary">相机
            <select value={cameraId ?? ''} onChange={e => setCameraId(e.target.value ? Number(e.target.value) : undefined)} className={`${inputClass} ml-2`}>
              <option value="">全部</option>
              {Array.from({ length: lineCount }, (_, i) => i + 1).map(id => (
                <option key={id} value={id}>相机 {id}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-text-secondary">结果
            <select value={category} onChange={e => setCategory(e.target.value)} className={`${inputClass} ml-2`}>
              <option value="">全部</option>
              <option value="OK">放行 (OK)</option>
              <option value="NG">剔除 (NG)</option>
            </select>
          </label>
          <label className="text-xs text-text-secondary">开始日期
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={`${inputClass} ml-2`} />
          </label>
          <label className="text-xs text-text-secondary">结束日期
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={`${inputClass} ml-2`} />
          </label>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>查询</Button>
            <Button variant="primary" size="sm" onClick={() => void exportZip()} disabled={exporting}>
              {exporting ? '导出中...' : '批量导出 Zip'}
            </Button>
          </div>
        </div>
      </div>

      {/* 良率趋势 */}
      <div className="bg-white rounded-lg shadow-card border border-gray-100 p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[13px] font-semibold text-text-primary">良率趋势</h3>
          <div className="flex rounded-md border border-gray-300 overflow-hidden">
            <button onClick={() => setTrendInterval('day')} className={`px-3 py-1 text-xs transition-colors ${trendInterval === 'day' ? 'bg-accent text-white' : 'bg-white text-text-secondary'}`}>按天</button>
            <button onClick={() => setTrendInterval('hour')} className={`px-3 py-1 text-xs transition-colors ${trendInterval === 'hour' ? 'bg-accent text-white' : 'bg-white text-text-secondary'}`}>按小时</button>
          </div>
        </div>
        <TrendChart points={trend} />
      </div>

      {/* 照片列表 */}
      <div className="bg-white rounded-lg shadow-card border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] border-collapse min-w-[760px]">
            <thead className="bg-gray-50">
              <tr>
                <th className={thClass}>相机</th>
                <th className={thClass}>文件名</th>
                <th className={thClass}>类别目录</th>
                <th className={thClass}>结果</th>
                <th className={thClass}>大小</th>
                <th className={thClass}>时间</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={`${item.camId}-${item.filename}`} className="border-t border-gray-100">
                  <td className="px-4 py-2.5 text-text-tertiary">Cam {item.camId}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-text-secondary">{item.filename}</td>
                  <td className="px-4 py-2.5 text-text-secondary">{item.subdir}</td>
                  <td className="px-4 py-2.5">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${item.result === 'OK' ? 'bg-emerald-50 text-ok' : item.result === 'NG' ? 'bg-red-50 text-ng' : 'bg-gray-100 text-text-tertiary'}`}>
                      {item.result}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-text-tertiary">{item.size ? `${(item.size / 1024).toFixed(0)}K` : ''}</td>
                  <td className="px-4 py-2.5 text-text-tertiary">{item.mtime}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-text-tertiary text-xs">暂无符合条件的照片</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t border-gray-100">
          <div className="flex items-center gap-2 text-xs text-text-secondary">
            <span>共 {total} 张</span>
            <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); setRefreshKey(k => k + 1); }} className={`${inputClass} !py-1`}>
              {[20, 50, 100].map(n => <option key={n} value={n}>{n} 条/页</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2 text-xs text-text-secondary">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => changePage(page - 1)}>上一页</Button>
            <span>{page} / {totalPages}</span>
            <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => changePage(page + 1)}>下一页</Button>
          </div>
        </div>
      </div>
    </div>
  );
};
