import React from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { Badge, Button } from '../common/Modal';
import type { LineConfig, Product } from '../../types';
import { editInputClass, thClass } from './fileStyles';
import { resolveProductLabel } from '../../utils/productLabel';

interface Props {
  lineConfig: LineConfig[];
  products: Product[];
  lineNameDrafts: Record<number, string>;
  setLineNameDrafts: Dispatch<SetStateAction<Record<number, string>>>;
  onSaveLineName: (line: LineConfig) => void;
}

/** 当前线体检测配置表。 */
export const LineTable: React.FC<Props> = ({ lineConfig, products, lineNameDrafts, setLineNameDrafts, onSaveLineName }) => {
  return (
    <div className="bg-white rounded-lg shadow-card border border-gray-100 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[13px] border-collapse min-w-[560px]">
          <thead className="bg-gray-50">
            <tr>
              <th className={thClass}>线体名称</th>
              <th className={thClass}>检测产品</th>
              <th className={thClass}>状态</th>
              <th className={thClass}>操作</th>
            </tr>
          </thead>
          <tbody>
            {lineConfig.map(item => {
              const prod = products.find(p => p.id === item.productId);
              return (
                <tr key={item.line} className="border-t border-gray-100">
                  <td className="px-4 py-2.5">
                    <input
                      value={lineNameDrafts[item.line] ?? item.name}
                      onChange={e => setLineNameDrafts(prev => ({ ...prev, [item.line]: e.target.value }))}
                      className={`${editInputClass} w-36`}
                    />
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{resolveProductLabel(products, item.productId, '-')}</td>
                  <td className="px-4 py-3">
                    {prod
                      ? (prod.learned
                        ? <Badge variant="learned">已学习</Badge>
                        : <Badge variant="unlearned">未学习</Badge>)
                      : <span className="text-text-tertiary text-xs">未配置</span>
                    }
                  </td>
                  <td className="px-4 py-3"><Button variant="secondary" size="sm" onClick={() => onSaveLineName(item)}>保存名称</Button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
