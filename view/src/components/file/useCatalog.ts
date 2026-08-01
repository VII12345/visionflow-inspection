import { useCallback, useEffect, useRef, useState } from 'react';
import { storage } from '../../services/storage';
import { api } from '../../services/api';
import { useAppStore } from '../../store/useAppStore';
import type { Product, LineConfig } from '../../types';

/** 目录加载、刷新与轮询（产品列表 + 线体配置）。 */
export const useCatalog = () => {
  const lineCount = useAppStore(s => s.lineCount);
  const isRunning = useAppStore(s => s.isRunning);
  const catalogRevision = useAppStore(s => s.catalogRevision);
  const addProductModal = useAppStore(s => s.addProductModal);
  const [products, setProducts] = useState<Product[]>(storage.getProducts());
  const [lineConfig, setLineConfig] = useState<LineConfig[]>(() => storage.getLineConfig(lineCount));
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadCatalog = useCallback(() => {
    setProducts([...storage.getProducts()]);
    setLineConfig([...storage.getLineConfig(lineCount)]);
  }, [lineCount]);

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
    setLineConfig([...storage.getLineConfig(lineCount)]);
  }, [lineCount]);

  useEffect(() => { loadCatalog(); refresh(); }, [catalogRevision, lineCount, loadCatalog, refresh]);

  // 新增产品弹窗使用本地加密存储，关闭后同步刷新当前列表。
  useEffect(() => {
    if (!addProductModal) loadCatalog();
  }, [addProductModal, loadCatalog]);

  useEffect(() => {
    if (isRunning) {
      refreshRef.current = setInterval(refresh, 5000);
    } else if (refreshRef.current) {
      clearInterval(refreshRef.current);
      refreshRef.current = null;
    }
    return () => { if (refreshRef.current) clearInterval(refreshRef.current); };
  }, [isRunning, refresh]);

  return { products, lineConfig, loadCatalog, refresh };
};
