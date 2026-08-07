import { useState } from 'react';
import { storage } from '../../services/storage';
import { useAppStore } from '../../store/useAppStore';
import type { Product, LineConfig } from '../../types';

/** 产品/线体名称编辑、线体分配与勾选逻辑。 */
export const useCatalogEdit = (
  products: Product[],
  onCatalogChanged: () => void,
) => {
  const user = useAppStore(s => s.user);
  const showMessage = useAppStore(s => s.showMessage);
  const setModal = useAppStore(s => s.setModal);
  const refreshCatalog = useAppStore(s => s.refreshCatalog);
  const lineCount = useAppStore(s => s.lineCount);
  const [checkedId, setCheckedId] = useState<number | null>(null);
  const [productNameDrafts, setProductNameDrafts] = useState<Record<number, string>>({});
  const [productSizeDrafts, setProductSizeDrafts] = useState<Record<number, string>>({});
  const [lineNameDrafts, setLineNameDrafts] = useState<Record<number, string>>({});

  const requireEditPermission = (): boolean => {
    if (!user) { setModal('login', true); return false; }
    if (user.level !== 'admin' && user.level !== 'tech') {
      showMessage('需要技术员或以上权限才能修改检测配置');
      return false;
    }
    return true;
  };

  const saveProduct = (product: Product) => {
    if (!requireEditPermission()) return;
    const name = (productNameDrafts[product.id] ?? product.name ?? product.model).trim();
    if (!name) { showMessage('产品名称不能为空'); return; }
    const size = (productSizeDrafts[product.id] ?? product.size ?? '').trim();
    if (!size) { showMessage('产品尺寸不能为空'); return; }
    const next = storage.getProducts().map(item => item.id === product.id ? { ...item, name, size } : item);
    storage.saveProducts(next);
    refreshCatalog();
    onCatalogChanged();
    showMessage(`产品「${name}」已更新`);
  };

  const saveLineName = (line: LineConfig) => {
    if (!requireEditPermission()) return;
    const name = (lineNameDrafts[line.line] ?? line.name ?? `线体 ${line.line}`).trim();
    if (!name) { showMessage('线体名称不能为空'); return; }
    const next = storage.getLineConfig(lineCount).map(item => item.line === line.line ? { ...item, name } : item);
    storage.saveLineConfig(next);
    refreshCatalog();
    onCatalogChanged();
    showMessage(`线体名称已更新为“${name}”`);
  };

  const assignProduct = (productId: number, line: number) => {
    if (!requireEditPermission()) return;
    if (!Number.isInteger(line) || line < 1 || line > lineCount) { showMessage('请先选择线体'); return; }
    const config = storage.getLineConfig(lineCount);
    const prod = products.find(p => p.id === productId);
    config[line - 1] = { ...config[line - 1], line, productId, model: prod?.model || '-' };
    storage.saveLineConfig(config);
    refreshCatalog();
    onCatalogChanged();
    showMessage(`已将 ${prod?.name || prod?.model} 分配到 ${config[line - 1].name}`);
  };

  const checkProduct = (id: number) => {
    setCheckedId(prev => prev === id ? null : id);
  };

  return {
    checkedId,
    productNameDrafts,
    setProductNameDrafts,
    productSizeDrafts,
    setProductSizeDrafts,
    lineNameDrafts,
    setLineNameDrafts,
    saveProduct,
    saveLineName,
    assignProduct,
    checkProduct,
  };
};
