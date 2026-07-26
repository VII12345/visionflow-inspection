import React, { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { Button } from '../common/Modal';

interface StepTiming { avg_ms: number; min_ms: number; max_ms: number; total_ms: number; }
const STEP_LABELS: Record<string, string> = {
  file_enumeration_ms: '文件枚举',
  model_prepare_ms: '模型获取/加载',
  image_acquisition_ms: '获取图片',
  frame_copy_ms: '帧复制',
  preprocess_ms: '图像预处理',
  model_call_ms: '调用模型',
  recognition_ms: '识别/置信度计算',
  result_output_ms: '输出结果',
  image_save_ms: '保存图片',
  pipeline_ms: '单张完整流程',
};
const inputClass = 'w-full bg-white border border-gray-300 rounded-md px-3 py-2 text-[13px] text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-colors placeholder:text-text-tertiary';

type TestMode = 'labeled' | 'unlabeled';

interface TestResult {
  filename: string;
  expected?: string;
  predicted: string;
  confidence: number;
  correct?: boolean;
  time_ms?: number;
  timing?: Record<string, number>;
}

export const TestTab: React.FC = () => {
  const [models, setModels] = useState<{ name: string }[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [mode, setMode] = useState<TestMode>('labeled');

  // Labeled mode paths
  const [uprightPath, setUprightPath] = useState('');
  const [invertedPath, setInvertedPath] = useState('');

  // Unlabeled mode path
  const [folderPath, setFolderPath] = useState('');

  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{
    total: number;
    correct?: number;
    accuracy?: number;
    upright_total?: number;
    upright_correct?: number;
    upright_accuracy?: number | null;
    inverted_total?: number;
    inverted_correct?: number;
    inverted_accuracy?: number | null;
    timing?: {
      avg_ms: number;
      min_ms: number;
      max_ms: number;
      total_ms: number;
      pipeline_total_ms?: number;
      steps?: Record<string, StepTiming>;
      step_labels?: Record<string, string>;
    };
    results: TestResult[];
  } | null>(null);

  const [error, setError] = useState('');

  useEffect(() => {
    api.getModels().then(data => {
      if (data.success && data.models) setModels(data.models);
    }).catch(() => {});
  }, []);

  const browseFolder = async (setter: (v: string) => void) => {
    try {
      const path = await window.electronAPI?.selectFolder();
      if (path) setter(path);
    } catch { /* ignore */ }
  };

  const runTest = async () => {
    if (!selectedModel) { setError('请选择模型'); return; }
    setError('');
    setResult(null);
    setTesting(true);

    try {
      const params: { model_name: string; mode: 'labeled' | 'unlabeled'; upright_path?: string; inverted_path?: string; folder_path?: string } = {
        model_name: selectedModel,
        mode,
      };

      if (mode === 'labeled') {
        if (!uprightPath && !invertedPath) { setError('请至少指定正罐或倒罐目录'); setTesting(false); return; }
        params.upright_path = uprightPath;
        params.inverted_path = invertedPath;
      } else {
        if (!folderPath) { setError('请指定测试图片目录'); setTesting(false); return; }
        params.folder_path = folderPath;
      }

      const data = await api.testModel(params);
      if (data.success) {
        setResult(data as typeof result);
      } else {
        setError(data.message || '测试失败');
      }
    } catch (e) {
      setError('测试失败: ' + (e as Error).message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="h-full overflow-auto">
      {/* Config */}
      <div className="bg-white rounded-lg shadow-card border border-gray-100 p-6 mb-6">
        <h3 className="text-[15px] font-semibold text-text-primary mb-4">模型测试</h3>

        {/* Model + Mode */}
        <div className="flex items-end gap-4 mb-4">
          <div className="flex-1">
            <label className="text-xs text-text-secondary mb-1.5 block">选择模型</label>
            <select
              value={selectedModel}
              onChange={e => setSelectedModel(e.target.value)}
              className={`${inputClass} appearance-none`}
            >
              <option value="">-- 请选择 --</option>
              {models.map(m => (
                <option key={m.name} value={m.name}>{m.name}</option>
              ))}
            </select>
          </div>
          <div className="w-48">
            <label className="text-xs text-text-secondary mb-1.5 block">测试模式</label>
            <div className="flex rounded-md border border-gray-300 overflow-hidden">
              <button
                onClick={() => { setMode('labeled'); setResult(null); }}
                className={`flex-1 py-2 text-xs font-medium transition-colors ${mode === 'labeled' ? 'bg-accent text-white' : 'bg-white text-text-secondary hover:bg-gray-50'}`}
              >分类测试</button>
              <button
                onClick={() => { setMode('unlabeled'); setResult(null); }}
                className={`flex-1 py-2 text-xs font-medium transition-colors ${mode === 'unlabeled' ? 'bg-accent text-white' : 'bg-white text-text-secondary hover:bg-gray-50'}`}
              >批量推理</button>
            </div>
          </div>
        </div>

        {/* Paths */}
        {mode === 'labeled' ? (
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-xs text-text-secondary mb-1.5 block">正罐图片目录（可留空）</label>
              <div className="flex gap-2">
                <input type="text" placeholder="选择正罐图片文件夹" value={uprightPath} readOnly
                  className={`${inputClass} flex-1 bg-gray-50 cursor-pointer`}
                  onClick={() => browseFolder(setUprightPath)} />
                <Button variant="secondary" size="sm" onClick={() => browseFolder(setUprightPath)}>浏览</Button>
              </div>
            </div>
            <div>
              <label className="text-xs text-text-secondary mb-1.5 block">倒罐图片目录（可留空）</label>
              <div className="flex gap-2">
                <input type="text" placeholder="选择倒罐图片文件夹" value={invertedPath} readOnly
                  className={`${inputClass} flex-1 bg-gray-50 cursor-pointer`}
                  onClick={() => browseFolder(setInvertedPath)} />
                <Button variant="secondary" size="sm" onClick={() => browseFolder(setInvertedPath)}>浏览</Button>
              </div>
            </div>
            <p className="text-[11px] text-text-tertiary">正罐和倒罐目录可为空，系统自动识别。至少提供一个目录即可。</p>
          </div>
        ) : (
          <div>
            <label className="text-xs text-text-secondary mb-1.5 block">测试图片目录</label>
            <div className="flex gap-2">
              <input type="text" placeholder="选择包含图片的文件夹" value={folderPath} readOnly
                className={`${inputClass} flex-1 bg-gray-50 cursor-pointer`}
                onClick={() => browseFolder(setFolderPath)} />
              <Button variant="secondary" size="sm" onClick={() => browseFolder(setFolderPath)}>浏览</Button>
            </div>
            <p className="text-[11px] text-text-tertiary mt-1">不限正反，按文件名输出每张图片的推理结果。</p>
          </div>
        )}

        <div className="mt-4">
          <Button variant="primary" onClick={runTest} disabled={testing}>
            {testing ? '测试中...' : '开始测试'}
          </Button>
        </div>

        {error && <p className="text-ng text-xs mt-3">{error}</p>}
      </div>

      {/* Results */}
      {result && (
        <div className="bg-white rounded-lg shadow-card border border-gray-100 p-6">
          <h3 className="text-[15px] font-semibold text-text-primary mb-4">测试结果</h3>

          {/* Summary */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-gray-50 rounded-md p-3 text-center">
              <div className="text-[10px] text-text-tertiary uppercase tracking-wide">图片总数</div>
              <div className="text-lg font-bold text-text-primary mt-1">{result.total}</div>
            </div>
            {result.accuracy != null && (
              <div className="bg-gray-50 rounded-md p-3 text-center">
                <div className="text-[10px] text-text-tertiary uppercase tracking-wide">正确率</div>
                <div className={`text-lg font-bold mt-1 ${result.accuracy >= 0.95 ? 'text-ok' : result.accuracy >= 0.8 ? 'text-warn' : 'text-ng'}`}>
                  {(result.accuracy * 100).toFixed(1)}%
                </div>
              </div>
            )}
            {result.upright_accuracy != null && (
              <div className="bg-gray-50 rounded-md p-3 text-center">
                <div className="text-[10px] text-text-tertiary uppercase tracking-wide">正罐正确率</div>
                <div className={`text-lg font-bold mt-1 ${result.upright_accuracy >= 0.95 ? 'text-ok' : result.upright_accuracy >= 0.8 ? 'text-warn' : 'text-ng'}`}>
                  {(result.upright_accuracy * 100).toFixed(1)}%
                </div>
              </div>
            )}
            {result.inverted_accuracy != null && (
              <div className="bg-gray-50 rounded-md p-3 text-center">
                <div className="text-[10px] text-text-tertiary uppercase tracking-wide">倒罐正确率</div>
                <div className={`text-lg font-bold mt-1 ${result.inverted_accuracy >= 0.95 ? 'text-ok' : result.inverted_accuracy >= 0.8 ? 'text-warn' : 'text-ng'}`}>
                  {(result.inverted_accuracy * 100).toFixed(1)}%
                </div>
              </div>
            )}
          </div>

          {/* Timing */}
          {result.timing && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] text-text-tertiary uppercase tracking-wide">完整运行链路延迟</div>
                <div className="text-[11px] text-text-tertiary">获取图片 → 预处理 → 模型 → 识别 → 输出 → 保存图片</div>
              </div>
              <div className="grid grid-cols-4 gap-4 mb-4">
                <div className="bg-gray-50 rounded-md p-3 text-center">
                  <div className="text-[10px] text-text-tertiary">单张最短</div>
                  <div className="text-sm font-bold text-text-primary mt-0.5">{result.timing.min_ms.toFixed(1)} ms</div>
                </div>
                <div className="bg-gray-50 rounded-md p-3 text-center">
                  <div className="text-[10px] text-text-tertiary">单张最长</div>
                  <div className="text-sm font-bold text-text-primary mt-0.5">{result.timing.max_ms.toFixed(1)} ms</div>
                </div>
                <div className="bg-gray-50 rounded-md p-3 text-center">
                  <div className="text-[10px] text-text-tertiary">单张平均</div>
                  <div className="text-sm font-bold text-text-primary mt-0.5">{result.timing.avg_ms.toFixed(1)} ms</div>
                </div>
                <div className="bg-gray-50 rounded-md p-3 text-center">
                  <div className="text-[10px] text-text-tertiary">流水线总耗时</div>
                  <div className="text-sm font-bold text-text-primary mt-0.5">{((result.timing.pipeline_total_ms ?? result.timing.total_ms) / 1000).toFixed(2)} s</div>
                </div>
              </div>
              {result.timing.steps && (
                <div className="border border-gray-100 rounded-md overflow-hidden">
                  <div className="bg-gray-50 px-3 py-2 text-[10px] font-medium text-text-tertiary uppercase tracking-wide">逐项操作耗时（毫秒）</div>
                  <div className="divide-y divide-gray-100">
                    {Object.entries(result.timing.steps).map(([key, step]) => (
                      <div key={key} className="grid grid-cols-[minmax(160px,1.4fr)_repeat(4,minmax(70px,1fr))] items-center px-3 py-2 text-xs">
                        <span className="text-text-primary font-medium">{result.timing?.step_labels?.[key] || STEP_LABELS[key] || key}</span>
                        <span className="text-text-secondary text-right">平均 {step.avg_ms.toFixed(2)}</span>
                        <span className="text-text-secondary text-right">最短 {step.min_ms.toFixed(2)}</span>
                        <span className="text-text-secondary text-right">最长 {step.max_ms.toFixed(2)}</span>
                        <span className="text-text-primary font-medium text-right">合计 {step.total_ms.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Per-image results */}/
          <div>
            <div className="text-[10px] text-text-tertiary uppercase tracking-wide mb-2">
              图片详情 ({result.results.length} 张)
            </div>
            <div className="border border-gray-100 rounded-md max-h-[400px] overflow-y-auto">
              <table className="w-full text-[12px] border-collapse">
                <thead className="bg-gray-50 sticky top-0 z-10">
                  <tr>
                    <th className="px-3 py-2 text-left text-[10px] font-medium text-text-tertiary uppercase">文件名</th>
                    {result.results[0]?.expected != null && (
                      <th className="px-3 py-2 text-left text-[10px] font-medium text-text-tertiary uppercase w-16">期望</th>
                    )}
                    <th className="px-3 py-2 text-left text-[10px] font-medium text-text-tertiary uppercase w-16">结果</th>
                    <th className="px-3 py-2 text-left text-[10px] font-medium text-text-tertiary uppercase w-20">置信度</th>
                    {result.results[0]?.time_ms != null && (
                      <th className="px-3 py-2 text-left text-[10px] font-medium text-text-tertiary uppercase w-20">完整耗时</th>
                    )}
                    {result.results[0]?.timing && (
                      <th className="px-3 py-2 text-left text-[10px] font-medium text-text-tertiary uppercase w-20">步骤</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {result.results.map((r, i) => (
                    <tr key={i} className={`border-t border-gray-100 ${r.correct === false ? 'bg-red-50/50' : ''}`}>
                      <td className="px-3 py-2 text-text-primary font-mono text-[11px] truncate max-w-[200px]">{r.filename}</td>
                      {r.expected != null && (
                        <td className="px-3 py-2">
                          <span className={`text-[11px] font-medium ${r.expected === '正' ? 'text-ok' : 'text-ng'}`}>{r.expected}</span>
                        </td>
                      )}
                      <td className="px-3 py-2">
                        <span className={`text-[11px] font-medium ${r.predicted === '正' ? 'text-ok' : 'text-ng'}`}>{r.predicted}</span>
                      </td>
                      <td className="px-3 py-2 text-text-secondary">{(r.confidence * 100).toFixed(1)}%</td>
                      {r.time_ms != null && (
                        <td className="px-3 py-2 text-text-tertiary">{r.time_ms.toFixed(1)} ms</td>
                      )}
                      {r.timing && (
                        <td className="px-3 py-2 text-text-tertiary relative">
                          <details>
                            <summary className="cursor-pointer text-accent">查看</summary>
                            <div className="absolute right-0 z-20 mt-1 bg-white border border-gray-200 rounded-md shadow-lg p-2 min-w-[220px]">
                              {Object.entries(r.timing).map(([key, value]) => (
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
      )}
    </div>
  );
};

