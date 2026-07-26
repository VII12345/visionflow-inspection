import React, { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { storage } from '../../services/storage';
import { Button } from '../common/Modal';
import { useAppStore } from '../../store/useAppStore';
import { BackendDirectoryPicker, type BackendImageDirectory } from '../common/BackendDirectoryPicker';

interface StepTiming { avg_ms: number; min_ms: number; max_ms: number; total_ms: number; }
const STEP_LABELS: Record<string, string> = {
  inference_submit_ms: '提交推理队列',
  inference_queue_wait_ms: '推理队列等待',
  inference_batch_window_ms: '推理批窗口',
  model_prepare_ms: 'Worker 获取模型',
  preprocess_ms: '图像预处理',
  model_call_ms: '调用模型',
  recognition_ms: '识别/置信度计算',
  inference_result_wait_ms: '等待推理结果',
  inference_result_handoff_ms: '推理结果交接',
  result_output_ms: '输出结果',
  frame_copy_ms: '帧复制',
  save_submit_ms: '提交保存队列',
  save_queue_wait_ms: '保存队列等待',
  save_queue_wait_excluding_write_ms: '写盘前队列等待',
  image_save_ms: '实际写盘',
  detection_pipeline_ms: '检测主流程',
  pipeline_ms: '单张完整流程',
};

// 按完整检测链路建立树形结构。父级耗时只由子项相加得到，
// 不再把“等待推理结果/检测主流程/单张完整流程”等外层汇总计时重复展示。
interface TimingTreeNode {
  key: string;
  label: string;
  description: string;
  steps?: string[];
  children?: TimingTreeNode[];
}

const TIMING_TREE: TimingTreeNode[] = [
  {
    key: 'inference',
    label: '推理链路',
    description: '提交任务、排队并完成模型推理',
    children: [
      { key: 'inference-submit', label: '提交推理队列', description: '', steps: ['inference_submit_ms'] },
      {
        key: 'inference-wait',
        label: '等待推理结果',
        description: '下面各项之和表示从 Worker 取任务到结果生成的可拆分耗时',
        children: [
          { key: 'queue-wait', label: '推理队列等待', description: '', steps: ['inference_queue_wait_ms'] },
          { key: 'batch-window', label: '推理批窗口', description: '', steps: ['inference_batch_window_ms'] },
          { key: 'model-prepare', label: 'Worker 获取模型', description: '', steps: ['model_prepare_ms'] },
          { key: 'preprocess', label: '图像预处理', description: '', steps: ['preprocess_ms'] },
          { key: 'model-call', label: '调用模型', description: '', steps: ['model_call_ms'] },
          { key: 'recognition', label: '识别/置信度计算', description: '', steps: ['recognition_ms'] },
          { key: 'result-handoff', label: '推理结果交接', description: '结果入队、线程唤醒以及测试线程取回结果的剩余时间。', steps: ['inference_result_handoff_ms'] },
        ],
      },
    ],
  },
  {
    key: 'output',
    label: '结果输出',
    description: '整理识别结果',
    children: [
      { key: 'result-output', label: '输出结果', description: '', steps: ['result_output_ms'] },
    ],
  },
  {
    key: 'save',
    label: '图片保存',
    description: '将结果图片交给异步保存线程并写入磁盘',
    children: [
      { key: 'frame-copy', label: '帧复制', description: '', steps: ['frame_copy_ms'] },
      { key: 'save-submit', label: '提交保存队列', description: '', steps: ['save_submit_ms'] },
      {
        key: 'save-wait',
        label: '保存队列等待',
        description: '下面两项相加等于从提交保存到写盘完成的墙钟等待，实际写盘不再重复计算。',
        children: [
          { key: 'save-queue-wait', label: '写盘前队列等待', description: '', steps: ['save_queue_wait_excluding_write_ms'] },
          { key: 'image-save', label: '实际写盘', description: '', steps: ['image_save_ms'] },
        ],
      },
    ],
  },
];

const HIDDEN_TIMING_KEYS = new Set([
  'inference_result_wait_ms',
  'save_queue_wait_ms',
  'detection_pipeline_ms',
  'pipeline_ms',
]);

const STEP_EXPLANATIONS: Record<string, string> = {
  inference_submit_ms: '把已经读取的图片放入真实推理队列，并记录提交动作本身耗时；不包括排队等待和模型计算。',
  inference_queue_wait_ms: '图片进入推理队列后，等待推理 Worker 取走处理的时间。队列拥堵或前面任务较多时会升高。',
  inference_batch_window_ms: 'Worker 为了形成微批次而等待更多图片的时间。单张测试时通常接近微批窗口上限。',
  model_prepare_ms: 'Worker 获取并确认本次任务使用的模型，必要时完成模型加载或设备准备。已缓存模型通常较快。',
  preprocess_ms: '将原图裁剪、缩放到模型输入尺寸，并进行归一化和训练/测试需要的图像预处理。',
  model_call_ms: '调用 PyTorch 模型执行前向推理，得到类别分类的原始输出。GPU/CPU 性能会直接影响此项。',
  recognition_ms: '将模型输出转换为类别、置信度和最终标签，完成识别结果计算。',
  inference_result_wait_ms: '测试接口提交推理后，等待结果队列返回这一张图片结果的完整墙钟时间；它是外层汇总，不和下方子项重复展示。',
  inference_result_handoff_ms: '推理 Worker 的已拆分阶段结束后，结果入队、线程唤醒以及测试线程取回结果的剩余时间。',
  result_output_ms: '把推理结果整理为接口返回格式，并完成测试统计数据更新。',
  frame_copy_ms: '为异步保存创建一份独立的图像副本，避免保存线程和推理线程同时操作同一对象。',
  save_submit_ms: '把待保存图片和目标路径提交到异步保存队列，提交后实际写盘由后台保存线程执行。',
  save_queue_wait_ms: '从提交保存到保存完成的完整墙钟等待，包含排队等待和实际写盘；详细树中会拆成两个互不重叠的子项。',
  save_queue_wait_excluding_write_ms: '保存任务入队后，在实际写盘开始前等待保存 Worker 或等待前序任务完成的时间。',
  image_save_ms: '保存 Worker 将图片编码为 BMP 并实际写入后端磁盘的耗时。磁盘速度、目录位置和文件大小都会影响此项。',
  detection_pipeline_ms: '从检测流程开始到输出检测结果的主流程耗时，便于观察推理链路整体开销。',
  pipeline_ms: '单张图片从读入内存后开始，到推理、结果输出以及异步保存完成的处理耗时；不包含读取图片本身。',
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
  overallAvgMs?: number;
}

const sumTimings = (items: StepTiming[]): StepTiming | null => {
  if (items.length === 0) return null;
  return items.reduce((sum, item) => ({
    avg_ms: sum.avg_ms + item.avg_ms,
    min_ms: sum.min_ms + item.min_ms,
    max_ms: sum.max_ms + item.max_ms,
    total_ms: sum.total_ms + item.total_ms,
  }), { avg_ms: 0, min_ms: 0, max_ms: 0, total_ms: 0 });
};

const collectTimingKeys = (nodes: TimingTreeNode[]): string[] => nodes.flatMap(node => [
  ...(node.steps || []),
  ...(node.children ? collectTimingKeys(node.children) : []),
]);

const TimingBreakdown: React.FC<TimingBreakdownProps> = ({ steps, stepLabels, overallAvgMs }) => {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const knownKeys = new Set(collectTimingKeys(TIMING_TREE));
  const extraSteps = Object.entries(steps).filter(([key]) => !HIDDEN_TIMING_KEYS.has(key) && !knownKeys.has(key));

  const getNodeTiming = (node: TimingTreeNode): StepTiming | null => {
    if (node.children) {
      return sumTimings(node.children.map(getNodeTiming).filter((item): item is StepTiming => Boolean(item)));
    }
    return sumTimings((node.steps || []).map(key => steps[key]).filter((item): item is StepTiming => Boolean(item)));
  };

  const toggle = (key: string) => setCollapsed(current => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  const renderStep = (key: string, step: StepTiming, depth: number) => (
    <div key={key} className={`grid grid-cols-[minmax(160px,1.4fr)_repeat(4,minmax(70px,1fr))] items-center py-2 pr-3 text-xs border-l-2 border-accent/15 hover:bg-blue-50/30 ${depth > 0 ? 'ml-6 pl-4' : 'pl-3'}`}>
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

  const renderNode = (node: TimingTreeNode, depth: number): React.ReactNode => {
    const timing = getNodeTiming(node);
    if (!timing) return null;
    if (!node.children) {
      return renderStep(node.steps?.[0] || node.key, timing, depth);
    }
    const visibleChildren = node.children.filter(child => Boolean(getNodeTiming(child)));
    if (visibleChildren.length === 0) return null;
    const isCollapsed = collapsed.has(node.key);
    return (
      <section key={node.key} className={depth > 0 ? 'border-l-2 border-accent/20 ml-4' : ''}>
        <button
          type="button"
          onClick={() => toggle(node.key)}
          aria-expanded={!isCollapsed}
          className={`w-full grid grid-cols-[minmax(160px,1.4fr)_repeat(4,minmax(70px,1fr))] items-center gap-2 px-3 py-2.5 text-left ${depth === 0 ? 'bg-white' : 'bg-blue-50/35'} hover:bg-blue-50/70`}
        >
          <span className="flex items-center gap-2 min-w-0">
            <span className="w-4 shrink-0 text-center text-accent font-bold">{isCollapsed ? '›' : '⌄'}</span>
            <span className={`${depth === 0 ? 'text-[13px]' : 'text-xs'} font-semibold text-text-primary truncate`} title={node.description || node.label}>{node.label}</span>
          </span>
          <span className="text-[10px] text-text-secondary text-right whitespace-nowrap">平均 {timing.avg_ms.toFixed(2)}</span>
          <span className="text-[10px] text-text-secondary text-right whitespace-nowrap">最短 {timing.min_ms.toFixed(2)}</span>
          <span className="text-[10px] text-text-secondary text-right whitespace-nowrap">最长 {timing.max_ms.toFixed(2)}</span>
          <span className="text-[10px] text-text-primary font-medium text-right whitespace-nowrap" title={node.description || '该项耗时为所有可见子项目的对应指标之和。'}>合计 {timing.total_ms.toFixed(2)}</span>
        </button>
        {node.description && <div className={`text-[10px] text-text-tertiary px-3 pb-1.5 ${depth > 0 ? 'pl-11' : 'pl-9'}`}>{node.description}</div>}
        {!isCollapsed && <div className="bg-gray-50/40">{visibleChildren.map(child => renderNode(child, depth + 1))}</div>}
      </section>
    );
  };

  const topLevelTiming = sumTimings(TIMING_TREE.map(getNodeTiming).filter((item): item is StepTiming => Boolean(item)));
  const displayedGapMs = overallAvgMs != null && topLevelTiming ? overallAvgMs - topLevelTiming.avg_ms : null;

  return (
    <div className="border border-gray-100 rounded-md overflow-hidden">
      <div className="bg-gray-50 px-3 py-2 text-[10px] font-medium text-text-tertiary uppercase tracking-wide flex items-center justify-between">
        <span>分层操作耗时（毫秒）</span>
        {topLevelTiming && <span className="normal-case text-text-secondary">已展示子项平均合计 {topLevelTiming.avg_ms.toFixed(2)} ms · 累计 {topLevelTiming.total_ms.toFixed(2)} ms</span>}
      </div>
      {displayedGapMs != null && (
        <div className="px-3 py-2 text-[10px] text-text-tertiary bg-amber-50/50 border-b border-amber-100">
          端到端单张平均 {overallAvgMs!.toFixed(2)} ms；与已展示分项相差 {Math.abs(displayedGapMs).toFixed(2)} ms。差值主要来自不同计时点和线程调度产生的测量误差，不是子项重复相加。
        </div>
      )}
      <div className="divide-y divide-gray-100">{TIMING_TREE.map(node => renderNode(node, 0))}</div>
      {extraSteps.length > 0 && (
        <div className="border-t border-gray-100">
          <button type="button" onClick={() => toggle('extra')} aria-expanded={!collapsed.has('extra')} className="w-full flex items-center gap-2 px-3 py-2.5 bg-white hover:bg-blue-50/50 text-left">
            <span className="w-4 text-center text-accent font-bold">{collapsed.has('extra') ? '›' : '⌄'}</span>
            <span className="text-[13px] font-semibold text-text-primary">其他步骤</span>
            <span className="text-[11px] text-text-tertiary flex-1">后端新增的计时项</span>
          </button>
          {!collapsed.has('extra') && <div className="bg-gray-50/40">{extraSteps.map(([key, step]) => renderStep(key, step, 0))}</div>}
        </div>
      )}
    </div>
  );
};

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
            <label className="text-xs text-text-secondary mb-1.5 block">选择模型</label>
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
              <p className="text-[11px] text-text-secondary leading-5">用于验证模型准确率、各类别分类正确率和置信度表现。该模式重点关注识别结果是否正确，不代表真实产线的异步时序压力。</p>
            </>
          ) : (
            <>
              <div className="text-xs font-semibold text-ok mb-1">批量推理：真实环境模拟测试</div>
              <p className="text-[11px] text-text-secondary leading-5">逐张模拟产线流程：提交真实推理队列 → Worker 异步推理 → 输出结果 → 提交异步保存队列 → 等待实际写盘完成，并统计处理阶段延迟；读取图片本身不计入耗时。</p>
            </>
          )}
        </div>

        {/* Paths */}
        {mode === 'labeled' ? (
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-xs text-text-secondary mb-1.5 block">类别根目录</label>
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
            <label className="text-xs text-text-secondary mb-1.5 block">测试图片目录</label>
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

