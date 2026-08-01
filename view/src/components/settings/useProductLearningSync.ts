import { useCallback, useEffect, useState } from 'react';
import { api } from '../../services/api';
import { storage } from '../../services/storage';
import type { Product } from '../../types';

/** 产品列表与后端模型学习状态的同步（含 10s 轮询）。 */
export const useProductLearningSync = () => {
  const [products, setProducts] = useState<Product[]>(storage.getProducts());

  const refresh = useCallback(async () => {
    try {
      const data = await api.getModels();
      if ((data as { success: boolean }).success && (data as { models: { name: string }[] }).models) {
        const trainedNames = new Set((data as { models: { name: string }[] }).models.map(m => m.name));
        const prods = storage.getProducts();
        let changed = false;
        for (const p of prods) {
          const was = p.learned;
          p.learned = trainedNames.has(p.model);
          if (p.learned !== was) changed = true;
        }
        if (changed) storage.saveProducts(prods);
        setProducts([...prods]);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const interval = setInterval(refresh, 10000);
    return () => clearInterval(interval);
  }, [refresh]);

  return { products, refresh };
};
