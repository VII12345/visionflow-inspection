import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../services/api';
import { useAppStore } from '../../store/useAppStore';
import { Button } from '../common/Modal';
import { FieldHint } from '../common/FieldHint';
import type { ModelInfo } from '../../types';

export const ModelSettingsTab: React.FC = () => {
  const user = useAppStore(s => s.user);
  const showMessage = useAppStore(s => s.showMessage);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.getModels();
      if (result.success) setModels(result.models || []);
    } catch (error) {
      showMessage(`模型列表加载失败: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [showMessage]);

  useEffect(() => { void load(); }, [load]);

  const canEdit = user?.level === 'admin' || user?.level === 'tech';

  const toggleRejectLabel = (modelName: string, label: string) => {
    setModels(current => current.map(model => {
      if (model.name !== modelName) return model;
      const next = model.reject_labels.includes(label)
        ? model.reject_labels.filter(item => item !== label)
        : [...model.reject_labels, label];
      return { ...model, reject_labels: next };
    }));
  };

  const save = async (model: ModelInfo) => {
    if (!canEdit) {
      showMessage('只有管理员或技术员可以修改模型设置');
      return;
    }
    setSaving(model.name);
    try {
      const result = await api.saveModelSettings(model.name, model.reject_labels);
      if (!result.success) throw new Error(result.error || '保存失败');
      showMessage(`模型“${model.name}”的剔除类别已保存`);
      await load();
    } catch (error) {
      showMessage(`模型设置保存失败: ${(error as Error).message}`);
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="h-full overflow-auto">
      <div className="bg-white rounded-lg shadow-card border border-gray-100 p-6 mb-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[15px] font-semibold text-text-primary">模型设置</h2>
            <p className="text-xs text-text-secondary mt-2 leading-5">
              每个模型可以单独选择哪些类别需要剔除。实际检测时，系统会根据当前线体使用的模型读取这里的设置；没有勾选的类别不会触发 PLC 剔除信号。
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>刷新</Button>
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-lg border border-gray-100 p-8 text-center text-xs text-text-tertiary">正在读取已有模型...</div>
      ) : models.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-100 p-8 text-center text-xs text-text-tertiary">
          暂无已训练模型。请先在“设置”页面选择类别根目录并完成训练。
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {models.map(model => (
            <div key={model.name} className="bg-white rounded-lg shadow-card border border-gray-100 p-5">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <h3 className="text-[14px] font-semibold text-text-primary">{model.name}</h3>
                  <p className="text-[11px] text-text-tertiary mt-1">共 {model.num_classes} 个类别</p>
                </div>
                <Button variant="primary" size="sm" onClick={() => void save(model)} disabled={!canEdit || saving !== null}>
                  {saving === model.name ? '保存中...' : '保存设置'}
                </Button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {model.categories.map(category => {
                  const checked = model.reject_labels.includes(category);
                  return (
                    <label key={category} className={`flex items-center gap-2 rounded-md border px-3 py-2.5 text-xs cursor-pointer transition-colors ${checked ? 'border-red-200 bg-red-50 text-red-700' : 'border-gray-200 bg-white text-text-secondary hover:bg-gray-50'}`}>
                      <input type="checkbox" checked={checked} disabled={!canEdit} onChange={() => toggleRejectLabel(model.name, category)} className="w-4 h-4 accent-red-600" />
                      <span className="truncate">{category}</span>
                      <span className="ml-auto text-[10px] text-text-tertiary">{checked ? '剔除' : '放行'}</span>
                    </label>
                  );
                })}
              </div>
              {!canEdit && <p className="text-[11px] text-text-tertiary mt-3">当前账户只能查看，修改模型设置需要管理员或技术员权限。</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
