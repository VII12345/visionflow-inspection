import React, { useState } from 'react';
import { api } from '../../services/api';
import { useAppStore } from '../../store/useAppStore';
import { Button } from '../common/Modal';
import { inputClass } from './settingsStyles';

/** 线体数量设置卡片。 */
export const LineCountSection: React.FC = () => {
  const lineCount = useAppStore(s => s.lineCount);
  const setLineCount = useAppStore(s => s.setLineCount);
  const isRunning = useAppStore(s => s.isRunning);
  const showMessage = useAppStore(s => s.showMessage);
  const [lineCountDraft, setLineCountDraft] = useState(String(lineCount));

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

  return (
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
  );
};
