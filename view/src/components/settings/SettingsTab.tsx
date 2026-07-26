import React, { useEffect, useState, useRef, useCallback } from 'react';
import { storage } from '../../services/storage';
import { api } from '../../services/api';
import { useAppStore } from '../../store/useAppStore';
import { Button, Badge } from '../common/Modal';
import type { Product } from '../../types';

const inputClass = 'w-full bg-white border border-gray-300 rounded-md px-3 py-2 text-[13px] text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-colors placeholder:text-text-tertiary';
const thClass = 'px-4 py-2.5 text-left text-[11px] font-medium text-text-tertiary uppercase tracking-wide';

export const SettingsTab: React.FC = () => {
  const user = useAppStore(s => s.user);
  const setModal = useAppStore(s => s.setModal);
  const setCameraConfigCamId = useAppStore(s => s.setCameraConfigCamId);
  const isRunning = useAppStore(s => s.isRunning);
  const lineCount = useAppStore(s => s.lineCount);
  const setLineCount = useAppStore(s => s.setLineCount);
  const showMessage = useAppStore(s => s.showMessage);
  const setLearnCallback = useAppStore(s => s.setLearnCallback);
  const setTrainingResult = useAppStore(s => s.setTrainingResult);
  const [products, setProducts] = useState<Product[]>(storage.getProducts());
  const [filter, setFilter] = useState('');
  const [selectedModel, setSelectedModel] = useState<{ model: string; id: number } | null>(null);
  const [lineCountDraft, setLineCountDraft] = useState(String(lineCount));

  // Training progress from store (persists across tab switches)
  const trainingRunning = useAppStore(s => s.trainingRunning);
  const trainingProgress = useAppStore(s => s.trainingProgress);
  const trainingProgressLabel = useAppStore(s => s.trainingProgressLabel);
  const trainingMetrics = useAppStore(s => s.trainingMetrics);
  const setTrainingProgress = useAppStore(s => s.setTrainingProgress);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [hwInfo, setHwInfo] = useState<{
    system: { os: string | null; os_version: string | null; os_release: string | null; hostname: string | null; python_version: string | null };
    cpu: { model: string | null; physical_cores: number | null; logical_cores: number | null; max_freq_mhz: number | null; current_freq_mhz: number | null; arch: string | null; usage_percent: number | null };
    memory: { total_gb: number | null; available_gb: number | null; used_gb: number | null; percent: number | null; speed_mhz: number | null };
    gpu: { name: string | null; memory_total_mb: number | null; memory_free_mb: number | null; memory_used_mb: number | null; cuda_available: boolean; cuda_version: string | null; count: number; compute_capability: string | null };
    disk: { project_drive: string | null; total_gb: number | null; used_gb: number | null; free_gb: number | null; percent: number | null; filesystem: string | null };
    network: { name: string; type: string; up: boolean; speed_mbps: number | null; speed_rx_mbps?: number | null; speed_tx_mbps?: number | null; ipv4: string[] }[];
    pytorch_version: string;
    checks: Record<string, { label: string; pass: boolean; detail: string }>;
  } | null>(null);
  const refresh = useCallback(async () => {
    try {
      const data = await api.getModels();
      if ((data as { success: boolean }).success && (data as { models: { name: string }[] }).models) {
        const trainedNames = new Set((data as { models: { name: string }[] }).models.map(m => m.name));
        const prods = storage.getProducts();
        let changed = false;
        for (const p of prods) {
          const was = p.learned;
          p.learned = trainedNames.has(p.model);
          if (p.learned !== was) changed = true;
        }
        if (changed) storage.saveProducts(prods);
        setProducts([...prods]);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Resume polling on mount if training was running (survives tab switch)
  useEffect(() => {
    if (trainingRunning && !pollRef.current) {
      pollTraining();
    }
  }, [trainingRunning]);

  useEffect(() => {
    (async () => {
      try {
        const hw = await api.getHardware();
        if (hw.success) setHwInfo(hw.hardware);
      } catch { /* ignore */ }
    })();
  }, []);

  useEffect(() => {
    const interval = setInterval(refresh, 10000);
    return () => clearInterval(interval);
  }, [refresh]);

  const saveLineCount = async () => {
    const nextCount = Number(lineCountDraft);
    if (!Number.isInteger(nextCount) || nextCount < 1 || nextCount > 16) {
      showMessage('线体数量请输入 1-16 的整数');
      return;
    }
    if (isRunning) {
      showMessage('系统运行中不能修改线体数量');
      return;
    }
    try {
      const result = await api.saveLineCount(nextCount);
      if (!result.success) {
        showMessage('保存线体数量失败: ' + (result.message || '未知错误'));
        return;
      }
      setLineCount(result.line_count || nextCount);
      setLineCountDraft(String(result.line_count || nextCount));
      showMessage(`已设置为 ${result.line_count || nextCount} 条线体，运行页 CAM 数量已同步`);
    } catch (e) {
      showMessage('保存线体数量失败: ' + (e as Error).message);
    }
  };
  const filtered = products.filter(p => `${p.name || ''} ${p.model}`.toLowerCase().includes(filter.toLowerCase()));

  const startLearning = () => {
    if (!user) { setModal('login', true); return; }
    if (user.level !== 'admin') { showMessage('需要管理员权限才能进行AI学习'); return; }
    if (!selectedModel) { showMessage('请先在左侧选择一个产品'); return; }
    setLearnCallback(confirmLearning);
    setModal('learnConfirm', true);
  };

  const confirmLearning = async (categoryRootPath: string) => {
    if (!categoryRootPath) {
      showMessage('请选择类别根目录');
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
        modelName: selectedModel!.model,
      });
      if (!result.success) {
        const message = result.message || result.error || '后端拒绝启动训练';
        showMessage('启动训练失败: ' + message);
        return;
      }
      setModal('learnConfirm', false);
      setTrainingProgress({ running: true, progress: 0, label: '正在初始化...', metrics: '--' });
      pollTraining();
      showMessage(`开始学习 ${products.find(p => p.id === selectedModel!.id)?.name || selectedModel!.model}`);
    } catch (e) {
      showMessage('启动训练失败: ' + ((e as Error).message || '无法连接后端训练服务'));
    }
  };

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
            modelName: selectedModel?.model || '',
            modelPath: (status as Record<string, unknown>).modelPath as string | null || null,
            evalResult: (status as Record<string, unknown>).evalResult as Record<string, unknown> | null || null,
            errorMessage: isFailed ? status.message : null,
            trainCount: (status as Record<string, unknown>).trainCount as number || 0,
            valCount: (status as Record<string, unknown>).valCount as number || 0,
          });
          setModal('trainingComplete', true);
          refresh();
        }
      } catch { /* ignore */ }
    }, 500);
  };

  const stopLearning = async () => {
    if (!trainingRunning) return;
    try { await api.stopTraining(); } catch { /* ignore */ }
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    setTrainingProgress({ running: false });
  };

  return (
    <div className="flex gap-6 h-full overflow-auto">
      {/* Left: Model List */}
      <div className="w-1/2 flex flex-col">
        <h3 className="text-[15px] font-semibold text-text-primary mb-4">已建立产品</h3>
        <input
          type="text"
          placeholder="输入产品名称或模型标识筛选..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className={`${inputClass} mb-4`}
        />
        <div className="bg-white rounded-lg shadow-card border border-gray-100 overflow-auto flex-1">
          <table className="w-full text-[13px] border-collapse">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className={thClass}>产品名称</th>
                <th className={thClass}>模型标识</th>
                <th className={thClass}>尺寸</th>
                <th className={thClass}>状态</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr
                  key={p.id}
                  onClick={() => setSelectedModel({ model: p.model, id: p.id })}
                  className={`border-t border-gray-100 cursor-pointer transition-colors ${
                    selectedModel?.id === p.id ? 'bg-blue-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <td className="px-4 py-3 font-medium text-text-primary">{p.model}</td>
                  <td className="px-4 py-3 text-text-secondary">{p.size}</td>
                  <td className="px-4 py-3">
                    {p.learned ? <Badge variant="learned">已学习</Badge> : <Badge variant="unlearned">未学习</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Right: AI Controls + Camera Config + Hardware */}
      <div className="w-1/2 flex flex-col gap-5">
        {/* AI Learning */}
        <div className="bg-white rounded-lg shadow-card border border-gray-100 p-6">
          <h3 className="text-[15px] font-semibold text-text-primary mb-4">AI 学习控制</h3>
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <span className="text-text-secondary text-[13px] w-16">当前型号</span>
              <span className="text-text-primary font-medium text-[13px] bg-gray-50 px-3 py-2 rounded-md flex-1">
                {products.find(p => p.id === selectedModel?.id)?.name || selectedModel?.model || '未选择'}
              </span>
            </div>
            <div className="flex gap-3">
              <Button variant="learn" onClick={startLearning} disabled={trainingRunning}>开始学习</Button>
              <Button variant="secondary" size="sm" onClick={stopLearning} disabled={!trainingRunning}>停止</Button>
            </div>
            {trainingRunning && (
              <div>
                <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                  <div
                    className="h-full bg-accent rounded-full transition-all duration-300"
                    style={{ width: `${trainingProgress}%` }}
                  />
                </div>
                <p className="text-xs text-text-secondary mt-2">{trainingProgressLabel}</p>
                <p className="text-[11px] text-text-tertiary mt-1">{trainingMetrics}</p>
              </div>
            )}
          </div>
        </div>

        {/* Line Count */}
        <div className="bg-white rounded-lg shadow-card border border-gray-100 p-6">
          <h3 className="text-[15px] font-semibold text-text-primary mb-3">线体数量</h3>
          <div className="flex items-center gap-3">
            <label className="text-[13px] text-text-secondary whitespace-nowrap">运行线体 / CAM</label>
            <input
              type="number"
              min={1}
              max={16}
              value={lineCountDraft}
              onChange={e => setLineCountDraft(e.target.value)}
              disabled={isRunning}
              className={`${inputClass} !w-24`}
            />
            <Button variant="primary" size="sm" onClick={saveLineCount} disabled={isRunning}>保存</Button>
          </div>
          <p className="text-[11px] text-text-tertiary mt-3">支持 1-16 条线体；保存后运行界面 CAM 数量、帧轮询和相机配置入口同步更新。</p>
        </div>
        {/* Camera Config */}
        <div className="bg-white rounded-lg shadow-card border border-gray-100 p-6">
          <h3 className="text-[15px] font-semibold text-text-primary mb-4">相机参数设置</h3>
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: lineCount }, (_, i) => i + 1).map(camId => (
              <Button
                key={camId}
                variant="secondary"
                onClick={() => setCameraConfigCamId(camId)}
                className="!py-3 !text-sm !font-medium !justify-start"
              >
                相机 {camId}
              </Button>
            ))}
          </div>
          <p className="text-[11px] text-text-tertiary mt-3">需要技术员或以上权限</p>
        </div>

        {/* Hardware & Device */}
        {hwInfo && (
          <div className="bg-white rounded-lg shadow-card border border-gray-100 p-6">
            <h3 className="text-[15px] font-semibold text-text-primary mb-4">系统信息</h3>

            {/* Hardware Check */}
            {hwInfo.checks && (
              <div className="mb-4">
                <div className="text-[10px] text-text-tertiary uppercase tracking-wide mb-2">达标检测</div>
                <div className="bg-gray-50 rounded-md p-3 space-y-1.5">
                  {Object.entries(hwInfo.checks)
                    .filter(([k]) => k !== '_all_pass')
                    .map(([key, check]) => (
                      <div key={key} className="flex justify-between items-center text-xs">
                        <span className="text-text-secondary">{check.label}</span>
                        <span className={`font-medium ${check.pass ? 'text-ok' : 'text-ng'}`}>
                          {check.pass ? '通过' : '未达标'}
                        </span>
                      </div>
                    ))}
                  <div className="border-t border-gray-200 pt-1.5 mt-1 flex justify-between items-center text-xs">
                    <span className="text-text-primary font-semibold">综合评估</span>
                    <span className={`font-semibold ${hwInfo.checks._all_pass ? 'text-ok' : 'text-ng'}`}>
                      {hwInfo.checks._all_pass ? '全部通过' : '部分未达标'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* CPU */}
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="text-[10px] text-text-tertiary uppercase tracking-wide">处理器 (CPU)</div>
                {hwInfo.checks?.cpu_cores && (
                  <span className={`text-[10px] font-medium ${hwInfo.checks.cpu_cores.pass ? 'text-ok' : 'text-ng'}`}>
                    {hwInfo.checks.cpu_cores.pass ? '已达标' : '未达标'}
                  </span>
                )}
              </div>
              <div className="bg-gray-50 rounded-md p-3 space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-text-tertiary">型号</span>
                  <span className="text-text-primary font-medium truncate ml-4 max-w-[220px]">{hwInfo.cpu.model || hwInfo.cpu.arch || '未知'}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-text-tertiary">架构</span>
                  <span className="text-text-primary font-medium">{hwInfo.cpu.arch || '--'}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-text-tertiary">物理核心</span>
                  <span className="text-text-primary font-medium">{hwInfo.cpu.physical_cores ?? '--'} 核</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-text-tertiary">逻辑线程</span>
                  <span className="text-text-primary font-medium">{hwInfo.cpu.logical_cores ?? '--'} 线程</span>
                </div>
                {hwInfo.cpu.max_freq_mhz && (
                  <div className="flex justify-between text-xs">
                    <span className="text-text-tertiary">最大频率</span>
                    <span className="text-text-primary font-medium">{(hwInfo.cpu.max_freq_mhz / 1000).toFixed(1)} GHz</span>
                  </div>
                )}
                {hwInfo.cpu.current_freq_mhz && (
                  <div className="flex justify-between text-xs">
                    <span className="text-text-tertiary">当前频率</span>
                    <span className="text-text-primary font-medium">{(hwInfo.cpu.current_freq_mhz / 1000).toFixed(1)} GHz</span>
                  </div>
                )}
                {hwInfo.cpu.usage_percent != null && (
                  <div className="flex justify-between text-xs">
                    <span className="text-text-tertiary">当前占用</span>
                    <span className="text-text-primary font-medium">{hwInfo.cpu.usage_percent}%</span>
                  </div>
                )}
              </div>
            </div>

            {/* Memory */}
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="text-[10px] text-text-tertiary uppercase tracking-wide">内存 (RAM)</div>
                {hwInfo.checks?.memory_total && (
                  <span className={`text-[10px] font-medium ${hwInfo.checks.memory_total.pass ? 'text-ok' : 'text-ng'}`}>
                    {hwInfo.checks.memory_total.pass ? '已达标' : '未达标'}
                  </span>
                )}
              </div>
              <div className="bg-gray-50 rounded-md p-3 space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-text-tertiary">总容量</span>
                  <span className="text-text-primary font-medium">{hwInfo.memory.total_gb ?? '--'} GB</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-text-tertiary">已使用</span>
                  <span className="text-text-primary font-medium">{hwInfo.memory.used_gb ?? '--'} GB</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-text-tertiary">可用</span>
                  <span className="text-text-primary font-medium">{hwInfo.memory.available_gb ?? '--'} GB</span>
                </div>
                {hwInfo.memory.speed_mhz && (
                  <div className="flex justify-between text-xs">
                    <span className="text-text-tertiary">频率</span>
                    <span className="text-text-primary font-medium">{hwInfo.memory.speed_mhz} MHz</span>
                  </div>
                )}
                <div className="flex justify-between text-xs">
                  <span className="text-text-tertiary">使用率</span>
                  <span className={`font-medium ${hwInfo.memory.percent != null && hwInfo.memory.percent > 80 ? 'text-warn' : 'text-text-primary'}`}>{hwInfo.memory.percent ?? '--'}%</span>
                </div>
              </div>
            </div>

            {/* GPU */}
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="text-[10px] text-text-tertiary uppercase tracking-wide">显卡 (GPU)</div>
                {hwInfo.checks?.gpu_cuda && (
                  <span className={`text-[10px] font-medium ${hwInfo.checks.gpu_cuda.pass ? 'text-ok' : 'text-ng'}`}>
                    {hwInfo.checks.gpu_cuda.pass ? '已达标' : '未达标'}
                  </span>
                )}
              </div>
              <div className="bg-gray-50 rounded-md p-3 space-y-1.5">
                {hwInfo.gpu.cuda_available ? (
                  <>
                    <div className="flex justify-between text-xs">
                      <span className="text-text-tertiary">型号</span>
                      <span className="text-ok font-medium truncate ml-4 max-w-[200px]">{hwInfo.gpu.name || 'NVIDIA GPU'}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-text-tertiary">数量</span>
                      <span className="text-text-primary font-medium">{hwInfo.gpu.count} 卡</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-text-tertiary">显存总量</span>
                      <span className="text-text-primary font-medium">{hwInfo.gpu.memory_total_mb ? `${(hwInfo.gpu.memory_total_mb / 1024).toFixed(1)} GB` : '--'}</span>
                    </div>
                    {hwInfo.gpu.memory_used_mb != null && (
                      <div className="flex justify-between text-xs">
                        <span className="text-text-tertiary">显存已用</span>
                        <span className="text-text-primary font-medium">{(hwInfo.gpu.memory_used_mb / 1024).toFixed(1)} GB</span>
                      </div>
                    )}
                    {hwInfo.gpu.memory_free_mb != null && (
                      <div className="flex justify-between text-xs">
                        <span className="text-text-tertiary">显存空闲</span>
                        <span className="text-text-primary font-medium">{(hwInfo.gpu.memory_free_mb / 1024).toFixed(1)} GB</span>
                      </div>
                    )}
                    <div className="flex justify-between text-xs">
                      <span className="text-text-tertiary">CUDA 版本</span>
                      <span className="text-text-primary font-medium">{hwInfo.gpu.cuda_version || '--'}</span>
                    </div>
                    {hwInfo.gpu.compute_capability && (
                      <div className="flex justify-between text-xs">
                        <span className="text-text-tertiary">计算能力</span>
                        <span className="text-text-primary font-medium">{hwInfo.gpu.compute_capability}</span>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-xs text-ng font-medium text-center py-2">无可用 GPU (CUDA 不可用)</div>
                )}
              </div>
            </div>

            {/* Disk */}
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="text-[10px] text-text-tertiary uppercase tracking-wide">项目硬盘</div>
                {hwInfo.checks?.disk_free && (
                  <span className={`text-[10px] font-medium ${hwInfo.checks.disk_free.pass ? 'text-ok' : 'text-ng'}`}>
                    {hwInfo.checks.disk_free.pass ? '已达标' : '未达标'}
                  </span>
                )}
              </div>
              <div className="bg-gray-50 rounded-md p-3 space-y-1.5">
                {hwInfo.disk.project_drive && (
                  <div className="flex justify-between text-xs">
                    <span className="text-text-tertiary">路径</span>
                    <span className="text-text-primary font-medium truncate ml-4 max-w-[180px]">{hwInfo.disk.project_drive}</span>
                  </div>
                )}
                {hwInfo.disk.filesystem && (
                  <div className="flex justify-between text-xs">
                    <span className="text-text-tertiary">文件系统</span>
                    <span className="text-text-primary font-medium">{hwInfo.disk.filesystem}</span>
                  </div>
                )}
                <div className="flex justify-between text-xs">
                  <span className="text-text-tertiary">总容量</span>
                  <span className="text-text-primary font-medium">{hwInfo.disk.total_gb ?? '--'} GB</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-text-tertiary">已使用</span>
                  <span className="text-text-primary font-medium">{hwInfo.disk.used_gb ?? '--'} GB</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-text-tertiary">可用空间</span>
                  <span className={`font-medium ${hwInfo.disk.free_gb != null && hwInfo.disk.free_gb < 10 ? 'text-warn' : 'text-text-primary'}`}>{hwInfo.disk.free_gb ?? '--'} GB</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-text-tertiary">使用率</span>
                  <span className={`font-medium ${hwInfo.disk.percent != null && hwInfo.disk.percent > 80 ? 'text-warn' : 'text-text-primary'}`}>{hwInfo.disk.percent ?? '--'}%</span>
                </div>
              </div>
            </div>

            {/* System */}
            <div className="mb-4">
              <div className="text-[10px] text-text-tertiary uppercase tracking-wide mb-2">系统环境</div>
              <div className="bg-gray-50 rounded-md p-3 space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-text-tertiary">操作系统</span>
                  <span className="text-text-primary font-medium">{hwInfo.system.os ?? '--'} {hwInfo.system.os_release ?? ''}</span>
                </div>
                {hwInfo.system.hostname && (
                  <div className="flex justify-between text-xs">
                    <span className="text-text-tertiary">主机名</span>
                    <span className="text-text-primary font-medium">{hwInfo.system.hostname}</span>
                  </div>
                )}
                <div className="flex justify-between text-xs">
                  <span className="text-text-tertiary">Python</span>
                  <span className="text-text-primary font-medium">{hwInfo.system.python_version ?? '--'}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-text-tertiary">PyTorch</span>
                  <span className="text-text-primary font-medium">{hwInfo.pytorch_version}</span>
                </div>
              </div>
            </div>

            {/* Network */}
            {hwInfo.network && hwInfo.network.length > 0 && (
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="text-[10px] text-text-tertiary uppercase tracking-wide">网络接口</div>
                  {hwInfo.checks?.network_speed && (
                    <span className={`text-[10px] font-medium ${hwInfo.checks.network_speed.pass ? 'text-ok' : 'text-ng'}`}>
                      {hwInfo.checks.network_speed.pass ? '已达标' : '未达标'}
                    </span>
                  )}
                </div>
                <div className="bg-gray-50 rounded-md p-3 space-y-2">
                  {hwInfo.network
                    .filter(iface => iface.type === '以太网' || iface.type === 'WiFi')
                    .map((iface, i, arr) => {
                    const formatSpeed = (mbps: number | null | undefined) => {
                      if (mbps == null) return null;
                      return mbps >= 1000 ? `${(mbps / 1000).toFixed(1)} Gbps` : `${mbps} Mbps`;
                    };
                    const hasRxTx = iface.speed_rx_mbps != null || iface.speed_tx_mbps != null;
                    return (
                      <div key={i} className={`flex items-center justify-between text-xs py-1 ${i < arr.length - 1 ? 'border-b border-gray-100' : ''}`}>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${iface.up ? 'bg-ok' : 'bg-gray-300'}`} />
                          <span className="text-text-primary font-medium truncate">{iface.name}</span>
                          <span className="text-[10px] text-text-tertiary bg-gray-200 rounded px-1.5 py-0.5 shrink-0">{iface.type}</span>
                        </div>
                        <span className="text-text-primary font-medium shrink-0 ml-3 text-right">
                          {hasRxTx ? (
                            <span>
                              <span className="text-text-tertiary text-[10px]">RX </span>
                              {formatSpeed(iface.speed_rx_mbps) ?? '--'}
                              <span className="text-text-tertiary text-[10px]"> TX </span>
                              {formatSpeed(iface.speed_tx_mbps) ?? '--'}
                            </span>
                          ) : (
                            formatSpeed(iface.speed_mbps) ?? (iface.up ? '已连接' : '未连接')
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
};

