import { useCallback, useEffect, useState } from 'react';
import { api } from '../../services/api';
import { storage } from '../../services/storage';
import { useAppStore } from '../../store/useAppStore';
import { usePolling } from '../../hooks/usePolling';

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
    const changed = await storage.syncProductsLearningStatus();
    if (changed) setProducts([...storage.getProducts()]);
  }, []);
  usePolling(syncModelStatus, 10000);

  return { products, rejectLabels };
};
