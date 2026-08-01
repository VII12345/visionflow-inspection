import React from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { Badge, Button } from '../common/Modal';
import type { LineConfig, Product } from '../../types';
import { EmptyState } from './EmptyState';
import { editInputClass, thClass } from './fileStyles';

interface Props {
  products: Product[];
  lineConfig: LineConfig[];
  checkedId: number | null;
  onCheck: (id: number) => void;
  productNameDrafts: Record<number, string>;
  setProductNameDrafts: Dispatch<SetStateAction<Record<number, string>>>;
  onSaveProductName: (product: Product) => void;
  onAssignProduct: (productId: number) => void;
  onRefresh: () => void;
  onAddProduct: () => void;
}

/** 全部产品表：编辑名称/分配线体/学习状态。 */
export const ProductTable: React.FC<Props> = ({
  products,
  lineConfig,
  checkedId,
  onCheck,
  productNameDrafts,
  setProductNameDrafts,
  onSaveProductName,
  onAssignProduct,
  onRefresh,
  onAddProduct,
}) => {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h3 className="text-[15px] font-semibold text-text-primary">全部产品</h3>
          <Button variant="ghost" size="sm" onClick={onRefresh}>刷新</Button>
        </div>
        <Button variant="primary" size="sm" onClick={onAddProduct}>新增产品</Button>
      </div>
      <div className="bg-white rounded-lg shadow-card border border-gray-100 overflow-hidden">
        <table className="w-full text-[13px] border-collapse">
          <thead className="bg-gray-50">
            <tr>
              <th className={`${thClass} w-12`}>选择</th>
              <th className={thClass}>产品名称</th>
              <th className={thClass}>模型标识</th>
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
                  <input type="checkbox" className="w-4 h-4 accent-accent rounded" checked={checkedId === p.id} onChange={() => onCheck(p.id)} />
                </td>
                <td className="px-4 py-2.5">
                  <input
                    value={productNameDrafts[p.id] ?? p.name}
                    onChange={e => setProductNameDrafts(prev => ({ ...prev, [p.id]: e.target.value }))}
                    className={`${editInputClass} w-40`}
                  />
                </td>
                <td className="px-4 py-3 text-text-secondary font-mono text-xs">{p.model}</td>
                <td className="px-4 py-3 text-text-secondary">{p.size}</td>
                <td className="px-4 py-3">{p.learned ? <Badge variant="learned">已学习</Badge> : <Badge variant="unlearned">未学习</Badge>}</td>
                <td className="px-4 py-3">
                  <select id={`prod-line-${p.id}`} className="bg-white border border-gray-300 rounded-md px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-accent w-32">
                    <option value="">--</option>
                    {lineConfig.map(line => <option key={line.line} value={line.line}>{line.name}</option>)}
                  </select>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <Button variant="secondary" size="sm" onClick={() => onSaveProductName(p)}>保存名称</Button>
                  <Button variant="primary" size="sm" className="ml-2" onClick={() => onAssignProduct(p.id)}>分配</Button>
                </td>
              </tr>
            ))}
            {products.length === 0 && <EmptyState colSpan={7} message="暂无产品，点击“新增产品”添加" />}
          </tbody>
        </table>
      </div>
    </div>
  );
};
