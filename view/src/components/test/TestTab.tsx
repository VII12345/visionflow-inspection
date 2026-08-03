import React from 'react';
import { Button } from '../common/Modal';
import { FieldHint } from '../common/FieldHint';
import { BackendDirectoryPicker } from '../common/BackendDirectoryPicker';
import { TestResultPanel } from './TestResultPanel';
import { useModelTest } from './useModelTest';
import { inputClass } from '../common/uiClasses';

export const TestTab: React.FC = () => {
  const {
    modelOptions,
    selectedModel,
    setSelectedModel,
    mode,
    setMode,
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
  } = useModelTest();

  return (
    <div className="h-full overflow-auto">
      {/* Config */}
      <div className="bg-white rounded-lg shadow-card border border-gray-100 p-6 mb-6">
        <h3 className="text-[15px] font-semibold text-text-primary mb-4">模型测试</h3>

        {/* Model + Mode */}
        <div className="flex flex-wrap items-end gap-4 mb-4">
          <div className="flex-1 min-w-[220px]">
            <label className="text-xs text-text-secondary mb-1.5 block"><FieldHint text="选择要验证的已训练模型；测试结果会使用该模型保存的类别名称。">选择模型</FieldHint></label>
            <select
              value={selectedModel}
              onChange={e => setSelectedModel(e.target.value)}
              className={inputClass + ' appearance-none'}
            >
              <option value="">-- 请选择 --</option>
              {modelOptions.map(m => (
                <option key={m.name} value={m.name}>{m.label}</option>
              ))}
            </select>
          </div>
          <div className="w-full sm:w-48">
            <label className="text-xs text-text-secondary mb-1.5 block"><FieldHint text="分类测试需要类别根目录并能计算准确率；批量推理只需要图片目录，不要求标签。">测试模式</FieldHint></label>
            <div className="flex rounded-md border border-gray-300 overflow-hidden">
              <button
                onClick={() => setMode('labeled')}
                className={'flex-1 py-2 text-xs font-medium transition-colors ' + (mode === 'labeled' ? 'bg-accent text-white' : 'bg-white text-text-secondary hover:bg-gray-50')}
              >分类测试</button>
              <button
                onClick={() => setMode('unlabeled')}
                className={'flex-1 py-2 text-xs font-medium transition-colors ' + (mode === 'unlabeled' ? 'bg-accent text-white' : 'bg-white text-text-secondary hover:bg-gray-50')}
              >批量推理</button>
            </div>
          </div>
        </div>

        <div className={'rounded-md border px-4 py-3 mb-4 ' + (mode === 'labeled' ? 'bg-blue-50/60 border-blue-100' : 'bg-emerald-50/60 border-emerald-100')}>
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
                  className={inputClass + ' flex-1 bg-gray-50 cursor-pointer'}
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
                className={inputClass + ' flex-1 bg-gray-50 cursor-pointer'}
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
      {result && <TestResultPanel result={result} />}

      <BackendDirectoryPicker
        open={pickerTarget !== null}
        title={pickerTarget === 'categoryRoot' ? '选择后端类别根目录' : '选择后端测试图片目录'}
        onClose={() => setPickerTarget(null)}
        onSelect={applyDirectory}
      />
    </div>
  );
};
