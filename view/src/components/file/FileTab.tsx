import React from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useCatalog } from './useCatalog';
import { useCatalogEdit } from './useCatalogEdit';
import { LineTable } from './LineTable';
import { ProductTable } from './ProductTable';

export const FileTab: React.FC = () => {
  const setModal = useAppStore(s => s.setModal);
  const { products, lineConfig, loadCatalog, refresh } = useCatalog();
  const edit = useCatalogEdit(products, loadCatalog);

  return (
    <div className="flex flex-col gap-8 overflow-auto">
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
  );
};
