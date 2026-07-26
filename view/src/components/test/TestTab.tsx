import React, { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { Button } from '../common/Modal';
import { useAppStore } from '../../store/useAppStore';
import { BackendDirectoryPicker, type BackendImageDirectory } from '../common/BackendDirectoryPicker';

interface StepTiming { avg_ms: number; min_ms: number; max_ms: number; total_ms: number; }
const STEP_LABELS: Record<string, string> = {
  file_enumeration_ms: '文件枚举',
  model_route_prepare_ms: '模型路由/准备',
  inference_submit_ms: '提交推理队列',
  inference_queue_wait_ms: '推理队列等待',
  inference_batch_window_ms: '推理批窗口',
  model_prepare_ms: 'Worker 获取模型',
  preprocess_ms: '图像预处理',
  model_call_ms: '调用模型',
  recognition_ms: '识别/置信度计算',
  inference_result_wait_ms: '等待推理结果',
  result_output_ms: '输出结果',
  frame_copy_ms: '帧复制',
  save_submit_ms: '提交保存队列',
  save_queue_wait_ms: '保存队列等待',
  image_save_ms: '实际写盘',
  detection_pipeline_ms: '检测主流程',
  pipeline_ms: '单张完整流程',
};

// 按完整检测链路分组：大项是可折叠的流程阶段，小项是该阶段内的实际计时。
interface TimingGroup {
  key: string;
  label: string;
  description: string;
  steps: string[];
}

const TIMING_GROUPS: TimingGroup[] = [
  {
    key: 'prepare',
    label: '任务准备',
    description: '准备模型路由并扫描测试文件',
    steps: ['model_route_prepare_ms', 'file_enumeration_ms'],
  },
  {
    key: 'inference',
    label: '推理链路',
    description: '提交任务、排队并完成模型推理',
    steps: [
      'inference_submit_ms',
      'inference_result_wait_ms',
      'inference_queue_wait_ms',
      'inference_batch_window_ms',
      'model_prepare_ms',
      'preprocess_ms',
      'model_call_ms',
      'recognition_ms',
    ],
  },
  {
    key: 'output',
    label: '结果输出',
    description: '整理识别结果并完成检测流程统计',
    steps: ['result_output_ms', 'detection_pipeline_ms'],
  },
  {
    key: 'save',
    label: '图片保存',
    description: '将结果图片交给异步保存线程并写入磁盘',
    steps: ['frame_copy_ms', 'save_submit_ms', 'save_queue_wait_ms', 'image_save_ms'],
  },
  {
    key: 'overall',
    label: '整体耗时',
    description: '单张图片从流程开始到全部处理完成',
    steps: ['pipeline_ms'],
  },
];

const STEP_EXPLANATIONS: Record<string, string> = {
  file_enumeration_ms: '扫描所选目录并枚举支持的图片文件，统计本次测试需要处理的文件数量。只包含文件查找和列表生成，不包含图片解码。',
  model_route_prepare_ms: '根据当前选择的模型建立测试任务的模型路由，并准备对应的模型缓存。模型首次加载或切换时可能明显增加。',
  inference_submit_ms: '把已经读取的图片放入真实推理队列，并记录提交动作本身耗时；不包括排队等待和模型计算。',
  inference_queue_wait_ms: '图片进入推理队列后，等待推理 Worker 取走处理的时间。队列拥堵或前面任务较多时会升高。',
  inference_batch_window_ms: 'Worker 为了形成微批次而等待更多图片的时间。单张测试时通常接近微批窗口上限。',
  model_prepare_ms: 'Worker 获取并确认本次任务使用的模型，必要时完成模型加载或设备准备。已缓存模型通常较快。',
  preprocess_ms: '将原图裁剪、缩放到模型输入尺寸，并进行归一化和训练/测试需要的图像预处理。',
  model_call_ms: '调用 PyTorch 模型执行前向推理，得到正反分类的原始输出。GPU/CPU 性能会直接影响此项。',
  recognition_ms: '将模型输出转换为类别、置信度和最终标签，完成识别结果计算。',
  inference_result_wait_ms: '测试接口提交推理后，等待结果队列返回这一张图片结果的时间，包含队列和 Worker 处理完成的等待。',
  result_output_ms: '把推理结果整理为接口返回格式，并完成测试统计数据更新。',
  frame_copy_ms: '为异步保存创建一份独立的图像副本，避免保存线程和推理线程同时操作同一对象。',
  save_submit_ms: '把待保存图片和目标路径提交到异步保存队列，提交后实际写盘由后台保存线程执行。',
  save_queue_wait_ms: '图片进入保存队列后，等待保存 Worker 取走的时间。磁盘写入繁忙或前面保存任务较多时会升高。',
  image_save_ms: '保存 Worker 将图片编码为 BMP 并实际写入后端磁盘的耗时。磁盘速度、目录位置和文件大小都会影响此项。',
  detection_pipeline_ms: '从检测流程开始到输出检测结果的主流程耗时，便于观察推理链路整体开销。',
  pipeline_ms: '单张图片的完整端到端耗时，覆盖获取图片、推理、结果输出以及异步保存相关步骤。',
};

const TIMING_SUMMARY_EXPLANATIONS: Record<string, string> = {
  min: '所有图片中，单张完整检测耗时的最小值。反映较理想情况下的一次处理速度。',
  max: '所有图片中，单张完整检测耗时的最大值。可用于发现偶发的磁盘、队列或模型计算抖动。',
  avg: '所有图片单张完整检测耗时的平均值。通常比单次结果更适合评估整体性能。',
  pipeline: '本次测试从第一张开始到最后一张完成的流水线总耗时，包含批量图片处理和异步保存。',
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

interface TimingBreakdownProps {
  steps: Record<string, StepTiming>;
  stepLabels?: Record<string, string>;
}

const TimingBreakdown: React.FC<TimingBreakdownProps> = ({ steps, stepLabels }) => {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const knownKeys = new Set<string>(TIMING_GROUPS.flatMap(group => group.steps));
  const extraSteps = Object.entries(steps).filter(([key]) => key !== 'image_acquisition_ms' && !knownKeys.has(key));

  const renderStep = (key: string, step: StepTiming) => (
    <div key={key} className="grid grid-cols-[minmax(160px,1.4fr)_repeat(4,minmax(70px,1fr))] items-center pl-10 pr-3 py-2 text-xs border-l-2 border-accent/15 ml-4 hover:bg-blue-50/30">
      <span
        className="text-text-primary font-medium cursor-help border-b border-dotted border-text-tertiary/60 w-fit"
        title={`${stepLabels?.[key] || STEP_LABELS[key] || key}

${STEP_EXPLANATIONS[key] || '该项表示测试链路中的一个独立计时步骤。悬停可查看后端实际记录的处理范围。'}`}
      >
        {stepLabels?.[key] || STEP_LABELS[key] || key}
      </span>
      <span className="text-text-secondary text-right">平均 {step.avg_ms.toFixed(2)}</span>
      <span className="text-text-secondary text-right">最短 {step.min_ms.toFixed(2)}</span>
      <span className="text-text-secondary text-right">最长 {step.max_ms.toFixed(2)}</span>
      <span className="text-text-primary font-medium text-right">合计 {step.total_ms.toFixed(2)}</span>
    </div>
  );

  const toggle = (key: string) => setCollapsed(current => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  return (
    <div className="border border-gray-100 rounded-md overflow-hidden">
      <div className="bg-gray-50 px-3 py-2 text-[10px] font-medium text-text-tertiary uppercase tracking-wide">逐项操作耗时（毫秒）</div>
      <div className="divide-y divide-gray-100">
        {TIMING_GROUPS.map(group => {
          const entries = group.steps
            .map(key => [key, steps[key]] as const)
            .filter((entry): entry is [string, StepTiming] => Boolean(entry[1]));
          if (entries.length === 0) return null;
          const isCollapsed = collapsed.has(group.key);
          return (
            <section key={group.key}>
              <button
                type="button"
                onClick={() => toggle(group.key)}
                aria-expanded={!isCollapsed}
                className="w-full flex items-center gap-2 px-3 py-2.5 bg-white hover:bg-blue-50/50 text-left"
              >
                <span className="w-4 text-center text-accent font-bold">{isCollapsed ? '›' : '⌄'}</span>
                <span className="text-[13px] font-semibold text-text-primary">{group.label}</span>
                <span className="text-[11px] text-text-tertiary flex-1">{group.description}</span>
                <span className="text-[10px] text-text-tertiary">{entries.length} 项</span>
              </button>
              {!isCollapsed && <div className="bg-gray-50/40">{entries.map(([key, step]) => renderStep(key, step))}</div>}
            </section>
          );
        })}
        {extraSteps.length > 0 && (
          <section>
            <button
              type="button"
              onClick={() => toggle('extra')}
              aria-expanded={!collapsed.has('extra')}
              className="w-full flex items-center gap-2 px-3 py-2.5 bg-white hover:bg-blue-50/50 text-left"
            >
              <span className="w-4 text-center text-accent font-bold">{collapsed.has('extra') ? '›' : '⌄'}</span>
              <span className="text-[13px] font-semibold text-text-primary">其他步骤</span>
              <span className="text-[11px] text-text-tertiary flex-1">后端新增的计时项</span>
              <span className="text-[10px] text-text-tertiary">{extraSteps.length} 项</span>
            </button>
            {!collapsed.has('extra') && <div className="bg-gray-50/40">{extraSteps.map(([key, step]) => renderStep(key, step))}</div>}
          </section>
        )}
      </div>
    </div>
  );
};

export const TestTab: React.FC = () => {
  const [models, setModels] = useState<{ name: string }[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [mode, setMode] = useState<TestMode>('labeled');

  // Labeled mode paths
  const [uprightPath, setUprightPath] = useState('');
  const [invertedPath, setInvertedPath] = useState('');

  // Unlabeled mode path
  const [folderPath, setFolderPath] = useState('');
  const [pickerTarget, setPickerTarget] = useState<'upright' | 'inverted' | 'folder' | null>(null);

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
  const showMessage = useAppStore(s => s.showMessage);

  useEffect(() => {
    api.getModels().then(data => {
      if (data.success && data.models) setModels(data.models);
    }).catch(() => {});
  }, []);

  const browseLocalFolder = async (setter: (value: string) => void) => {
    if (!window.electronAPI?.selectFolder) {
      showMessage('网页版暂不支持选择当前电脑的本地文件夹，请使用“选择后端目录”');
      return;
    }
    try {
      const path = await window.electronAPI.selectFolder();
      if (path) setter(path);
    } catch (reason) {
      showMessage(`选择本地目录失败: ${(reason as Error).message}`);
    }
  };

  const applyDirectory = (directory: BackendImageDirectory) => {
    if (pickerTarget === 'upright') setUprightPath(directory.path);
    if (pickerTarget === 'inverted') setInvertedPath(directory.path);
    if (pickerTarget === 'folder') setFolderPath(directory.path);
    setPickerTarget(null);
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

        <div className={`rounded-md border px-4 py-3 mb-4 ${mode === 'labeled' ? 'bg-blue-50/60 border-blue-100' : 'bg-emerald-50/60 border-emerald-100'}`}>
          {mode === 'labeled' ? (
            <>
              <div className="text-xs font-semibold text-accent mb-1">分类测试：模型性能测试</div>
              <p className="text-[11px] text-text-secondary leading-5">用于验证模型准确率、正罐/倒罐分类正确率和置信度表现。该模式重点关注识别结果是否正确，不代表真实产线的异步时序压力。</p>
            </>
          ) : (
            <>
              <div className="text-xs font-semibold text-ok mb-1">批量推理：真实环境模拟测试</div>
              <p className="text-[11px] text-text-secondary leading-5">逐张模拟产线流程：获取图片 → 提交真实推理队列 → Worker 异步推理 → 输出结果 → 提交异步保存队列 → 等待实际写盘完成，并统计每一步延迟。</p>
            </>
          )}
        </div>

        {/* Paths */}
        {mode === 'labeled' ? (
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-xs text-text-secondary mb-1.5 block">正罐图片目录（可留空）</label>
              <div className="flex gap-2">
                <input type="text" placeholder="选择正罐图片文件夹" value={uprightPath} readOnly
                  className={`${inputClass} flex-1 bg-gray-50 cursor-pointer`}
                  onClick={() => browseLocalFolder(setUprightPath)} />
                <Button variant="secondary" size="sm" onClick={() => browseLocalFolder(setUprightPath)}>选择本地目录</Button>
                <Button variant="secondary" size="sm" onClick={() => setPickerTarget('upright')}>选择后端目录</Button>
              </div>
            </div>
            <div>
              <label className="text-xs text-text-secondary mb-1.5 block">倒罐图片目录（可留空）</label>
              <div className="flex gap-2">
                <input type="text" placeholder="选择倒罐图片文件夹" value={invertedPath} readOnly
                  className={`${inputClass} flex-1 bg-gray-50 cursor-pointer`}
                  onClick={() => browseLocalFolder(setInvertedPath)} />
                <Button variant="secondary" size="sm" onClick={() => browseLocalFolder(setInvertedPath)}>选择本地目录</Button>
                <Button variant="secondary" size="sm" onClick={() => setPickerTarget('inverted')}>选择后端目录</Button>
              </div>
            </div>
            <p className="text-[11px] text-text-tertiary">正罐和倒罐目录可为空，系统自动识别。至少提供一个目录即可。网页版不能直接选择浏览器所在电脑的本地文件夹，测试图片需要位于后端电脑。</p>
          </div>
        ) : (
          <div>
            <label className="text-xs text-text-secondary mb-1.5 block">测试图片目录</label>
            <div className="flex gap-2">
              <input type="text" placeholder="选择包含图片的文件夹" value={folderPath} readOnly
                className={`${inputClass} flex-1 bg-gray-50 cursor-pointer`}
                onClick={() => browseLocalFolder(setFolderPath)} />
              <Button variant="secondary" size="sm" onClick={() => browseLocalFolder(setFolderPath)}>选择本地目录</Button>
              <Button variant="secondary" size="sm" onClick={() => setPickerTarget('folder')}>选择后端目录</Button>
            </div>
            <p className="text-[11px] text-text-tertiary mt-1">不限正反，按真实异步检测链路执行，并按文件名输出每张图片的结果和逐步延迟。网页版不能直接选择浏览器所在电脑的本地文件夹，测试图片需要位于后端电脑。</p>
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
                <div className="text-[11px] text-text-tertiary">任务准备 → 推理链路 → 结果输出 → 保存图片</div>
              </div>
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
                <TimingBreakdown steps={result.timing.steps} stepLabels={result.timing.step_labels} />
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
                        <td className="px-3 py-2 text-text-tertiary cursor-help" title="这张图片从测试流程开始到完整结果处理结束的单张总耗时。">{r.time_ms.toFixed(1)} ms</td>
                      )}
                      {r.timing && (
                        <td className="px-3 py-2 text-text-tertiary relative">
                          <details>
                            <summary className="cursor-pointer text-accent" title="展开后可查看这张图片各个处理步骤的单次耗时。">查看</summary>
                            <div className="absolute right-0 z-20 mt-1 bg-white border border-gray-200 rounded-md shadow-lg p-2 min-w-[220px]">
                              {Object.entries(r.timing).filter(([key]) => key !== 'image_acquisition_ms').map(([key, value]) => (
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
        title={pickerTarget === 'upright' ? '选择后端正罐图片目录' : pickerTarget === 'inverted' ? '选择后端倒罐图片目录' : '选择后端测试图片目录'}
        onClose={() => setPickerTarget(null)}
        onSelect={applyDirectory}
      />
    </div>
  );
};

