import React, { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useCatalog } from './useCatalog';
import { useCatalogEdit } from './useCatalogEdit';
import { LineTable } from './LineTable';
import { ProductTable } from './ProductTable';
import { PhotoBrowser } from './PhotoBrowser';

type CatalogView = 'catalog' | 'photos';

export const FileTab: React.FC = () => {
  const setModal = useAppStore(s => s.setModal);
  const { products, lineConfig, loadCatalog, refresh } = useCatalog();
  const edit = useCatalogEdit(products, loadCatalog);
  const [view, setView] = useState<CatalogView>('catalog');

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* 子页切换 */}
      <div className="flex items-center gap-1 mb-5 shrink-0 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => setView('catalog')}
          className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${view === 'catalog' ? 'bg-white text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'}`}
        >
          目录管理
        </button>
        <button
          onClick={() => setView('photos')}
          className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${view === 'photos' ? 'bg-white text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'}`}
        >
          照片浏览
        </button>
      </div>

      {view === 'catalog' ? (
        <div className="flex flex-col gap-8">
          {/* Line Config */}
          <div>
            <h3 className="text-[15px] font-semibold text-text-primary mb-4">当前线体检测配置</h3>
            <LineTable
              lineConfig={lineConfig}
              products={products}
              lineNameDrafts={edit.lineNameDrafts}
              setLineNameDrafts={edit.setLineNameDrafts}
              onSaveLineName={edit.saveLineName}
            />
          </div>

          {/* Products */}
          <ProductTable
            products={products}
            lineConfig={lineConfig}
            checkedId={edit.checkedId}
            onCheck={edit.checkProduct}
            productNameDrafts={edit.productNameDrafts}
            setProductNameDrafts={edit.setProductNameDrafts}
            onSaveProductName={edit.saveProductName}
            onAssignProduct={edit.assignProduct}
            onRefresh={refresh}
            onAddProduct={() => setModal('addProduct', true)}
          />
        </div>
      ) : (
        <PhotoBrowser />
      )}
    </div>
  );
};
