import React, { useEffect, useState, useRef } from 'react';
import { storage } from '../../services/storage';
import { api } from '../../services/api';
import { useAppStore } from '../../store/useAppStore';
import { Button, Badge } from '../common/Modal';
import type { Product } from '../../types';

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

  // 自动刷新（每5秒）
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
    <div className="flex flex-col gap-6 overflow-auto">
      {/* Line Config */}
      <div>
        <h3 className="text-sm font-semibold text-white mb-3">当前线体检测配置</h3>
        <div className="border border-white/[0.06] rounded-xl overflow-hidden bg-[#171d2b]">
          <table className="w-full text-[13px] border-collapse">
            <thead className="bg-[#1e2534] sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 text-left text-gray-400 font-medium">线体</th>
                <th className="px-4 py-3 text-left text-gray-400 font-medium">检测产品型号</th>
                <th className="px-4 py-3 text-left text-gray-400 font-medium">状态</th>
              </tr>
            </thead>
            <tbody>
              {lineConfig.map(item => {
                const prod = products.find(p => p.id === item.productId);
                return (
                  <tr key={item.line} className="border-t border-white/[0.04]">
                    <td className="px-4 py-3 font-semibold text-white">线体 {item.line}</td>
                    <td className="px-4 py-3 text-gray-300">{prod ? prod.model : '-'}</td>
                    <td className="px-4 py-3">
                      {prod
                        ? (prod.learned
                          ? <Badge variant="learned">已学习</Badge>
                          : <Badge variant="unlearned">未学习</Badge>)
                        : <span className="text-gray-600">未配置</span>
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
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold text-white">全部产品型号</h3>
            <Button variant="secondary" size="sm" onClick={refresh}>🔄 刷新</Button>
          </div>
          <Button variant="primary" size="sm" onClick={() => setModal('addProduct', true)}>+ 新增产品</Button>
        </div>
        <div className="border border-white/[0.06] rounded-xl overflow-hidden bg-[#171d2b]">
          <table className="w-full text-[13px] border-collapse">
            <thead className="bg-[#1e2534] sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 text-left text-gray-400 font-medium w-12">选择</th>
                <th className="px-4 py-3 text-left text-gray-400 font-medium">型号</th>
                <th className="px-4 py-3 text-left text-gray-400 font-medium">尺寸</th>
                <th className="px-4 py-3 text-left text-gray-400 font-medium">学习状态</th>
                <th className="px-4 py-3 text-left text-gray-400 font-medium">分配线体</th>
                <th className="px-4 py-3 text-left text-gray-400 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {products.map(p => (
                <tr key={p.id} className="border-t border-white/[0.04]">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-[#5b6ef5]"
                      checked={checkedId === p.id}
                      onChange={() => checkProduct(p.id)}
                    />
                  </td>
                  <td className="px-4 py-3 font-semibold text-white">{p.model}</td>
                  <td className="px-4 py-3 text-gray-400">{p.size}</td>
                  <td className="px-4 py-3">
                    {p.learned ? <Badge variant="learned">已学习</Badge> : <Badge variant="unlearned">未学习</Badge>}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      id={`prod-line-${p.id}`}
                      className="bg-[#111620] border border-white/[0.09] rounded-lg px-3 py-2 text-[13px] text-white outline-none focus:border-[#5b6ef5] focus:shadow-[0_0_0_3px_rgba(91,110,245,0.25)] w-28"
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
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-600">暂无产品型号，点击"新增产品"添加</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
