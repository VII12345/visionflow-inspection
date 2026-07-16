import React, { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { useAppStore } from '../../store/useAppStore';
import { Button, Modal } from './Modal';

export const EnvCheckModal: React.FC = () => {
  const [result, setResult] = useState<{ passed: boolean; summary: string; results: { name: string; message: string; passed: boolean; level: string; detail?: string }[] } | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<string | null>(null);
  const setModal = useAppStore(s => s.setModal);

  useEffect(() => {
    api.envCheck().then(data => {
      setResult(data as { passed: boolean; summary: string; results: { name: string; message: string; passed: boolean; level: string; detail?: string }[] });
    }).catch(() => {});
  }, []);

  if (!result) return null;

  return (
    <Modal open={true} onClose={() => setModal('envCheck', false)} title="环境检测" width="600px"
      footer={<Button variant="secondary" onClick={() => setModal('envCheck', false)}>关闭</Button>}
    >
      <div className={`px-4 py-3 rounded-lg mb-4 text-sm font-semibold ${result.passed ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
        {result.summary}
      </div>
      <table className="w-full text-[13px]">
        <tbody>
          {result.results.map((r, i) => {
            const icon = r.passed ? '✅' : (r.level === 'error' ? '❌' : '⚠️');
            return (
              <tr key={i}
                onClick={() => r.detail && setSelectedDetail(r.detail)}
                className={`border-b border-white/[0.04] ${selectedDetail === r.detail ? 'bg-[#1e2534]' : ''} ${r.detail ? 'cursor-pointer hover:bg-white/[0.02]' : ''}`}
              >
                <td className="px-3 py-2.5 text-center text-base">{icon}</td>
                <td className="px-3 py-2.5 text-white">{r.name}</td>
                <td className={`px-3 py-2.5 ${r.passed ? 'text-emerald-400' : r.level === 'error' ? 'text-rose-400' : 'text-amber-400'}`}>{r.message}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {selectedDetail && (
        <p className="mt-4 text-xs text-gray-400 bg-[#111620] p-3 rounded-lg">💡 {selectedDetail}</p>
      )}
    </Modal>
  );
};
