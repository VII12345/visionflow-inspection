import React from 'react';
import { HIDDEN_TIMING_KEYS, STEP_LABELS, TIMING_SUMMARY_EXPLANATIONS, TimingBreakdown } from './TimingBreakdown';
import type { ModelTestResult } from './useModelTest';

export const TestResultPanel: React.FC<{ result: ModelTestResult }> = ({ result }) => {
  return (
    <div className="bg-white rounded-lg shadow-card border border-gray-100 p-6">
      <h3 className="text-[15px] font-semibold text-text-primary mb-4">测试结果</h3>

      {/* Summary */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 xl:gap-4 mb-6">
        <div className="bg-gray-50 rounded-md p-3 text-center">
          <div className="text-[10px] text-text-tertiary uppercase tracking-wide">图片总数</div>
          <div className="text-lg font-bold text-text-primary mt-1">{result.total}</div>
        </div>
        {result.accuracy != null && (
          <div className="bg-gray-50 rounded-md p-3 text-center">
            <div className="text-[10px] text-text-tertiary uppercase tracking-wide">正确率</div>
            <div className={'text-lg font-bold mt-1 ' + (result.accuracy >= 0.95 ? 'text-ok' : result.accuracy >= 0.8 ? 'text-warn' : 'text-ng')}>
              {(result.accuracy * 100).toFixed(1)}%
            </div>
          </div>
        )}
        {result.category_counts && Object.entries(result.category_counts).map(([category, stats]) => (
          <div key={category} className="bg-gray-50 rounded-md p-3 text-center">
            <div className="text-[10px] text-text-tertiary uppercase tracking-wide truncate" title={category}>{category}</div>
            <div className={'text-lg font-bold mt-1 ' + (stats.accuracy == null ? 'text-text-primary' : stats.accuracy >= 0.95 ? 'text-ok' : stats.accuracy >= 0.8 ? 'text-warn' : 'text-ng')}>
              {stats.accuracy == null ? '--' : (stats.accuracy * 100).toFixed(1) + '%'}
            </div>
            <div className="text-[10px] text-text-tertiary">{stats.correct}/{stats.total}</div>
          </div>
        ))}
      </div>

      {/* Timing */}
      {result.timing && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] text-text-tertiary uppercase tracking-wide">完整运行链路延迟</div>
            <div className="text-[11px] text-text-tertiary">推理链路 → 结果输出 → 保存图片</div>
          </div>
          <div className="text-[11px] text-text-tertiary mb-2">父级合计均为可展开子项相加；推理交接和写盘前等待已拆出，避免外层等待与内部步骤重复计算。</div>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 xl:gap-4 mb-4">
            <div className="bg-gray-50 rounded-md p-3 text-center" title={TIMING_SUMMARY_EXPLANATIONS.min}>
              <div className="text-[10px] text-text-tertiary">单张最短</div>
              <div className="text-sm font-bold text-text-primary mt-0.5">{result.timing.min_ms.toFixed(1)} ms</div>
            </div>
            <div className="bg-gray-50 rounded-md p-3 text-center" title={TIMING_SUMMARY_EXPLANATIONS.max}>
              <div className="text-[10px] text-text-tertiary">单张最长</div>
              <div className="text-sm font-bold text-text-primary mt-0.5">{result.timing.max_ms.toFixed(1)} ms</div>
            </div>
            <div className="bg-gray-50 rounded-md p-3 text-center" title={TIMING_SUMMARY_EXPLANATIONS.avg}>
              <div className="text-[10px] text-text-tertiary">单张平均</div>
              <div className="text-sm font-bold text-text-primary mt-0.5">{result.timing.avg_ms.toFixed(1)} ms</div>
            </div>
            <div className="bg-gray-50 rounded-md p-3 text-center" title={TIMING_SUMMARY_EXPLANATIONS.pipeline}>
              <div className="text-[10px] text-text-tertiary">流水线总耗时</div>
              <div className="text-sm font-bold text-text-primary mt-0.5">{((result.timing.pipeline_total_ms ?? result.timing.total_ms) / 1000).toFixed(2)} s</div>
            </div>
          </div>
          {result.timing.steps && (
            <TimingBreakdown
              steps={result.timing.steps}
              stepLabels={result.timing.step_labels}
              overallAvgMs={result.timing.avg_ms}
            />
          )}
        </div>
      )}

      {/* Per-image results */}
      <div>
        <div className="text-[10px] text-text-tertiary uppercase tracking-wide mb-2">
          图片详情 ({result.results.length} 张)
        </div>
        <div className="border border-gray-100 rounded-md max-h-[400px] overflow-auto">
          <table className="w-full text-[12px] border-collapse min-w-[640px]">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 text-left text-[10px] font-medium text-text-tertiary uppercase">文件名</th>
                {result.results[0]?.expected != null && (
                  <th className="px-3 py-2 text-left text-[10px] font-medium text-text-tertiary uppercase w-16">期望</th>
                )}
                <th className="px-3 py-2 text-left text-[10px] font-medium text-text-tertiary uppercase w-16">结果</th>
                <th className="px-3 py-2 text-left text-[10px] font-medium text-text-tertiary uppercase w-20">置信度</th>
                {result.results[0]?.time_ms != null && (
                  <th className="px-3 py-2 text-left text-[10px] font-medium text-text-tertiary uppercase w-20">单张处理耗时</th>
                )}
                {result.results[0]?.timing && (
                  <th className="px-3 py-2 text-left text-[10px] font-medium text-text-tertiary uppercase w-20">步骤</th>
                )}
              </tr>
            </thead>
            <tbody>
              {result.results.map((item) => (
                <tr key={item.filename} className={'border-t border-gray-100 ' + (item.correct === false ? 'bg-red-50/50' : '')}>
                  <td className="px-3 py-2 text-text-primary font-mono text-[11px] truncate max-w-[200px]">{item.filename}</td>
                  {item.expected != null && (
                    <td className="px-3 py-2">
                      <span className="text-[11px] font-medium text-text-secondary">{item.expected}</span>
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <span className="text-[11px] font-medium text-text-secondary">{item.predicted}</span>
                  </td>
                  <td className="px-3 py-2 text-text-secondary">{(item.confidence * 100).toFixed(1)}%</td>
                  {item.time_ms != null && (
                    <td className="px-3 py-2 text-text-tertiary cursor-help" title="这张图片从读入内存后开始，到完整结果处理结束的单张处理耗时；不包含读取图片本身。">{item.time_ms.toFixed(1)} ms</td>
                  )}
                  {item.timing && (
                    <td className="px-3 py-2 text-text-tertiary relative">
                      <details>
                        <summary className="cursor-pointer text-accent" title="展开后可查看这张图片各个处理步骤的单次耗时。">查看</summary>
                        <div className="absolute right-0 z-20 mt-1 bg-white border border-gray-200 rounded-md shadow-lg p-2 min-w-[220px]">
                          {Object.entries(item.timing).filter(([key]) => !HIDDEN_TIMING_KEYS.has(key)).map(([key, value]) => (
                            <div key={key} className="flex justify-between gap-4 py-0.5 text-[10px]">
                              <span>{STEP_LABELS[key] || key}</span>
                              <span className="font-medium">{value.toFixed(2)} ms</span>
                            </div>
                          ))}
                        </div>
                      </details>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
