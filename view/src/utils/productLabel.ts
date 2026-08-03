import type { Product } from '../types';

/**
 * 按产品 id 或模型名解析产品显示名，未命中时回退到 fallback。
 * 产品 model 是模型文件与后端训练任务的稳定关联键，name 可随时修改。
 */
export function resolveProductLabel(
  products: Product[],
  modelOrId: string | number | null | undefined,
  fallback = '',
): string {
  if (modelOrId === null || modelOrId === undefined) return fallback;
  const product = typeof modelOrId === 'number'
    ? products.find(p => p.id === modelOrId)
    : products.find(p => p.model === modelOrId);
  return product ? (product.name || product.model) : fallback;
}
