import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../services/api';
import { useAppStore } from '../../store/useAppStore';
import { Button } from '../common/Modal';
import type { PlcConfig } from '../../types';

const inputClass = 'w-full bg-white border border-gray-300 rounded-md px-3 py-2 text-[13px] text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-colors';
const labelClass = 'text-xs text-text-secondary mb-1.5 block';

const fallbackConfig: PlcConfig = {
  enabled: true,
  base_url: 'http://127.0.0.1:8088',
  proxy_url: '',
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);

  const cameraIds = useMemo(() => Array.from({ length: Math.max(1, lineCount) }, (_, index) => index + 1), [lineCount]);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.getPlcConfig();
      if (data.success) setConfig({ ...fallbackConfig, ...data.config, cameras: { ...fallbackConfig.cameras, ...data.config.cameras } });
    } catch (error) {
      showMessage(`PLC 配置加载失败: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

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
      <div className="bg-white rounded-lg shadow-card border border-gray-100 p-6">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h3 className="text-[15px] font-semibold text-text-primary">PLC 写入配置</h3>
            <p className="text-[11px] text-text-tertiary mt-1">PLC 地址、节点前缀、触发剔除类别和各相机节点均可编辑并保存。</p>
          </div>
          <label className="flex items-center gap-2 text-xs text-text-secondary whitespace-nowrap">
            <input type="checkbox" checked={config.enabled} onChange={e => setConfig(current => ({ ...current, enabled: e.target.checked }))} className="w-4 h-4 accent-accent rounded" />
            启用自动写入
          </label>
        </div>
        {loading ? <p className="text-xs text-text-tertiary">正在加载 PLC 配置...</p> : (
          <div className="grid grid-cols-2 gap-4">
            <div><label className={labelClass}>PLC 接口地址</label><input value={config.base_url} onChange={e => setConfig(c => ({ ...c, base_url: e.target.value }))} className={inputClass} placeholder="http://127.0.0.1:8088" /></div>
            <div><label className={labelClass}>代理地址（可选）</label><input value={config.proxy_url} onChange={e => setConfig(c => ({ ...c, proxy_url: e.target.value }))} className={inputClass} placeholder="留空表示不使用代理" /></div>
            <div><label className={labelClass}>节点前缀</label><input value={config.node_prefix} onChange={e => setConfig(c => ({ ...c, node_prefix: e.target.value }))} className={inputClass} placeholder="NODES.MODBUS." /></div>
            <div><label className={labelClass}>请求超时（秒）</label><input type="number" min={0.1} max={120} step={0.1} value={config.timeout_seconds} onChange={e => setConfig(c => ({ ...c, timeout_seconds: Number(e.target.value) || 3 }))} className={inputClass} /></div>
            <div className="col-span-2"><label className={labelClass}>触发剔除的类别名称（逗号分隔）</label><input value={config.reject_labels.join(', ')} onChange={e => setConfig(c => ({ ...c, reject_labels: e.target.value.split(',').map(item => item.trim()).filter(Boolean) }))} className={inputClass} placeholder="例如：剔除类, 不合格" /><p className="text-[10px] text-text-tertiary mt-1">检测结果名称与这里任意一项匹配时，才会写入剔除信号。</p></div>
          </div>
        )}
        <div className="flex justify-end gap-3 mt-5"><Button variant="secondary" size="sm" onClick={load}>重新加载</Button><Button variant="primary" onClick={save} disabled={saving || loading}>{saving ? '保存中...' : '保存 PLC 配置'}</Button></div>
      </div>

      <div className="bg-white rounded-lg shadow-card border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100"><h3 className="text-[15px] font-semibold text-text-primary">相机节点映射</h3><p className="text-[11px] text-text-tertiary mt-1">节点名称不再写死，可按实际 PLC 程序修改。保存后再进行测试写入。</p></div>
        <div className="overflow-auto"><table className="w-full text-[12px] border-collapse min-w-[920px]"><thead className="bg-gray-50"><tr><th className="px-5 py-3 text-left text-text-tertiary font-medium">相机</th><th className="px-5 py-3 text-left text-text-tertiary font-medium">剔除时间节点</th><th className="px-5 py-3 text-left text-text-tertiary font-medium">剔除延时节点</th><th className="px-5 py-3 text-left text-text-tertiary font-medium">剔除信号节点</th><th className="px-5 py-3 text-left text-text-tertiary font-medium">测试写入</th></tr></thead><tbody>
          {cameraIds.map(camId => { const mapping = config.cameras[String(camId)] || { reject_time: `VW${(camId - 1) * 4}`, reject_delay: `VW${(camId - 1) * 4 + 2}`, reject_signal: `MB${camId - 1}` }; return <tr key={camId} className="border-t border-gray-100"><td className="px-5 py-3 font-medium text-text-primary">相机 {camId}</td><td className="px-5 py-2"><input value={mapping.reject_time} onChange={e => updateCamera(camId, 'reject_time', e.target.value)} className="bg-white border border-gray-200 rounded-md px-2 py-1.5 w-36 outline-none focus:border-accent" /></td><td className="px-5 py-2"><input value={mapping.reject_delay} onChange={e => updateCamera(camId, 'reject_delay', e.target.value)} className="bg-white border border-gray-200 rounded-md px-2 py-1.5 w-36 outline-none focus:border-accent" /></td><td className="px-5 py-2"><input value={mapping.reject_signal} onChange={e => updateCamera(camId, 'reject_signal', e.target.value)} className="bg-white border border-gray-200 rounded-md px-2 py-1.5 w-36 outline-none focus:border-accent" /></td><td className="px-5 py-2 whitespace-nowrap"><Button variant="secondary" size="sm" onClick={() => test(camId, 'reject_signal')} disabled={testing !== null}>{testing === `${camId}-reject_signal` ? '测试中...' : '测试信号'}</Button><Button variant="ghost" size="sm" className="ml-2" onClick={() => test(camId, 'reject_time')} disabled={testing !== null}>测试时间</Button></td></tr> })}
        </tbody></table></div>
      </div>
    </div>
  );
};
