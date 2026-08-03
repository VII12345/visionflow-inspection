import React from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';

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
  label, value, suffix = '%', color = 'text-text-primary',
}) => (
  <div className="flex justify-between items-center py-2.5 border-b border-gray-100">
    <span className="text-text-secondary text-[13px]">{label}</span>
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
      title={isError ? '训练失败' : '训练完成'}
      width="520px"
      footer={<Button variant="primary" onClick={onClose}>确定</Button>}
    >
      <div className="flex flex-col gap-4">
        {/* Header info */}
        <div className="bg-gray-50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-text-tertiary">产品型号</span>
            <span className="text-sm font-semibold text-text-primary">{modelName || '--'}</span>
          </div>
          {(trainCount > 0 || valCount > 0) && (
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-text-tertiary">数据分布</span>
              <span className="text-xs text-text-secondary">训练集 {trainCount} 张 · 验证集 {valCount} 张（用于评估）</span>
            </div>
          )}
          {modelPath && (
            <div className="flex items-start gap-2">
              <span className="text-xs text-text-tertiary shrink-0">保存位置</span>
              <span className="text-xs text-text-secondary break-all font-mono">{modelPath}</span>
            </div>
          )}
        </div>

        {isError ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-ng text-[13px]">{errorMessage}</p>
          </div>
        ) : (
          <>
            {/* Evaluation metrics */}
            <div>
              <h4 className="text-xs text-text-tertiary mb-2 uppercase tracking-wide">评估指标</h4>
              <div className="bg-gray-50 rounded-lg px-4">
                <MetricRow label="准确率 (Accuracy)" value={evalResult?.accuracy ?? 0} color="text-ok" />
                <MetricRow label="精确率 (Precision)" value={evalResult?.precision ?? 0} color="text-accent" />
                <MetricRow label="召回率 (Recall)" value={evalResult?.recall ?? 0} color="text-accent" />
                <MetricRow label="F1 分数" value={evalResult?.f1 ?? 0} color="text-accent" />
              </div>
            </div>

            {/* Confusion matrix */}
            {cm && (
              <div>
                <h4 className="text-xs text-text-tertiary mb-2 uppercase tracking-wide">混淆矩阵</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-center">
                    <div className="text-[11px] text-text-tertiary">TP (真正例)</div>
                    <div className="text-lg font-bold text-ok">{cm.TP}</div>
                  </div>
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
                    <div className="text-[11px] text-text-tertiary">FP (假正例)</div>
                    <div className="text-lg font-bold text-ng">{cm.FP}</div>
                  </div>
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
                    <div className="text-[11px] text-text-tertiary">FN (假反例)</div>
                    <div className="text-lg font-bold text-ng">{cm.FN}</div>
                  </div>
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-center">
                    <div className="text-[11px] text-text-tertiary">TN (真反例)</div>
                    <div className="text-lg font-bold text-ok">{cm.TN}</div>
                  </div>
                </div>
                <p className="text-[11px] text-text-tertiary mt-2 text-right">验证集总样本: {cm.TP + cm.TN + cm.FP + cm.FN} 张（训练集 {trainCount} 张未在此评估）</p>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
};
