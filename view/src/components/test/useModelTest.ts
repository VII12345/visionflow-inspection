import { useCallback, useEffect, useState } from 'react';
import { api } from '../../services/api';
import { storage } from '../../services/storage';
import { useAppStore } from '../../store/useAppStore';
import { useLocalFolderPicker } from '../../hooks/useLocalFolderPicker';
import { resolveProductLabel } from '../../utils/productLabel';
import type { BackendImageDirectory } from '../common/BackendDirectoryPicker';
import type { StepTiming } from './TimingBreakdown';

export type TestMode = 'labeled' | 'unlabeled';

export interface TestResultItem {
  filename: string;
  expected?: string;
  predicted: string;
  confidence: number;
  correct?: boolean;
  time_ms?: number;
  timing?: Record<string, number>;
}

export interface ModelTestResult {
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
  results: TestResultItem[];
}

export const useModelTest = () => {
  const [models, setModels] = useState<{ name: string }[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [mode, setMode] = useState<TestMode>('labeled');
  const [categoryRootPath, setCategoryRootPath] = useState('');
  const [folderPath, setFolderPath] = useState('');
  const [pickerTarget, setPickerTarget] = useState<'categoryRoot' | 'folder' | null>(null);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ModelTestResult | null>(null);
  const [error, setError] = useState('');
  const showMessage = useAppStore(s => s.showMessage);
  const catalogRevision = useAppStore(s => s.catalogRevision);

  useEffect(() => {
    api.getModels()
      .then(data => {
        if (data.success && data.models) setModels(data.models);
      })
      .catch(() => {});
  }, [catalogRevision]);

  const modelOptions = models.map(model => ({
    name: model.name,
    label: resolveProductLabel(storage.getProducts(), model.name, model.name),
  }));

  const browseLocalFolder = useLocalFolderPicker(showMessage);

  const applyDirectory = useCallback((directory: BackendImageDirectory) => {
    if (pickerTarget === 'categoryRoot') setCategoryRootPath(directory.path);
    if (pickerTarget === 'folder') setFolderPath(directory.path);
    setPickerTarget(null);
  }, [pickerTarget]);

  const runTest = useCallback(async () => {
    if (!selectedModel) {
      setError('请选择模型');
      return;
    }
    setError('');
    setResult(null);
    setTesting(true);
    try {
      const params: { model_name: string; mode: TestMode; category_root_path?: string; folder_path?: string } = {
        model_name: selectedModel,
        mode,
      };
      if (mode === 'labeled') {
        if (!categoryRootPath) {
          setError('请指定类别根目录');
          return;
        }
        params.category_root_path = categoryRootPath;
      } else {
        if (!folderPath) {
          setError('请指定测试图片目录');
          return;
        }
        params.folder_path = folderPath;
      }
      const data = await api.testModel(params);
      if (data.success) {
        setResult(data as unknown as ModelTestResult);
      } else {
        setError(data.message || '测试失败');
      }
    } catch (e) {
      setError('测试失败: ' + (e as Error).message);
    } finally {
      setTesting(false);
    }
  }, [selectedModel, mode, categoryRootPath, folderPath]);

  const changeMode = useCallback((next: TestMode) => {
    setMode(next);
    setResult(null);
  }, []);

  return {
    modelOptions,
    selectedModel,
    setSelectedModel,
    mode,
    setMode: changeMode,
    categoryRootPath,
    setCategoryRootPath,
    folderPath,
    setFolderPath,
    pickerTarget,
    setPickerTarget,
    testing,
    result,
    error,
    browseLocalFolder,
    applyDirectory,
    runTest,
  };
};
