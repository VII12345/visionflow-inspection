import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../services/api';
import { useAppStore } from '../../store/useAppStore';
import { Button } from '../common/Modal';
import { FieldHint } from '../common/FieldHint';
import type { PlcConfig } from '../../types';

const inputClass = 'w-full bg-white border border-gray-300 rounded-md px-3 py-2 text-[13px] text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-colors';
const labelClass = 'text-xs text-text-secondary mb-1.5 block';

const fallbackConfig: PlcConfig = {
  enabled: true,
  base_url: 'http://127.0.0.1:8088',
  timeout_seconds: 3,
  node_prefix: 'NODES.MODBUS.',
  reject_labels: ['剔除类'],
  cameras: {},
};

export const PlcTab: React.FC = () => {
  const user = useAppStore(s => s.user);
  const lineCount = useAppStore(s => s.lineCount);
  const showMessage = useAppStore(s => s.showMessage);
  const [config, setConfig] = useState<PlcConfig>(fallbackConfig);
  const [plcCameraCount, setPlcCameraCount] = useState(Math.max(1, lineCount));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);

  const cameraIds = useMemo(() => Array.from({ length: Math.max(1, plcCameraCount) }, (_, index) => index + 1), [plcCameraCount]);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.getPlcConfig();
      if (data.success) setConfig({ ...fallbackConfig, ...data.config, cameras: { ...fallbackConfig.cameras, ...data.config.cameras } });
      try {
        const countData = await api.getLineCount();
        if (countData.success && Number.isInteger(countData.line_count)) setPlcCameraCount(Math.max(1, countData.line_count));
      } catch {
        setPlcCameraCount(Math.max(1, lineCount));
      }
    } catch (error) {
      showMessage(`PLC 配置加载失败: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [lineCount]);

  const ensurePermission = () => {
    if (!user) { showMessage('请先登录'); return false; }
    if (user.level !== 'admin' && user.level !== 'tech') { showMessage('需要管理员或技术员权限'); return false; }
    return true;
  };

  const updateCamera = (camId: number, key: 'reject_time' | 'reject_delay' | 'reject_signal', value: string) => {
    setConfig(current => ({
      ...current,
      cameras: {
        ...current.cameras,
        [String(camId)]: {
          reject_time: current.cameras[String(camId)]?.reject_time || `VW${(camId - 1) * 4}`,
          reject_delay: current.cameras[String(camId)]?.reject_delay || `VW${(camId - 1) * 4 + 2}`,
          reject_signal: current.cameras[String(camId)]?.reject_signal || `MB${camId - 1}`,
          [key]: value,
        },
      },
    }));
  };

  const save = async () => {
    if (!ensurePermission()) return;
    setSaving(true);
    try {
      const data = await api.savePlcConfig(config);
      if (!data.success) throw new Error(data.error || '保存失败');
      if (data.config) setConfig(data.config);
      showMessage('PLC 配置已保存，后续写入将使用新配置');
    } catch (error) {
      showMessage(`PLC 配置保存失败: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const test = async (cameraId: number, type: 'reject_time' | 'reject_delay' | 'reject_signal') => {
    if (!ensurePermission()) return;
    const key = `${cameraId}-${type}`;
    setTesting(key);
    try {
      const data = await api.testPlcWrite({ camera_id: cameraId, type, value: type === 'reject_signal' ? 1 : 0 });
      if (!data.success) throw new Error(data.error || '测试失败');
      showMessage(`PLC 测试写入成功：${data.address} = ${data.value}`);
    } catch (error) {
      showMessage(`PLC 测试写入失败: ${(error as Error).message}`);
    } finally {
      setTesting(null);
    }
  };

  return (
    <div className="flex flex-col gap-5 h-full overflow-auto">
      <div className="bg-white rounded-lg shadow-card border border-gray-100 p-6 shrink-0">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
          <div>
            <h3 className="text-[15px] font-semibold text-text-primary">PLC 写入配置</h3>
            <p className="text-[11px] text-text-tertiary mt-1">填写 PLC 服务地址和设备节点名称；这些内容应与现场 PLC 程序中的实际配置一致，保存后立即用于后续写入。</p>
          </div>
          <label className="flex items-center gap-2 text-xs text-text-secondary whitespace-nowrap">
            <input type="checkbox" checked={config.enabled} onChange={e => setConfig(current => ({ ...current, enabled: e.target.checked }))} className="w-4 h-4 accent-accent rounded" />
            启用自动写入
          </label>
        </div>
        {loading ? <p className="text-xs text-text-tertiary">正在加载 PLC 配置...</p> : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div><label className={labelClass}><FieldHint text="填写 PLC 程序提供的 HTTP 地址，例如 http://192.168.1.10:8088。请确认电脑能访问该地址。">PLC 服务地址</FieldHint></label><input value={config.base_url} onChange={e => setConfig(c => ({ ...c, base_url: e.target.value }))} className={inputClass} placeholder="例如：http://192.168.1.10:8088" /></div>
            <div><label className={labelClass}><FieldHint text="如果 PLC 程序会自动给节点名称加统一前缀，就填写前缀；如果程序直接使用输入的完整名称，可以留空。">节点名称前缀</FieldHint></label><input value={config.node_prefix} onChange={e => setConfig(c => ({ ...c, node_prefix: e.target.value }))} className={inputClass} placeholder="例如：NODES.MODBUS.；没有前缀可留空" /></div>
            <div><label className={labelClass}><FieldHint text="填写等待 PLC 返回结果的最长时间。网络较慢时可以适当增大，通常 3 秒即可。">请求超时（秒）</FieldHint></label><input type="number" min={0.1} max={120} step={0.1} value={config.timeout_seconds} onChange={e => setConfig(c => ({ ...c, timeout_seconds: Number(e.target.value) || 3 }))} className={inputClass} /></div>
            <div className="col-span-1 xl:col-span-2"><p className="text-[11px] text-text-secondary">剔除类别请在“模型设置”中按模型分别选择；PLC 页面只负责连接地址和节点名称。</p></div>
          </div>
        )}
        <div className="flex justify-end gap-3 mt-5"><Button variant="secondary" size="sm" onClick={load}>重新加载</Button><Button variant="primary" onClick={save} disabled={saving || loading}>{saving ? '保存中...' : '保存 PLC 配置'}</Button></div>
      </div>

      <div className="bg-white rounded-lg shadow-card border border-gray-100 overflow-hidden shrink-0">
        <div className="px-6 py-4 border-b border-gray-100"><h3 className="text-[15px] font-semibold text-text-primary">相机节点映射</h3><p className="text-[11px] text-text-tertiary mt-1">当前数量来自系统实际线体/相机数量。请按 PLC 程序中的实际节点名称填写，不要照抄示例值。保存后再进行测试写入。</p></div>
        <div className="max-h-[420px] 2xl:max-h-[600px] min-h-0 overflow-auto"><table className="w-full text-[12px] border-collapse min-w-[920px]"><thead className="bg-gray-50 sticky top-0 z-10"><tr><th className="px-5 py-3 text-left text-text-tertiary font-medium">相机</th><th className="px-5 py-3 text-left text-text-tertiary font-medium">持续时间节点</th><th className="px-5 py-3 text-left text-text-tertiary font-medium">触发延时节点</th><th className="px-5 py-3 text-left text-text-tertiary font-medium">剔除信号节点</th><th className="px-5 py-3 text-left text-text-tertiary font-medium">测试写入</th></tr></thead><tbody>
          {cameraIds.map(camId => { const mapping = config.cameras[String(camId)] || { reject_time: `VW${(camId - 1) * 4}`, reject_delay: `VW${(camId - 1) * 4 + 2}`, reject_signal: `MB${camId - 1}` }; return <tr key={camId} className="border-t border-gray-100"><td className="px-5 py-3 font-medium text-text-primary">相机 {camId}</td><td className="px-5 py-2"><input value={mapping.reject_time} onChange={e => updateCamera(camId, 'reject_time', e.target.value)} className="bg-white border border-gray-200 rounded-md px-2 py-1.5 w-36 outline-none focus:border-accent" /></td><td className="px-5 py-2"><input value={mapping.reject_delay} onChange={e => updateCamera(camId, 'reject_delay', e.target.value)} className="bg-white border border-gray-200 rounded-md px-2 py-1.5 w-36 outline-none focus:border-accent" /></td><td className="px-5 py-2"><input value={mapping.reject_signal} onChange={e => updateCamera(camId, 'reject_signal', e.target.value)} className="bg-white border border-gray-200 rounded-md px-2 py-1.5 w-36 outline-none focus:border-accent" /></td><td className="px-5 py-2 whitespace-nowrap"><Button variant="secondary" size="sm" onClick={() => test(camId, 'reject_signal')} disabled={testing !== null}>{testing === `${camId}-reject_signal` ? '测试中...' : '测试信号'}</Button><Button variant="ghost" size="sm" className="ml-2" onClick={() => test(camId, 'reject_time')} disabled={testing !== null}>测试时间</Button></td></tr> })}
        </tbody></table></div>
      </div>
    </div>
  );
};
