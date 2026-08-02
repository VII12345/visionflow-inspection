import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../services/api';
import { storage } from '../../services/storage';
import { useAppStore } from '../../store/useAppStore';
import { Button } from '../common/Modal';
import type { ModelInfo } from '../../types';

export const ModelSettingsTab: React.FC = () => {
  const user = useAppStore(s => s.user);
  const showMessage = useAppStore(s => s.showMessage);
  const refreshCatalog = useAppStore(s => s.refreshCatalog);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.getModels();
      if (result.success) setModels((result.models || []).map(model => ({ ...model, category_descriptions: model.category_descriptions || {} })));
    } catch (error) {
      showMessage(`模型列表加载失败: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [showMessage]);

  useEffect(() => { void load(); }, [load]);

  const canEdit = user?.level === 'admin' || user?.level === 'tech';

  const findLocalReferences = (modelName: string): string[] => {
    const products = storage.getProducts();
    const lineConfig = storage.getLineConfig();
    const refs: string[] = [];
    for (const p of products) {
      if (p.model === modelName) refs.push(`产品「${p.name || p.model}」`);
    }
    for (const line of lineConfig) {
      const prod = products.find(p => p.id === line.productId);
      if (prod?.model === modelName) refs.push(`线体「${line.name}」`);
    }
    return refs;
  };

  const deleteModel = async (model: ModelInfo) => {
    if (!canEdit) {
      showMessage('只有管理员或技术员可以删除模型');
      return;
    }
    const refs = findLocalReferences(model.name);
    if (refs.length > 0) {
      showMessage(`模型「${model.name}」正在被以下配置引用，请先解除引用再删除：${refs.join('、')}`);
      return;
    }
    if (!window.confirm(`确认删除模型「${model.name}」？删除后无法恢复。`)) return;
    try {
      const result = await api.deleteModel(model.name);
      if (!result.success) {
        showMessage(`删除失败：${result.error || '未知错误'}`);
        return;
      }
      showMessage(`模型「${model.name}」已删除`);
      await load();
    } catch (e) {
      const err = e as Error & { status?: number; data?: { references?: { label: string }[] } };
      if (err.status === 409 && err.data?.references?.length) {
        showMessage(`删除失败：模型被引用（${err.data.references.map(r => r.label).join('、')}）`);
      } else {
        showMessage(`删除失败: ${err.message}`);
      }
    }
  };

  const renameModel = async (model: ModelInfo) => {
    if (!canEdit) {
      showMessage('只有管理员或技术员可以重命名模型');
      return;
    }
    const refs = findLocalReferences(model.name);
    if (refs.length > 0) {
      const ok = window.confirm(`模型「${model.name}」正在被以下配置引用：${refs.join('、')}。\n重命名后这些产品/线体需要重新分配，确定继续？`);
      if (!ok) return;
    }
    const oldName = model.name;
    const newName = (window.prompt('请输入新的模型名称（字母、数字、-、_、.）', oldName) || '').trim();
    if (!newName) return;
    try {
      const result = await api.renameModel(oldName, newName);
      if (!result.success) { showMessage(`重命名失败：${result.error || '未知错误'}`); return; }
      // 全同步：把本地产品与线体中引用该模型的名称一并改为新名称，并通知依赖目录的页面刷新
      const products = storage.getProducts().map(p => p.model === oldName ? { ...p, model: newName } : p);
      storage.saveProducts(products);
      const lines = storage.getLineConfig().map(l => l.model === oldName ? { ...l, model: newName } : l);
      storage.saveLineConfig(lines);
      refreshCatalog();
      showMessage(`模型已重命名为「${result.model}」`);
      await load();
    } catch (e) {
      showMessage(`重命名失败: ${(e as Error).message}`);
    }
  };

  const updateCategoryDescription = (modelName: string, label: string, description: string) => {
    setModels(current => current.map(model => model.name === modelName
      ? { ...model, category_descriptions: { ...model.category_descriptions, [label]: description } }
      : model));
  };

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
      const result = await api.saveModelSettings(model.name, model.reject_labels, model.category_descriptions);
      if (!result.success) throw new Error(result.error || '保存失败');
      showMessage(`模型“${model.name}”的剔除类别已保存`);
      await load();
    } catch (error) {
      showMessage(`模型设置保存失败: ${(error as Error).message}`);
    } finally {
      setSaving(null);
    }
  };

  const renderVersion = (model: ModelInfo) => {
    const parts: string[] = [`共 ${model.num_classes} 个类别`];
    if (model.version?.trained_at) parts.push(`训练于 ${model.version.trained_at}`);
    if (model.version?.accuracy != null) parts.push(`准确率 ${(model.version.accuracy * 100).toFixed(1)}%`);
    if (model.version?.device) parts.push(`设备 ${model.version.device}`);
    return parts.join(' · ');
  };

  return (
    <div className="h-full overflow-auto">
      <div className="bg-white rounded-lg shadow-card border border-gray-100 p-6 mb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-text-primary">模型设置</h2>
            <p className="text-xs text-text-secondary mt-2 leading-5">
              每个模型可以单独选择哪些类别需要剔除。类别名称来自训练图片的子文件夹；如果名称是“类别1”“类别2”这类不直观的名称，可以在下方补充实际含义，方便现场人员识别。
              重命名和删除会检查模型是否被产品/线体引用；删除被引用的模型会被拒绝。
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
              <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-[14px] font-semibold text-text-primary">{model.name}</h3>
                  <p className="text-[11px] text-text-tertiary mt-1">{renderVersion(model)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <Button variant="secondary" size="sm" onClick={() => void renameModel(model)} disabled={!canEdit}>重命名</Button>
                  <Button variant="danger" size="sm" onClick={() => void deleteModel(model)} disabled={!canEdit}>删除</Button>
                  <Button variant="primary" size="sm" onClick={() => void save(model)} disabled={!canEdit || saving !== null}>
                    {saving === model.name ? '保存中...' : '保存设置'}
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {model.categories.map(category => {
                  const checked = model.reject_labels.includes(category);
                  return (
                    <div key={category} className={`rounded-md border px-3 py-2.5 text-xs transition-colors ${checked ? 'border-red-200 bg-red-50/60' : 'border-gray-200 bg-white'}`}>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={checked} disabled={!canEdit} onChange={() => toggleRejectLabel(model.name, category)} className="w-4 h-4 accent-red-600" />
                        <span className="truncate text-text-primary">{category}</span>
                        <span className="ml-auto text-[10px] text-text-tertiary">{checked ? '剔除' : '放行'}</span>
                      </label>
                      <input
                        value={model.category_descriptions[category] || ''}
                        onChange={event => updateCategoryDescription(model.name, category, event.target.value)}
                        disabled={!canEdit}
                        placeholder="填写这个类别的实际含义"
                        className="mt-2 w-full bg-white/80 border border-gray-200 rounded px-2 py-1 text-[11px] text-text-secondary outline-none focus:border-accent"
                      />
                    </div>
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
