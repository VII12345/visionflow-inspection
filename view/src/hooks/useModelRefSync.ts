import { useEffect } from 'react';
import { api } from '../services/api';
import { storage } from '../services/storage';
import { useAppStore } from '../store/useAppStore';

/** 从本地产品/线体配置推导模型引用列表。 */
export const deriveModelReferences = (): { model: string; type: string; label: string; detail: string }[] => {
  const products = storage.getProducts();
  const lineConfig = storage.getLineConfig();
  const references: { model: string; type: string; label: string; detail: string }[] = [];
  for (const p of products) {
    references.push({ model: p.model, type: 'product', label: `产品「${p.name || p.model}」`, detail: p.name || p.model });
  }
  for (const line of lineConfig) {
    const prod = products.find(candidate => candidate.id === line.productId);
    if (prod?.model) {
      references.push({ model: prod.model, type: 'line', label: `线体「${line.name}」`, detail: line.name });
    }
  }
  return references;
};

/** 产品/线体目录变化时，把模型引用登记到后端，供删除保护使用。 */
export const useModelRefSync = () => {
  const catalogRevision = useAppStore(s => s.catalogRevision);

  useEffect(() => {
    const sync = async () => {
      try {
        await api.syncModelRefs(deriveModelReferences());
      } catch { /* 后端不可达时忽略，删除保护以后端现有登记为准 */ }
    };
    void sync();
  }, [catalogRevision]);
};
