import React, { useState } from 'react';
import { Badge } from '../common/Modal';
import type { Product } from '../../types';
import { inputClass, thClass } from './settingsStyles';

interface Props {
  products: Product[];
  selectedModel: { model: string; id: number } | null;
  onSelect: (model: { model: string; id: number }) => void;
}

/** 左侧产品列表：筛选 + 已学习状态展示。 */
export const ProductSection: React.FC<Props> = ({ products, selectedModel, onSelect }) => {
  const [filter, setFilter] = useState('');
  const filtered = products.filter(p => `${p.name || ''} ${p.model}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="w-1/2 flex flex-col">
      <h3 className="text-[15px] font-semibold text-text-primary mb-4">已建立产品</h3>
      <input
        type="text"
        placeholder="输入产品名称或模型标识筛选..."
        value={filter}
        onChange={e => setFilter(e.target.value)}
        className={`${inputClass} mb-4`}
      />
      <div className="bg-white rounded-lg shadow-card border border-gray-100 overflow-auto flex-1">
        <table className="w-full text-[13px] border-collapse">
          <thead className="bg-gray-50 sticky top-0 z-10">
            <tr>
              <th className={thClass}>产品名称</th>
              <th className={thClass}>模型标识</th>
              <th className={thClass}>尺寸</th>
              <th className={thClass}>状态</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => (
              <tr
                key={p.id}
                onClick={() => onSelect({ model: p.model, id: p.id })}
                className={`border-t border-gray-100 cursor-pointer transition-colors ${
                  selectedModel?.id === p.id ? 'bg-blue-50' : 'hover:bg-gray-50'
                }`}
              >
                <td className="px-4 py-3 font-medium text-text-primary">{p.model}</td>
                <td className="px-4 py-3 text-text-secondary">{p.size}</td>
                <td className="px-4 py-3">
                  {p.learned ? <Badge variant="learned">已学习</Badge> : <Badge variant="unlearned">未学习</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
