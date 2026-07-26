import React, { useState, useEffect } from 'react';
import { api } from '../../services/api';
import { useAppStore } from '../../store/useAppStore';
import { Button, Modal } from '../common/Modal';
import { FieldHint } from '../common/FieldHint';

interface Props {
  camId: number;
  open: boolean;
  onClose: () => void;
}

const fieldMeta: { key: string; label: string; type: 'number' | 'select' | 'toggle'; options?: { label: string; value: string }[]; hint?: string; min?: number; max?: number; step?: number }[] = [
  { key: 'triggerSource', label: '触发源', type: 'select', options: [{ label: 'Line0', value: 'Line0' }, { label: 'Line1', value: 'Line1' }, { label: 'Software', value: 'Software' }], hint: '传感器信号接入的IO口' },
  { key: 'triggerActivation', label: '触发沿', type: 'select', options: [{ label: '上升沿', value: 'RisingEdge' }, { label: '下降沿', value: 'FallingEdge' }], hint: '在信号上升/下降时触发拍照' },
  { key: 'triggerDelay', label: '触发延时 (us)', type: 'number', min: 0, max: 1000000, step: 100, hint: '收到触发信号后延时多久曝光' },
  { key: 'triggerTimeout', label: '触发超时 (ms)', type: 'number', min: 1000, max: 120000, step: 1000, hint: '等待传感器信号的最长时间' },
  { key: 'exposureTime', label: '曝光时间 (us)', type: 'number', min: 10, max: 10000000, step: 100, hint: '1000us=1ms，越大画面越亮' },
  { key: 'gain', label: '模拟增益 (dB)', type: 'number', min: 0, max: 40, step: 0.1, hint: '信号放大倍数，过高会引入噪点' },
  { key: 'lineDebouncerTime', label: '滤波时间 (us)', type: 'number', min: 0, max: 100000, step: 10, hint: '防信号抖动误触发，干扰大时调高' },
  { key: 'strobeEnable', label: '频闪输出', type: 'toggle', hint: '启用 Line1 控制外部光源' },
  { key: 'strobeDelay', label: '频闪延时 (us)', type: 'number', min: 0, max: 100000, step: 10, hint: '触发后延时多久打开光源' },
  { key: 'strobeDuration', label: '频闪持续时间 (us)', type: 'number', min: 0, max: 100000, step: 100, hint: '0=与曝光时间同步' },
];

const inputClass = 'w-full bg-white border border-gray-300 rounded-md px-3 py-2 text-[13px] text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-colors';
const labelClass = 'text-xs text-text-secondary mb-1 block';

export const CameraConfigModal: React.FC<Props> = ({ camId, open, onClose }) => {
  const showMessage = useAppStore(s => s.showMessage);
  const [enabled, setEnabled] = useState(false);
  const [ip, setIp] = useState('');
  const [fields, setFields] = useState<Record<string, string | number | boolean>>({});

  useEffect(() => {
    if (open) {
      (async () => {
        try {
          const data = await api.getCameraConfig(camId);
          if ((data as { success: boolean }).success && (data as { config: Record<string, unknown> }).config) {
            const c = (data as { config: Record<string, unknown> }).config;
            setEnabled((c.enabled as boolean) || false);
            setIp((c.ip as string) || '');
            const f: Record<string, string | number | boolean> = {};
            for (const meta of fieldMeta) {
              const raw = c[meta.key];
              f[meta.key] = (raw !== undefined && raw !== null) ? (raw as string | number | boolean) : (meta.type === 'toggle' ? false : 0);
            }
            setFields(f);
          }
        } catch (e) { showMessage('加载配置失败: ' + (e as Error).message); }
      })();
    }
  }, [open, camId]);

  const save = async () => {
    if (enabled && !/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) { showMessage('请输入有效的IP地址'); return; }
    try {
      const body: Record<string, unknown> = { enabled, ip, name: `Cam${camId}`, ...fields };
      const data = await api.saveCameraConfig(camId, body);
      if ((data as { success: boolean }).success) {
        const plcResult = data as { plcSuccess?: boolean; plcError?: string };
        showMessage(plcResult.plcSuccess === false
          ? `Cam ${camId} 配置已保存，但 PLC 同步失败：${plcResult.plcError || '未知错误'}`
          : `Cam ${camId} 配置已保存`);
        onClose();
      }
      else { showMessage('保存失败: ' + (data as { message?: string }).message); }
    } catch (e) { showMessage('保存配置失败: ' + (e as Error).message); }
  };

  const update = (key: string, value: string | number | boolean) => setFields(prev => ({ ...prev, [key]: value }));


  return (
    <Modal open={open} onClose={onClose} title={`相机 ${camId} 设置`} width="520px" closeOnBackdrop={false}
      footer={<>
        <Button variant="primary" onClick={save}>保存配置</Button>
        <Button variant="secondary" onClick={onClose}>取消</Button>
      </>}>
      <div className="flex flex-col gap-4">
        <label className="flex items-center gap-3">
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="w-4 h-4 accent-accent rounded" />
          <span className="text-[13px] text-text-primary font-medium">启用相机</span>
        </label>
        <div>
          <label className={labelClass}><FieldHint text="填写相机在当前局域网中的 IPv4 地址，例如 192.168.1.50。启用相机时必须填写正确。">IP 地址</FieldHint></label>
          <input type="text" value={ip} onChange={e => setIp(e.target.value)} placeholder="192.168.1.50"
            className={inputClass} />
        </div>
        <div className="border-t border-gray-200 pt-2" />
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          {fieldMeta.map(m => (
            <div key={m.key} className={m.type === 'toggle' ? 'col-span-2 flex items-center gap-3' : ''}>
              <label className={m.type !== 'toggle' ? labelClass : 'text-xs text-text-secondary'}><FieldHint text={m.hint || '按现场相机说明和产线要求填写；不确定时请保持原值。'}>{m.label}</FieldHint></label>
              {m.type === 'select' ? (
                <select value={String(fields[m.key] ?? '')} onChange={e => update(m.key, e.target.value)}
                  className={`${inputClass} appearance-none`}>
                  {m.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : m.type === 'toggle' ? (
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" className="sr-only peer" checked={!!fields[m.key]} onChange={e => update(m.key, e.target.checked)} />
                  <div className="w-9 h-5 bg-gray-300 rounded-full peer peer-checked:bg-accent after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full" />
                </label>
              ) : (
                <input type="number" value={Number(fields[m.key] ?? 0)} onChange={e => update(m.key, parseFloat(e.target.value) || 0)}
                  min={m.min} max={m.max} step={m.step}
                  className={inputClass} />
              )}
              {m.hint && <span className="text-[10px] text-text-tertiary mt-0.5 block">{m.hint}</span>}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
};
