import React, { useEffect, useState, useRef } from 'react';
import { storage } from '../../services/storage';
import { api } from '../../services/api';
import { useAppStore } from '../../store/useAppStore';
import { Button, Badge } from '../common/Modal';
import type { Product } from '../../types';

const thClass = 'px-4 py-2.5 text-left text-[11px] font-medium text-text-tertiary uppercase tracking-wide';

export const FileTab: React.FC = () => {
  const user = useAppStore(s => s.user);
  const showMessage = useAppStore(s => s.showMessage);
  const setModal = useAppStore(s => s.setModal);
  const isRunning = useAppStore(s => s.isRunning);
  const [products, setProducts] = useState<Product[]>(storage.getProducts());
  const [lineConfig, setLineConfig] = useState(storage.getLineConfig());
  const [checkedId, setCheckedId] = useState<number | null>(null);
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = async () => {
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
    setLineConfig([...storage.getLineConfig()]);
  };

  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    if (isRunning) {
      refreshRef.current = setInterval(refresh, 5000);
    } else {
      if (refreshRef.current) { clearInterval(refreshRef.current); refreshRef.current = null; }
    }
    return () => { if (refreshRef.current) clearInterval(refreshRef.current); };
  }, [isRunning]);

  const assignProduct = (productId: number) => {
    if (!user) { setModal('login', true); return; }
    if (user.level !== 'admin' && user.level !== 'tech') {
      showMessage('需要技术员或以上权限才能修改检测配置');
      return;
    }
    const sel = document.getElementById(`prod-line-${productId}`) as HTMLSelectElement;
    if (!sel?.value) { showMessage('请先选择线体'); return; }
    const line = parseInt(sel.value);
    const config = storage.getLineConfig();
    const prod = products.find(p => p.id === productId);
    config[line - 1] = { line, productId, model: prod?.model || '-' };
    storage.saveLineConfig(config);
    setLineConfig([...config]);
    showMessage(`已将 ${prod?.model} 分配到线体 ${line}`);
  };

  const checkProduct = (id: number) => {
    setCheckedId(prev => prev === id ? null : id);
  };

  return (
    <div className="flex flex-col gap-8 overflow-auto">
      {/* Line Config */}
      <div>
        <h3 className="text-[15px] font-semibold text-text-primary mb-4">当前线体检测配置</h3>
        <div className="bg-white rounded-lg shadow-card border border-gray-100 overflow-hidden">
          <table className="w-full text-[13px] border-collapse">
            <thead className="bg-gray-50">
              <tr>
                <th className={thClass}>线体</th>
                <th className={thClass}>检测产品型号</th>
                <th className={thClass}>状态</th>
              </tr>
            </thead>
            <tbody>
              {lineConfig.map(item => {
                const prod = products.find(p => p.id === item.productId);
                return (
                  <tr key={item.line} className="border-t border-gray-100">
                    <td className="px-4 py-3 font-medium text-text-primary">线体 {item.line}</td>
                    <td className="px-4 py-3 text-text-secondary">{prod ? prod.model : '-'}</td>
                    <td className="px-4 py-3">
                      {prod
                        ? (prod.learned
                          ? <Badge variant="learned">已学习</Badge>
                          : <Badge variant="unlearned">未学习</Badge>)
                        : <span className="text-text-tertiary text-xs">未配置</span>
                      }
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Products */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h3 className="text-[15px] font-semibold text-text-primary">全部产品型号</h3>
            <Button variant="ghost" size="sm" onClick={refresh}>刷新</Button>
          </div>
          <Button variant="primary" size="sm" onClick={() => setModal('addProduct', true)}>新增产品</Button>
        </div>
        <div className="bg-white rounded-lg shadow-card border border-gray-100 overflow-hidden">
          <table className="w-full text-[13px] border-collapse">
            <thead className="bg-gray-50">
              <tr>
                <th className={`${thClass} w-12`}>选择</th>
                <th className={thClass}>型号</th>
                <th className={thClass}>尺寸</th>
                <th className={thClass}>学习状态</th>
                <th className={thClass}>分配线体</th>
                <th className={thClass}>操作</th>
              </tr>
            </thead>
            <tbody>
              {products.map(p => (
                <tr key={p.id} className="border-t border-gray-100">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-accent rounded"
                      checked={checkedId === p.id}
                      onChange={() => checkProduct(p.id)}
                    />
                  </td>
                  <td className="px-4 py-3 font-medium text-text-primary">{p.model}</td>
                  <td className="px-4 py-3 text-text-secondary">{p.size}</td>
                  <td className="px-4 py-3">
                    {p.learned ? <Badge variant="learned">已学习</Badge> : <Badge variant="unlearned">未学习</Badge>}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      id={`prod-line-${p.id}`}
                      className="bg-white border border-gray-300 rounded-md px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-accent w-28"
                    >
                      <option value="">--</option>
                      {[1,2,3,4].map(l => <option key={l} value={l}>线体 {l}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <Button variant="primary" size="sm" onClick={() => assignProduct(p.id)}>传送</Button>
                  </td>
                </tr>
              ))}
              {products.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-text-tertiary text-xs">暂无产品型号，点击"新增产品"添加</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
