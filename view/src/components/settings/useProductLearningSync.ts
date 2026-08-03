import { useCallback, useState } from 'react';
import { storage } from '../../services/storage';
import { usePolling } from '../../hooks/usePolling';
import type { Product } from '../../types';

/** 产品列表与后端模型学习状态的同步（含 10s 轮询）。 */
export const useProductLearningSync = () => {
  const [products, setProducts] = useState<Product[]>(storage.getProducts());

  const refresh = useCallback(async () => {
    const changed = await storage.syncProductsLearningStatus();
    if (changed) setProducts([...storage.getProducts()]);
  }, []);

  usePolling(refresh, 10000);

  return { products, refresh };
};
