import React, { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { useAppStore } from '../../store/useAppStore';
import { Button } from './Button';
import { Modal } from './Modal';

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
      <div className={`px-4 py-3 rounded-md mb-4 text-sm font-medium ${result.passed ? 'bg-emerald-50 text-ok' : 'bg-amber-50 text-warn'}`}>
        {result.summary}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px] min-w-[440px]">
          <tbody>
            {result.results.map((r, i) => {
              const statusText = r.passed ? '通过' : (r.level === 'error' ? '错误' : '警告');
              const statusColor = r.passed ? 'text-ok' : (r.level === 'error' ? 'text-ng' : 'text-warn');
              return (
                <tr key={i}
                  onClick={() => r.detail && setSelectedDetail(r.detail)}
                  className={`border-b border-gray-100 ${selectedDetail === r.detail ? 'bg-blue-50' : ''} ${r.detail ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                >
                  <td className="px-3 py-2.5 text-xs font-medium w-16">
                    <span className={statusColor}>{statusText}</span>
                  </td>
                  <td className="px-3 py-2.5 text-text-primary font-medium">{r.name}</td>
                  <td className={`px-3 py-2.5 ${r.passed ? 'text-text-secondary' : r.level === 'error' ? 'text-ng' : 'text-warn'}`}>{r.message}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {selectedDetail && (
        <p className="mt-4 text-xs text-text-secondary bg-gray-50 p-3 rounded-md">{selectedDetail}</p>
      )}
    </Modal>
  );
};
