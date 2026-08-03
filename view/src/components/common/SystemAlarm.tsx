import React from 'react';
import { useAppStore } from '../../store/useAppStore';
import { Button } from './Button';

export const SystemAlarm: React.FC = () => {
  const alarm = useAppStore(s => s.systemAlarm);
  const clearAlarm = useAppStore(s => s.clearAlarm);

  if (!alarm) return null;

  return (
    <>
      <div className="system-alarm-flash" aria-hidden="true" />
      <div className="fixed inset-0 z-[120] flex items-center justify-center p-6 pointer-events-none">
        <div className="system-alarm-dialog pointer-events-auto w-full max-w-[520px] rounded-xl bg-white border border-red-200 shadow-2xl p-6">
          <div className="flex items-start gap-3">
            <div className="system-alarm-icon shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-red-700 font-bold">!</div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-base font-semibold text-text-primary">{alarm.title}</h2>
                <span className="text-[10px] font-medium text-red-700 bg-red-50 border border-red-100 rounded-full px-2 py-0.5">{alarm.severity === 'warning' ? '警告' : '异常'}</span>
              </div>
              <p className="text-sm text-text-secondary leading-6">{alarm.message}</p>
              {alarm.details && alarm.details.length > 0 && (
                <ul className="mt-3 space-y-1.5 text-xs text-text-secondary bg-red-50/60 rounded-md p-3 list-disc list-inside">
                  {alarm.details.map((detail, index) => <li key={`${detail}-${index}`}>{detail}</li>)}
                </ul>
              )}
            </div>
          </div>
          <div className="mt-5 flex justify-end">
            <Button variant="danger" onClick={clearAlarm}>我知道了</Button>
          </div>
        </div>
      </div>
    </>
  );
};

export default SystemAlarm;
