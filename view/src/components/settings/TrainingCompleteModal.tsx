import React from 'react';
import { Modal, Button } from '../common/Modal';

interface EvalResult {
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  confusion_matrix: { TP: number; TN: number; FP: number; FN: number };
  total: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  modelName: string;
  modelPath: string | null;
  evalResult: EvalResult | null;
  errorMessage: string | null;
  trainCount: number;
  valCount: number;
}

const MetricRow: React.FC<{ label: string; value: number; suffix?: string; color?: string }> = ({
  label, value, suffix = '%', color = 'text-white',
}) => (
  <div className="flex justify-between items-center py-2 border-b border-white/[0.05]">
    <span className="text-gray-400 text-[13px]">{label}</span>
    <span className={`text-[13px] font-semibold ${color}`}>
      {Number.isFinite(value) ? (value * 100).toFixed(1) : '--'}{suffix}
    </span>
  </div>
);

export const TrainingCompleteModal: React.FC<Props> = ({
  open, onClose, modelName, modelPath, evalResult, errorMessage, trainCount, valCount,
}) => {
  if (!open) return null;

  const isError = !!errorMessage;
  const cm = evalResult?.confusion_matrix;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isError ? '⚠️ 训练失败' : '✅ 训练完成'}
      width="520px"
      footer={<Button variant="primary" onClick={onClose}>确定</Button>}
    >
      <div className="flex flex-col gap-4">
        {/* Header info */}
        <div className="bg-[#1a1f2e] rounded-lg p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-gray-500">产品型号</span>
            <span className="text-sm font-semibold text-white">{modelName || '--'}</span>
          </div>
          {(trainCount > 0 || valCount > 0) && (
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-gray-500">数据分布</span>
              <span className="text-xs text-gray-400">训练集 {trainCount} 张 · 验证集 {valCount} 张（用于评估）</span>
            </div>
          )}
          {modelPath && (
            <div className="flex items-start gap-2">
              <span className="text-xs text-gray-500 shrink-0">保存位置</span>
              <span className="text-xs text-gray-400 break-all font-mono">{modelPath}</span>
            </div>
          )}
        </div>

        {isError ? (
          /* Error display */
          <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg p-4">
            <p className="text-rose-400 text-[13px]">{errorMessage}</p>
          </div>
        ) : (
          <>
            {/* Evaluation metrics */}
            <div>
              <h4 className="text-xs text-gray-500 mb-2 uppercase tracking-wider">评估指标</h4>
              <div className="bg-[#1a1f2e] rounded-lg px-4">
                <MetricRow label="准确率 (Accuracy)" value={evalResult?.accuracy ?? 0} color="text-emerald-400" />
                <MetricRow label="精确率 (Precision)" value={evalResult?.precision ?? 0} color="text-blue-400" />
                <MetricRow label="召回率 (Recall)" value={evalResult?.recall ?? 0} color="text-violet-400" />
                <MetricRow label="F1 分数" value={evalResult?.f1 ?? 0} color="text-amber-400" />
              </div>
            </div>

            {/* Confusion matrix */}
            {cm && (
              <div>
                <h4 className="text-xs text-gray-500 mb-2 uppercase tracking-wider">混淆矩阵</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 text-center">
                    <div className="text-[11px] text-gray-500">TP (真正例)</div>
                    <div className="text-lg font-bold text-emerald-400">{cm.TP}</div>
                  </div>
                  <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg p-3 text-center">
                    <div className="text-[11px] text-gray-500">FP (假正例)</div>
                    <div className="text-lg font-bold text-rose-400">{cm.FP}</div>
                  </div>
                  <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg p-3 text-center">
                    <div className="text-[11px] text-gray-500">FN (假反例)</div>
                    <div className="text-lg font-bold text-rose-400">{cm.FN}</div>
                  </div>
                  <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 text-center">
                    <div className="text-[11px] text-gray-500">TN (真反例)</div>
                    <div className="text-lg font-bold text-emerald-400">{cm.TN}</div>
                  </div>
                </div>
                <p className="text-[11px] text-gray-600 mt-2 text-right">验证集总样本: {cm.TP + cm.TN + cm.FP + cm.FN} 张（训练集 {trainCount} 张未在此评估）</p>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
};
