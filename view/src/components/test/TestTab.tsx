import React, { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { storage } from '../../services/storage';
import { isTauri, selectLocalFolder } from '../../services/native';
import { Button } from '../common/Modal';
import { FieldHint } from '../common/FieldHint';
import { useAppStore } from '../../store/useAppStore';
import { BackendDirectoryPicker, type BackendImageDirectory } from '../common/BackendDirectoryPicker';
import { HIDDEN_TIMING_KEYS, STEP_LABELS, TIMING_SUMMARY_EXPLANATIONS, TimingBreakdown, type StepTiming } from './TimingBreakdown';

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

  // Labeled mode: one root folder with any number of category subfolders
  const [categoryRootPath, setCategoryRootPath] = useState('');

  // Unlabeled mode path
  const [folderPath, setFolderPath] = useState('');
  const [pickerTarget, setPickerTarget] = useState<'categoryRoot' | 'folder' | null>(null);

  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{
    total: number;
    correct?: number;
    accuracy?: number;
    categories?: string[];
    category_counts?: Record<string, { total: number; correct: number; accuracy: number | null }>;
    class_a_total?: number;
    class_a_correct?: number;
    class_a_accuracy?: number | null;
    class_b_total?: number;
    class_b_correct?: number;
    class_b_accuracy?: number | null;
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
  const showMessage = useAppStore(s => s.showMessage);
  const catalogRevision = useAppStore(s => s.catalogRevision);

  useEffect(() => {
    api.getModels().then(data => {
      if (data.success && data.models) setModels(data.models);
    }).catch(() => {});
  }, [catalogRevision]);

  const browseLocalFolder = async (setter: (value: string) => void) => {
    if (!isTauri()) {
      showMessage('网页版暂不支持选择当前电脑的本地文件夹，请使用“选择后端目录”');
      return;
    }
    try {
      const path = await selectLocalFolder();
      if (path) setter(path);
    } catch (reason) {
      showMessage(`选择本地目录失败: ${(reason as Error).message}`);
    }
  };

  const applyDirectory = (directory: BackendImageDirectory) => {
    if (pickerTarget === 'categoryRoot') setCategoryRootPath(directory.path);
    if (pickerTarget === 'folder') setFolderPath(directory.path);
    setPickerTarget(null);
  };

  const runTest = async () => {
    if (!selectedModel) { setError('请选择模型'); return; }
    setError('');
    setResult(null);
    setTesting(true);

    try {
      const params: { model_name: string; mode: 'labeled' | 'unlabeled'; category_root_path?: string; folder_path?: string } = {
        model_name: selectedModel,
        mode,
      };

      if (mode === 'labeled') {
        if (!categoryRootPath) { setError('请指定类别根目录'); setTesting(false); return; }
        params.category_root_path = categoryRootPath;
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
            <label className="text-xs text-text-secondary mb-1.5 block"><FieldHint text="选择要验证的已训练模型；测试结果会使用该模型保存的类别名称。">选择模型</FieldHint></label>
            <select
              value={selectedModel}
              onChange={e => setSelectedModel(e.target.value)}
              className={`${inputClass} appearance-none`}
            >
              <option value="">-- 请选择 --</option>
              {models.map(m => (
                <option key={m.name} value={m.name}>{storage.getProducts().find(p => p.model === m.name)?.name || m.name}</option>
              ))}
            </select>
          </div>
          <div className="w-48">
            <label className="text-xs text-text-secondary mb-1.5 block"><FieldHint text="分类测试需要类别根目录并能计算准确率；批量推理只需要图片目录，不要求标签。">测试模式</FieldHint></label>
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

        <div className={`rounded-md border px-4 py-3 mb-4 ${mode === 'labeled' ? 'bg-blue-50/60 border-blue-100' : 'bg-emerald-50/60 border-emerald-100'}`}>
          {mode === 'labeled' ? (
            <>
              <div className="text-xs font-semibold text-accent mb-1">分类测试：模型性能测试</div>
              <p className="text-[11px] text-text-secondary leading-5">用于验证模型准确率、各类别分类正确率和置信度表现。该模式重点关注识别结果是否正确，不代表真实产线的异步时序压力。</p>
            </>
          ) : (
            <>
              <div className="text-xs font-semibold text-ok mb-1">批量推理：真实环境离线测试</div>
              <p className="text-[11px] text-text-secondary leading-5">逐张复现产线流程：提交真实推理队列 → Worker 异步推理 → 输出结果 → 提交异步保存队列 → 等待实际写盘完成，并统计处理阶段延迟；读取图片本身不计入耗时。</p>
            </>
          )}
        </div>

        {/* Paths */}
        {mode === 'labeled' ? (
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-xs text-text-secondary mb-1.5 block"><FieldHint text="选择包含多个类别子目录的根目录，每个子目录名称就是一个类别。">类别根目录</FieldHint></label>
              <div className="flex gap-2">
                <input type="text" placeholder="选择包含多个类别子目录的文件夹" value={categoryRootPath} readOnly
                  className={`${inputClass} flex-1 bg-gray-50 cursor-pointer`}
                  onClick={() => browseLocalFolder(setCategoryRootPath)} />
                <Button variant="secondary" size="sm" onClick={() => browseLocalFolder(setCategoryRootPath)}>选择本地目录</Button>
                <Button variant="secondary" size="sm" onClick={() => setPickerTarget('categoryRoot')}>选择后端目录</Button>
              </div>
            </div>
            <p className="text-[11px] text-text-tertiary">根目录下每个子文件夹代表一个类别，类别数量不限。网页版不能直接选择浏览器所在电脑的本地文件夹，测试图片需要位于后端电脑。</p>
          </div>
        ) : (
          <div>
            <label className="text-xs text-text-secondary mb-1.5 block"><FieldHint text="选择待测试图片所在文件夹；批量推理会读取其中支持的图片文件。">测试图片目录</FieldHint></label>
            <div className="flex gap-2">
              <input type="text" placeholder="选择包含图片的文件夹" value={folderPath} readOnly
                className={`${inputClass} flex-1 bg-gray-50 cursor-pointer`}
                onClick={() => browseLocalFolder(setFolderPath)} />
              <Button variant="secondary" size="sm" onClick={() => browseLocalFolder(setFolderPath)}>选择本地目录</Button>
              <Button variant="secondary" size="sm" onClick={() => setPickerTarget('folder')}>选择后端目录</Button>
            </div>
            <p className="text-[11px] text-text-tertiary mt-1">不限类别，按真实异步检测链路执行，并按文件名输出每张图片的结果和逐步延迟。网页版不能直接选择浏览器所在电脑的本地文件夹，测试图片需要位于后端电脑。</p>
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
            {result.category_counts && Object.entries(result.category_counts).map(([category, stats]) => (
              <div key={category} className="bg-gray-50 rounded-md p-3 text-center">
                <div className="text-[10px] text-text-tertiary uppercase tracking-wide truncate" title={category}>{category}</div>
                <div className={`text-lg font-bold mt-1 ${stats.accuracy == null ? 'text-text-primary' : stats.accuracy >= 0.95 ? 'text-ok' : stats.accuracy >= 0.8 ? 'text-warn' : 'text-ng'}`}>
                  {stats.accuracy == null ? '--' : `${(stats.accuracy * 100).toFixed(1)}%`}
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
              <div className="grid grid-cols-4 gap-4 mb-4">
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
                      <th className="px-3 py-2 text-left text-[10px] font-medium text-text-tertiary uppercase w-20">单张处理耗时</th>
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
                          <span className={`text-[11px] font-medium ${'text-text-secondary'}`}>{r.expected}</span>
                        </td>
                      )}
                      <td className="px-3 py-2">
                        <span className={`text-[11px] font-medium ${'text-text-secondary'}`}>{r.predicted}</span>
                      </td>
                      <td className="px-3 py-2 text-text-secondary">{(r.confidence * 100).toFixed(1)}%</td>
                      {r.time_ms != null && (
                        <td className="px-3 py-2 text-text-tertiary cursor-help" title="这张图片从读入内存后开始，到完整结果处理结束的单张处理耗时；不包含读取图片本身。">{r.time_ms.toFixed(1)} ms</td>
                      )}
                      {r.timing && (
                        <td className="px-3 py-2 text-text-tertiary relative">
                          <details>
                            <summary className="cursor-pointer text-accent" title="展开后可查看这张图片各个处理步骤的单次耗时。">查看</summary>
                            <div className="absolute right-0 z-20 mt-1 bg-white border border-gray-200 rounded-md shadow-lg p-2 min-w-[220px]">
                              {Object.entries(r.timing).filter(([key]) => !HIDDEN_TIMING_KEYS.has(key)).map(([key, value]) => (
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
      <BackendDirectoryPicker
        open={pickerTarget !== null}
        title={pickerTarget === 'categoryRoot' ? '选择后端类别根目录' : '选择后端测试图片目录'}
        onClose={() => setPickerTarget(null)}
        onSelect={applyDirectory}
      />
    </div>
  );
};

