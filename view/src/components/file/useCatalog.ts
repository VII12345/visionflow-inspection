import { useCallback, useEffect, useState } from 'react';
import { storage } from '../../services/storage';
import { useAppStore } from '../../store/useAppStore';
import { usePolling } from '../../hooks/usePolling';
import type { Product, LineConfig } from '../../types';

/** 目录加载、刷新与轮询（产品列表 + 线体配置）。 */
export const useCatalog = () => {
  const lineCount = useAppStore(s => s.lineCount);
  const isRunning = useAppStore(s => s.isRunning);
  const catalogRevision = useAppStore(s => s.catalogRevision);
  const addProductModal = useAppStore(s => s.addProductModal);
  const [products, setProducts] = useState<Product[]>(storage.getProducts());
  const [lineConfig, setLineConfig] = useState<LineConfig[]>(() => storage.getLineConfig(lineCount));

  const loadCatalog = useCallback(() => {
    setProducts([...storage.getProducts()]);
    setLineConfig([...storage.getLineConfig(lineCount)]);
  }, [lineCount]);

  const refresh = useCallback(async () => {
    const changed = await storage.syncProductsLearningStatus();
    if (changed) setProducts([...storage.getProducts()]);
    setLineConfig([...storage.getLineConfig(lineCount)]);
  }, [lineCount]);

  useEffect(() => { loadCatalog(); refresh(); }, [catalogRevision, lineCount, loadCatalog, refresh]);

  // 新增产品弹窗使用本地加密存储，关闭后同步刷新当前列表。
  useEffect(() => {
    if (!addProductModal) loadCatalog();
  }, [addProductModal, loadCatalog]);

  // 系统运行期间每 5s 同步一次产品/线体与模型学习状态。
  usePolling(refresh, 5000, isRunning);

  return { products, lineConfig, loadCatalog, refresh };
};
