import { useCallback, useEffect, useState } from 'react';
import { api } from '../../services/api';
import { storage } from '../../services/storage';
import { useAppStore } from '../../store/useAppStore';

/** 运行页模型学习状态与剔除类别同步。 */
export const useRunModelSync = () => {
  const catalogRevision = useAppStore(s => s.catalogRevision);
  const [products, setProducts] = useState(storage.getProducts());
  const [rejectLabels, setRejectLabels] = useState<string[]>(['剔除类']);

  useEffect(() => {
    api.getPlcConfig().then(data => { if (data.success) setRejectLabels(data.config.reject_labels || []); }).catch(() => {});
  }, [catalogRevision]);
  useEffect(() => { setProducts(storage.getProducts()); }, [catalogRevision]);

  const syncModelStatus = useCallback(async () => {
    try {
      const data = await api.getModels();
      if ((data as { success: boolean; models?: { name: string }[] }).success && (data as { models: { name: string }[] }).models) {
        const trainedNames = new Set((data as { models: { name: string }[] }).models.map(m => m.name));
        const prods = storage.getProducts();
        let changed = false;
        for (const p of prods) {
          const was = p.learned;
          p.learned = trainedNames.has(p.model);
          if (p.learned !== was) changed = true;
        }
        if (changed) {
          storage.saveProducts(prods);
          setProducts([...prods]);
        }
      }
    } catch { /* backend may not be ready */ }
  }, []);
  useEffect(() => { syncModelStatus(); const iv = setInterval(syncModelStatus, 10000); return () => clearInterval(iv); }, [syncModelStatus]);

  return { products, rejectLabels };
};
