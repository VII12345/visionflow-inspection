import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../services/api';
import { useAppStore } from '../../store/useAppStore';
import { usePolling } from '../../hooks/usePolling';
import { getDataPath } from '../../services/native';
import { Button } from '../common/Button';
import type { LogFileInfo, LogLine } from '../../types/api';

type LogSource = 'main' | 'error';

const LEVEL_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '全部' },
  { value: 'INFO', label: 'INFO' },
  { value: 'WARNING', label: '警告' },
  { value: 'ERROR', label: '错误' },
];

const LEVEL_CLASS: Record<string, string> = {
  DEBUG: 'text-text-tertiary',
  INFO: 'text-accent',
  WARNING: 'text-warn',
  ERROR: 'text-ng',
  CRITICAL: 'text-ng',
};

/** 日志查看页签：自动滚动 tail、级别筛选、搜索、下载。 */
export const LogTab: React.FC = () => {
  const showMessage = useAppStore(s => s.showMessage);
  const [source, setSource] = useState<LogSource>('main');
  const [level, setLevel] = useState('');
  const [search, setSearch] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [file, setFile] = useState('');
  const [files, setFiles] = useState<LogFileInfo[]>([]);
  const [dataPath, setDataPath] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickBottomRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const data = await api.getLogs(source, 500, level);
      setLines(data.lines || []);
      setFile(data.file || '');
    } catch (error) {
      showMessage(`读取日志失败: ${(error as Error).message}`);
    }
  }, [source, level, showMessage]);

  useEffect(() => {
    void load();
    api.getLogFiles().then(data => { if (data.success) setFiles(data.files || []); }).catch(() => undefined);
    getDataPath().then(setDataPath).catch(() => undefined);
  }, [load]);

  usePolling(load, 2000, autoRefresh);

  // 自动刷新时跟随到底部；用户上滚查看历史则暂停跟随
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickBottomRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
  };

  const filtered = search
    ? lines.filter(l => l.logger.includes(search) || l.message.includes(search))
    : lines;

  const onDownload = async () => {
    if (!file) return;
    try {
      const blob = await api.downloadLog(file);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file;
      anchor.click();
      URL.revokeObjectURL(url);
      showMessage(`已下载 ${file}`);
    } catch (error) {
      showMessage(`下载失败: ${(error as Error).message}`);
    }
  };

  const sourceFiles = files.filter(f => f.source === source);
  const currentSize = sourceFiles.find(f => f.name === file)?.size ?? 0;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 工具条 */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-200 bg-white shrink-0">
        <div className="flex items-center gap-1">
          {(['main', 'error'] as LogSource[]).map(s => (
            <button key={s} onClick={() => setSource(s)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${source === s ? 'bg-accent text-white' : 'bg-gray-100 text-text-secondary hover:bg-gray-200'}`}>
              {s === 'main' ? '主日志' : '错误日志'}
            </button>
          ))}
        </div>
        <div className="w-px h-5 bg-gray-200" />
        <div className="flex items-center gap-1">
          {LEVEL_OPTIONS.map(opt => (
            <button key={opt.value} onClick={() => setLevel(opt.value)}
              className={`px-2.5 py-1.5 rounded-md text-xs transition-colors ${level === opt.value ? 'bg-gray-900 text-white' : 'bg-gray-100 text-text-secondary hover:bg-gray-200'}`}>
              {opt.label}
            </button>
          ))}
        </div>
        <div className="w-px h-5 bg-gray-200" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索日志内容"
          className="w-48 px-3 py-1.5 text-xs rounded-md border border-gray-200 focus:border-accent focus:outline-none" />
        <div className="flex-1" />
        <label className="flex items-center gap-1.5 text-xs text-text-secondary select-none cursor-pointer">
          <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
          自动刷新
        </label>
        <Button variant="secondary" size="sm" onClick={() => void load()}>刷新</Button>
        <Button variant="secondary" size="sm" onClick={() => void onDownload()} disabled={!file}>下载</Button>
      </div>

      {/* 日志正文 */}
      <div ref={scrollRef} onScroll={onScroll}
        className="flex-1 min-h-0 overflow-auto bg-white p-3 text-[12px] leading-5 font-mono">
        {filtered.length === 0 ? (
          <div className="text-text-tertiary text-center py-10">
            暂无日志{search ? '（搜索结果为空）' : '（后端可能尚未写入）'}
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {filtered.map((entry, index) => (
              <div key={index} className="flex gap-2">
                <span className="text-text-tertiary shrink-0">{entry.time}</span>
                <span className={`shrink-0 w-14 ${LEVEL_CLASS[entry.level] || 'text-text-secondary'}`}>{entry.level}</span>
                <span className="text-text-tertiary shrink-0">{entry.logger}:</span>
                <span className={`flex-1 min-w-0 ${LEVEL_CLASS[entry.level] || 'text-text-primary'}`}
                  style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{entry.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 底部信息 */}
      <div className="flex items-center justify-between gap-2 px-4 py-2 border-t border-gray-200 bg-white text-[11px] text-text-tertiary shrink-0">
        <span>
          {file || '—'}（{currentSize ? `${(currentSize / 1024).toFixed(1)} KB` : '0 B'}，{sourceFiles.length} 个轮转文件）
        </span>
        <span>
          {dataPath && dataPath !== '浏览器本地存储' ? `日志目录：${dataPath}` : '历史轮转文件存放在 data 目录'}
        </span>
      </div>
    </div>
  );
};
